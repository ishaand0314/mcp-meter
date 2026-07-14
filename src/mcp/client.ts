import { spawn } from 'child_process';
import { ServerConfig, ToolManifest } from '../types';

/** Hard per-server timeout for the whole spawn + handshake + tools/list flow. */
export const SERVER_TIMEOUT_MS = 10_000;

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
    const finish = (outcome: FetchToolsOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      resolve(outcome);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(config.command, config.args ?? [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...(config.env ?? {}) },
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
      stdoutBuffer += chunk.toString('utf8');
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
      stderrBuffer += chunk.toString('utf8');
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
