import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parse as parseToml } from 'smol-toml';
import { ServerConfig } from '../types';

export interface KnownConfigLocation {
  client: string;
  configPath: string;
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
  });

  // --- Cursor ---
  locations.push({
    client: 'Cursor',
    configPath: path.join(homeDir, '.cursor', 'mcp.json'),
  });
  locations.push({
    client: 'Cursor (project)',
    configPath: path.join(cwd, '.cursor', 'mcp.json'),
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
 * Parses the JSON text of an MCP client config file into a flat list of
 * ServerConfig entries. Pure function - takes raw text in, so it's trivial
 * to unit test against inline fixture strings without touching the
 * filesystem.
 */
export function parseMcpConfigText(text: string, sourcePath: string, client: string): ServerConfig[] {
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
  let serverMap: Record<string, unknown> | undefined;
  for (const key of SERVER_MAP_KEYS) {
    const candidate = obj[key];
    if (candidate && typeof candidate === 'object') {
      serverMap = candidate as Record<string, unknown>;
      break;
    }
  }
  if (!serverMap) return [];

  const servers: ServerConfig[] = [];
  for (const [name, rawEntry] of Object.entries(serverMap)) {
    if (!rawEntry || typeof rawEntry !== 'object') continue;
    const entry = rawEntry as Record<string, unknown>;
    // Skip disabled entries some clients support (e.g. `"disabled": true`).
    if (entry.disabled === true) continue;
    const command = typeof entry.command === 'string' ? entry.command : undefined;
    if (!command) continue; // skip non-stdio (e.g. url-based/sse) entries - out of scope for now
    const args = Array.isArray(entry.args) ? entry.args.map(String) : [];
    const env =
      entry.env && typeof entry.env === 'object' ? (entry.env as Record<string, string>) : undefined;
    servers.push({ name, command, args, env, source: sourcePath, client });
  }
  return servers;
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

  const servers: ServerConfig[] = [];
  for (const [name, rawEntry] of Object.entries(serverMap as Record<string, unknown>)) {
    if (!rawEntry || typeof rawEntry !== 'object') continue;
    const entry = rawEntry as Record<string, unknown>;
    // Codex servers are enabled by default; skip ones explicitly turned off
    // (the TOML analogue of the `"disabled": true` convention above).
    if (entry.enabled === false) continue;
    const command = typeof entry.command === 'string' ? entry.command : undefined;
    if (!command) continue; // skip entries missing a stdio command
    const args = Array.isArray(entry.args) ? entry.args.map(String) : [];
    const env =
      entry.env && typeof entry.env === 'object' ? (entry.env as Record<string, string>) : undefined;
    servers.push({ name, command, args, env, source: sourcePath, client });
  }
  return servers;
}

/** Reads and parses a single config file from disk. Dispatches to the TOML
 * parser for `.toml` files (Codex CLI) and the JSON parser for everything
 * else. */
export function loadServersFromConfigFile(configPath: string, client = 'custom'): ServerConfig[] {
  const text = fs.readFileSync(configPath, 'utf8');
  if (path.extname(configPath).toLowerCase() === '.toml') {
    return parseCodexConfigText(text, configPath, client);
  }
  return parseMcpConfigText(text, configPath, client);
}

/**
 * Auto-discovers all MCP servers configured across every known client on
 * this machine. Missing files are silently skipped; malformed files produce
 * a warning on stderr but never throw.
 */
export function discoverAllServers(): ServerConfig[] {
  const found = discoverExistingConfigs();
  const servers: ServerConfig[] = [];
  for (const loc of found) {
    try {
      servers.push(...loadServersFromConfigFile(loc.configPath, loc.client));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`mcp-meter: warning: could not parse ${loc.configPath}: ${(err as Error).message}`);
    }
  }
  return servers;
}
