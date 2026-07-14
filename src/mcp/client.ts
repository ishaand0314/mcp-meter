import { spawn } from 'child_process';
import { StringDecoder } from 'string_decoder';
import { ServerConfig, ToolManifest } from '../types';

/** Hard per-server timeout for the whole spawn + handshake + tools/list flow. */
export const SERVER_TIMEOUT_MS = 10_000;

/** Grace period after SIGTERM before we escalate to SIGKILL on a hung server. */
export const KILL_GRACE_MS = 2_000;

/** Per-stream cap on buffered output. A misbehaving/malicious server that never
 * sends a newline (so no JSON-RPC line ever completes) must not be able to grow
 * memory without bound while we wait out SERVER_TIMEOUT_MS. */
export const MAX_BUFFERED_BYTES = 10 * 1024 * 1024; // 10 MiB

/**
 * Environment variables passed through to spawned MCP servers by default.
 * Deliberately NOT the full parent environment: mcp-meter only needs the
 * child to be able to locate its own interpreter/runtime and answer
 * `initialize`/`tools/list`, so we avoid handing arbitrary (and possibly
 * unvetted/third-party) server processes secrets like API keys or tokens
 * that happen to be sitting in the invoking shell's environment. Anything
 * a server actually needs beyond this can be supplied explicitly via the
 * server's own configured `env`.
 */
const SAFE_ENV_PASSTHROUGH = [
  'PATH',
  'Path',
  'HOME',
  'USERPROFILE',
  'TEMP',
  'TMP',
  'TMPDIR',
  'SystemRoot',
  'windir',
  'ComSpec',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramData',
  'NODE_PATH',
  'LANG',
  'LC_ALL',
  'SHELL',
];

function buildChildEnv(config: ServerConfig): NodeJS.ProcessEnv {
  const safeEnv: NodeJS.ProcessEnv = {};
  for (const key of SAFE_ENV_PASSTHROUGH) {
    const value = process.env[key];
    if (value !== undefined) safeEnv[key] = value;
  }
  return { ...safeEnv, ...(config.env ?? {}) };
}

export interface FetchToolsResult {
  ok: true;
  tools: ToolManifest[];
}

export interface FetchToolsFailure {
  ok: false;
  reason: string;
}

export type FetchToolsOutcome = FetchToolsResult | FetchToolsFailure;

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * Spawns an MCP server over stdio, performs the `initialize` handshake, then
 * calls `tools/list`. Enforces a hard timeout (SERVER_TIMEOUT_MS) covering
 * the entire operation. Never throws: all failure modes resolve to
 * `{ ok: false, reason }` so a single misbehaving server can never block or
 * crash the overall analysis run.
 */
export function fetchToolsFromServer(config: ServerConfig): Promise<FetchToolsOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    let childExited = false;

    /**
     * Kills the spawned server. On POSIX this signals the whole process
     * group (not just the immediate PID) so that wrapper commands such as
     * `npx ...` or `docker run ...` can't leave a grandchild/container
     * running after we give up on them. On Windows, `taskkill /T` is used
     * to terminate the whole process tree since there is no equivalent to
     * a negative-PID group signal. If the process doesn't go away after a
     * SIGTERM, we escalate to SIGKILL.
     */
    const killTree = (signal: NodeJS.Signals) => {
      const pid = child.pid;
      if (pid === undefined) return;
      if (process.platform === 'win32') {
        try {
          spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
        } catch {
          /* ignore */
        }
        return;
      }
      try {
        // Negative pid targets the whole process group created by `detached: true` below.
        process.kill(-pid, signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          /* ignore */
        }
      }
    };

    const finish = (outcome: FetchToolsOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!childExited) {
        try {
          killTree('SIGTERM');
        } catch {
          /* ignore */
        }
        const escalate = setTimeout(() => {
          if (!childExited) {
            try {
              killTree('SIGKILL');
            } catch {
              /* ignore */
            }
          }
        }, KILL_GRACE_MS);
        escalate.unref?.();
      }
      resolve(outcome);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(config.command, config.args ?? [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: buildChildEnv(config),
        // Give the child its own process group on POSIX so killTree() can signal
        // the whole tree (e.g. the real server process behind an `npx`/`uvx` wrapper)
        // instead of only the immediate wrapper PID.
        detached: process.platform !== 'win32',
      });
    } catch (err) {
      resolve({ ok: false, reason: `failed to spawn: ${(err as Error).message}` });
      return;
    }

    const timer = setTimeout(() => {
      finish({ ok: false, reason: `timed out after ${SERVER_TIMEOUT_MS}ms` });
    }, SERVER_TIMEOUT_MS);

    child.on('error', (err) => {
      finish({ ok: false, reason: `spawn error: ${err.message}` });
    });

    child.on('exit', (code, signal) => {
      childExited = true;
      if (!settled) {
        finish({
          ok: false,
          reason: `server exited early (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
        });
      }
    });

    let stdoutBuffer = '';
    let stderrBuffer = '';
    let nextId = 1;
    const pending = new Map<number, (msg: JsonRpcMessage) => void>();
    // Streaming decoders correctly carry over a multi-byte UTF-8 sequence that
    // is split across two separate `data` chunks, instead of mangling it into
    // replacement characters by decoding each chunk independently.
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');

    function send(msg: Record<string, unknown>) {
      try {
        child.stdin?.write(JSON.stringify(msg) + '\n');
      } catch {
        /* server may have already closed stdin; handled by exit/error events */
      }
    }

    function request(method: string, params: unknown): Promise<JsonRpcMessage> {
      const id = nextId++;
      return new Promise((res) => {
        pending.set(id, res);
        send({ jsonrpc: '2.0', id, method, params });
      });
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled) return;
      stdoutBuffer += stdoutDecoder.write(chunk);
      if (stdoutBuffer.length > MAX_BUFFERED_BYTES) {
        finish({
          ok: false,
          reason: `server sent more than ${MAX_BUFFERED_BYTES} bytes of stdout without a complete response`,
        });
        return;
      }
      let idx: number;
      while ((idx = stdoutBuffer.indexOf('\n')) >= 0) {
        const line = stdoutBuffer.slice(0, idx);
        stdoutBuffer = stdoutBuffer.slice(idx + 1);
        const trimmed = line.trim();
        if (!trimmed) continue;
        let msg: JsonRpcMessage;
        try {
          msg = JSON.parse(trimmed);
        } catch {
          continue; // ignore non-JSON stdout noise (some servers log to stdout)
        }
        if (typeof msg.id === 'number' && pending.has(msg.id)) {
          const resolver = pending.get(msg.id)!;
          pending.delete(msg.id);
          resolver(msg);
        }
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      if (settled) return;
      const decoded = stderrDecoder.write(chunk);
      // stderr is only ever used as a truncated diagnostic hint, so once we're
      // over the cap we just stop accumulating instead of growing forever.
      if (stderrBuffer.length < MAX_BUFFERED_BYTES) {
        stderrBuffer += decoded;
      }
    });

    async function run() {
      try {
        const initResult = await request('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'mcp-meter', version: '0.1.0' },
        });
        if (initResult.error) {
          finish({ ok: false, reason: `initialize error: ${initResult.error.message}` });
          return;
        }
        send({ jsonrpc: '2.0', method: 'notifications/initialized' });

        const toolsResult = await request('tools/list', {});
        if (toolsResult.error) {
          finish({ ok: false, reason: `tools/list error: ${toolsResult.error.message}` });
          return;
        }
        const result = toolsResult.result as { tools?: ToolManifest[] } | undefined;
        const tools = result?.tools ?? [];
        finish({ ok: true, tools });
      } catch (err) {
        const stderrHint = stderrBuffer.trim() ? ` (stderr: ${stderrBuffer.trim().slice(0, 200)})` : '';
        finish({ ok: false, reason: `handshake failed: ${(err as Error).message}${stderrHint}` });
      }
    }

    void run();
  });
}
