import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parse as parseToml } from 'smol-toml';
import { ServerConfig } from '../types';

export interface KnownConfigLocation {
  client: string;
  configPath: string;
  /**
   * True for config locations derived from the current working directory
   * (e.g. a `.mcp.json` or `.cursor/mcp.json` checked into a repo), as
   * opposed to the user's home directory. Anyone who can get a victim to run
   * mcp-meter inside a given directory (e.g. by getting them to clone a
   * repo) can author these files, so - mirroring the workspace-trust
   * prompts real MCP clients require before ever executing such a config -
   * `discoverAllServers` does not auto-load them unless the user opts in via
   * `MCP_METER_TRUST_CWD=1`.
   */
  untrusted?: boolean;
}

/**
 * Returns the list of well-known MCP client config file locations to probe,
 * for the given platform/home directory. Pure function (no filesystem
 * access) so it's easy to unit test path construction in isolation.
 */
export function getKnownConfigPaths(
  platform: NodeJS.Platform = process.platform,
  homeDir: string = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): KnownConfigLocation[] {
  const locations: KnownConfigLocation[] = [];
  const appData = env.APPDATA ?? path.join(homeDir, 'AppData', 'Roaming');
  const cwd = env.MCP_METER_CWD ?? process.cwd();

  // --- Claude Desktop ---
  if (platform === 'darwin') {
    locations.push({
      client: 'Claude Desktop',
      configPath: path.join(homeDir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    });
  } else if (platform === 'win32') {
    locations.push({
      client: 'Claude Desktop',
      configPath: path.join(appData, 'Claude', 'claude_desktop_config.json'),
    });
  } else {
    // Linux (unofficial/community convention).
    locations.push({
      client: 'Claude Desktop',
      configPath: path.join(homeDir, '.config', 'Claude', 'claude_desktop_config.json'),
    });
  }

  // --- Claude Code ---
  // Global user config.
  locations.push({
    client: 'Claude Code',
    configPath: path.join(homeDir, '.claude.json'),
  });
  // Project-scoped config (checked into a repo, or per-project).
  locations.push({
    client: 'Claude Code (project)',
    configPath: path.join(cwd, '.mcp.json'),
    untrusted: true,
  });

  // --- Cursor ---
  locations.push({
    client: 'Cursor',
    configPath: path.join(homeDir, '.cursor', 'mcp.json'),
  });
  locations.push({
    client: 'Cursor (project)',
    configPath: path.join(cwd, '.cursor', 'mcp.json'),
    untrusted: true,
  });

  // --- Windsurf ---
  if (platform === 'win32') {
    locations.push({
      client: 'Windsurf',
      configPath: path.join(appData, 'Windsurf', 'mcp_config.json'),
    });
  } else {
    locations.push({
      client: 'Windsurf',
      configPath: path.join(homeDir, '.codeium', 'windsurf', 'mcp_config.json'),
    });
  }

  // --- Codex CLI ---
  // Global user config (TOML, not JSON).
  locations.push({
    client: 'Codex CLI',
    configPath: path.join(homeDir, '.codex', 'config.toml'),
  });
  // Project-scoped config (checked into a repo, or per-project).
  locations.push({
    client: 'Codex CLI (project)',
    configPath: path.join(cwd, '.codex', 'config.toml'),
    untrusted: true,
  });

  return locations;
}

/** Returns only the known config locations whose file actually exists on disk. */
export function discoverExistingConfigs(
  platform: NodeJS.Platform = process.platform,
  homeDir: string = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): KnownConfigLocation[] {
  return getKnownConfigPaths(platform, homeDir, env).filter((loc) => {
    try {
      return fs.statSync(loc.configPath).isFile();
    } catch {
      return false;
    }
  });
}

/** Keys under which different clients nest their server map. Checked in order. */
const SERVER_MAP_KEYS = ['mcpServers', 'servers', 'mcp'];

/**
 * Converts a raw `{ name: { command, args, env, disabled } }` server map
 * (as found under any of `SERVER_MAP_KEYS`, or Codex's `mcp_servers` table)
 * into a flat list of ServerConfig entries. Shared by both the JSON and TOML
 * parsers below so entry-level validation (e.g. the `env` type check) only
 * has to be correct in one place.
 */
function extractServers(
  serverMap: Record<string, unknown>,
  sourcePath: string,
  client: string,
  isDisabled: (entry: Record<string, unknown>) => boolean = (entry) => entry.disabled === true,
): ServerConfig[] {
  const servers: ServerConfig[] = [];
  for (const [name, rawEntry] of Object.entries(serverMap)) {
    if (!rawEntry || typeof rawEntry !== 'object') continue;
    const entry = rawEntry as Record<string, unknown>;
    // Skip disabled entries some clients support (e.g. `"disabled": true`).
    if (isDisabled(entry)) continue;
    const command = typeof entry.command === 'string' ? entry.command : undefined;
    if (!command) continue; // skip non-stdio (e.g. url-based/sse) entries - out of scope for now
    const args = Array.isArray(entry.args) ? entry.args.map(String) : [];
    // Arrays are `typeof ... === 'object'` too, so explicitly exclude them -
    // otherwise a malformed `"env": ["FOO=bar"]` (instead of the correct
    // `{"FOO": "bar"}`) would be cast straight through and later spread into
    // the spawned process's environment as numeric-keyed garbage.
    const env =
      entry.env && typeof entry.env === 'object' && !Array.isArray(entry.env)
        ? (entry.env as Record<string, string>)
        : undefined;
    servers.push({ name, command, args, env, source: sourcePath, client });
  }
  return servers;
}

/**
 * Parses the JSON text of an MCP client config file into a flat list of
 * ServerConfig entries. Pure function - takes raw text in, so it's trivial
 * to unit test against inline fixture strings without touching the
 * filesystem.
 *
 * `cwd` defaults to the same value `getKnownConfigPaths` uses for
 * project-scoped locations, and is only consulted for Claude Code's
 * `~/.claude.json`-style shape (see below) - it's a no-op for every other
 * client's config format.
 */
export function parseMcpConfigText(
  text: string,
  sourcePath: string,
  client: string,
  cwd: string = process.env.MCP_METER_CWD ?? process.cwd(),
): ServerConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`invalid JSON in ${sourcePath}: ${(err as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return [];
  }
  const obj = parsed as Record<string, unknown>;

  const servers = new Map<string, ServerConfig>();

  // Top-level `mcpServers`/`servers`/`mcp` key: Claude Desktop, Cursor,
  // Windsurf, and Claude Code's "user" (global) scope all nest servers here.
  let serverMap: Record<string, unknown> | undefined;
  for (const key of SERVER_MAP_KEYS) {
    const candidate = obj[key];
    if (candidate && typeof candidate === 'object') {
      serverMap = candidate as Record<string, unknown>;
      break;
    }
  }
  if (serverMap) {
    for (const server of extractServers(serverMap, sourcePath, client)) {
      servers.set(server.name, server);
    }
  }

  // Claude Code's per-project ("local" scope - the *default* scope for
  // `claude mcp add` when no `--scope` is given) servers are nested under
  // `projects["<absolute-cwd>"].mcpServers` in the very same ~/.claude.json
  // file, not under a top-level key at all. Without this, the single most
  // common Claude Code MCP setup is invisible to discovery. Local scope
  // wins on a name collision with a user-scope server of the same name,
  // matching Claude Code's own precedence.
  const projects = obj.projects;
  if (projects && typeof projects === 'object') {
    const projectEntry = (projects as Record<string, unknown>)[cwd];
    if (projectEntry && typeof projectEntry === 'object') {
      const localServerMap = (projectEntry as Record<string, unknown>).mcpServers;
      if (localServerMap && typeof localServerMap === 'object') {
        for (const server of extractServers(
          localServerMap as Record<string, unknown>,
          sourcePath,
          `${client} (local)`,
        )) {
          servers.set(server.name, server);
        }
      }
    }
  }

  return Array.from(servers.values());
}

/**
 * Parses the TOML text of a Codex CLI `config.toml` file into a flat list of
 * ServerConfig entries. Pure function - takes raw text in, mirroring
 * parseMcpConfigText, so it's trivial to unit test against inline fixture
 * strings without touching the filesystem.
 *
 * Codex declares servers as `[mcp_servers.<name>]` tables with `command`,
 * optional `args`/`env`, and an optional `enabled` flag (default true).
 */
export function parseCodexConfigText(text: string, sourcePath: string, client: string): ServerConfig[] {
  let parsed: unknown;
  try {
    parsed = parseToml(text);
  } catch (err) {
    throw new Error(`invalid TOML in ${sourcePath}: ${(err as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return [];
  }
  const obj = parsed as Record<string, unknown>;
  const serverMap = obj.mcp_servers;
  if (!serverMap || typeof serverMap !== 'object') return [];

  // Codex servers are enabled by default; skip ones explicitly turned off
  // (the TOML analogue of the `"disabled": true` convention used elsewhere).
  return extractServers(
    serverMap as Record<string, unknown>,
    sourcePath,
    client,
    (entry) => entry.enabled === false,
  );
}

/** Reads and parses a single config file from disk. Dispatches to the TOML
 * parser for `.toml` files (Codex CLI) and the JSON parser for everything
 * else. */
export function loadServersFromConfigFile(
  configPath: string,
  client = 'custom',
  cwd: string = process.env.MCP_METER_CWD ?? process.cwd(),
): ServerConfig[] {
  const text = fs.readFileSync(configPath, 'utf8');
  if (path.extname(configPath).toLowerCase() === '.toml') {
    return parseCodexConfigText(text, configPath, client);
  }
  return parseMcpConfigText(text, configPath, client, cwd);
}

/** Env var users can set - after reviewing the config in question - to opt
 * in to auto-discovering (and thus, via the CLI, auto-spawning) MCP servers
 * declared in project-scoped config locations (see `untrusted` on
 * `KnownConfigLocation`). Accepts `1` or `true` (case-insensitive); anything
 * else, including unset, means untrusted. */
const TRUST_CWD_ENV_VAR = 'MCP_METER_TRUST_CWD';

function isCwdConfigTrusted(env: NodeJS.ProcessEnv): boolean {
  const value = env[TRUST_CWD_ENV_VAR];
  return value === '1' || value?.toLowerCase() === 'true';
}

/**
 * Auto-discovers all MCP servers configured across every known client on
 * this machine. Missing files are silently skipped; malformed files produce
 * a warning on stderr but never throw.
 *
 * Project-scoped config locations (see `untrusted` on `KnownConfigLocation`)
 * are skipped - with a warning - unless the caller has opted in via
 * `MCP_METER_TRUST_CWD=1`. Unlike global/user configs, these live in the
 * current working directory and so can be authored by anyone who gets a
 * victim to run mcp-meter there (e.g. a cloned repo); loading them
 * unconditionally would let an attacker-controlled `.mcp.json` get its
 * `command`/`args` spawned with zero confirmation, which is exactly the
 * workspace-trust check real MCP clients require before ever executing a
 * project-level config.
 */
export function discoverAllServers(
  platform: NodeJS.Platform = process.platform,
  homeDir: string = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): ServerConfig[] {
  const found = discoverExistingConfigs(platform, homeDir, env);
  const cwd = env.MCP_METER_CWD ?? process.cwd();
  const trustCwd = isCwdConfigTrusted(env);
  const servers: ServerConfig[] = [];
  for (const loc of found) {
    if (loc.untrusted && !trustCwd) {
      process.stderr.write(
        `mcp-meter: warning: skipping untrusted project-scoped config at ${loc.configPath} ` +
          `(anyone who gets you to run mcp-meter in this directory - e.g. a cloned repo - could have ` +
          `authored it) - review it, then set ${TRUST_CWD_ENV_VAR}=1 to include it\n`,
      );
      continue;
    }
    try {
      servers.push(...loadServersFromConfigFile(loc.configPath, loc.client, cwd));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`mcp-meter: warning: could not parse ${loc.configPath}: ${(err as Error).message}`);
    }
  }
  return servers;
}
