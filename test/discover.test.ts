import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  getKnownConfigPaths,
  parseMcpConfigText,
  parseCodexConfigText,
  loadServersFromConfigFile,
  discoverAllServers,
} from '../src/config/discover';

describe('parseMcpConfigText', () => {
  it('parses a standard mcpServers config', () => {
    const text = JSON.stringify({
      mcpServers: {
        filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'] },
        git: { command: 'uvx', args: ['mcp-server-git'], env: { FOO: 'bar' } },
      },
    });
    const servers = parseMcpConfigText(text, '/fake/path.json', 'Claude Desktop');
    expect(servers).toHaveLength(2);
    expect(servers[0]).toMatchObject({
      name: 'filesystem',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      source: '/fake/path.json',
      client: 'Claude Desktop',
    });
    expect(servers[1]).toMatchObject({ name: 'git', command: 'uvx', env: { FOO: 'bar' } });
  });

  it('supports the alternate "servers" and "mcp" top-level keys', () => {
    const servers = parseMcpConfigText(
      JSON.stringify({ servers: { a: { command: 'a-cmd' } } }),
      '/fake/servers.json',
      'test',
    );
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe('a');

    const mcpServers = parseMcpConfigText(
      JSON.stringify({ mcp: { b: { command: 'b-cmd' } } }),
      '/fake/mcp.json',
      'test',
    );
    expect(mcpServers).toHaveLength(1);
    expect(mcpServers[0].name).toBe('b');
  });

  it('skips entries with disabled: true', () => {
    const servers = parseMcpConfigText(
      JSON.stringify({
        mcpServers: {
          enabled: { command: 'cmd' },
          off: { command: 'cmd', disabled: true },
        },
      }),
      '/fake/path.json',
      'test',
    );
    expect(servers.map((s) => s.name)).toEqual(['enabled']);
  });

  it('skips entries without a command (e.g. url-based/sse servers)', () => {
    const servers = parseMcpConfigText(
      JSON.stringify({
        mcpServers: {
          stdioServer: { command: 'cmd' },
          remoteServer: { url: 'https://example.com/mcp' },
        },
      }),
      '/fake/path.json',
      'test',
    );
    expect(servers.map((s) => s.name)).toEqual(['stdioServer']);
  });

  it('returns an empty array when no server map key is present', () => {
    const servers = parseMcpConfigText(JSON.stringify({ somethingElse: true }), '/fake/path.json', 'test');
    expect(servers).toEqual([]);
  });

  it('throws a clear error on invalid JSON', () => {
    expect(() => parseMcpConfigText('{ not valid json', '/fake/bad.json', 'test')).toThrow(/invalid JSON/);
  });

  it('defaults args to an empty array when omitted', () => {
    const servers = parseMcpConfigText(
      JSON.stringify({ mcpServers: { noargs: { command: 'cmd' } } }),
      '/fake/path.json',
      'test',
    );
    expect(servers[0].args).toEqual([]);
  });

  it('rejects a malformed array `env` value instead of passing it through as bogus env vars', () => {
    const servers = parseMcpConfigText(
      JSON.stringify({ mcpServers: { bad: { command: 'cmd', env: ['FOO=bar'] } } }),
      '/fake/path.json',
      'test',
    );
    expect(servers).toHaveLength(1);
    expect(servers[0].env).toBeUndefined();
  });

  it('discovers Claude Code "local" scope servers nested under projects["<cwd>"].mcpServers', () => {
    // This mirrors the real ~/.claude.json shape written by `claude mcp add`
    // with no --scope flag (the default is "local", not "user"): the server
    // ends up nested under `projects[cwd].mcpServers`, not under a top-level
    // `mcpServers` key.
    const text = JSON.stringify({
      mcpServers: {},
      projects: {
        '/home/user/myproject': {
          mcpServers: {
            localServer: { command: 'npx', args: ['-y', 'some-server'] },
          },
        },
        '/home/user/otherproject': {
          mcpServers: { unrelated: { command: 'nope' } },
        },
      },
    });
    const servers = parseMcpConfigText(text, '/home/user/.claude.json', 'Claude Code', '/home/user/myproject');
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({ name: 'localServer', command: 'npx' });
  });

  it('returns nothing local-scoped when the projects entry has no key matching the current cwd', () => {
    const text = JSON.stringify({
      mcpServers: {},
      projects: {
        '/home/user/otherproject': { mcpServers: { unrelated: { command: 'nope' } } },
      },
    });
    const servers = parseMcpConfigText(text, '/home/user/.claude.json', 'Claude Code', '/home/user/myproject');
    expect(servers).toEqual([]);
  });

  it('merges top-level (user scope) and projects[cwd] (local scope) servers, with local scope winning on a name collision', () => {
    const text = JSON.stringify({
      mcpServers: { shared: { command: 'user-cmd' }, userOnly: { command: 'u' } },
      projects: {
        '/proj': { mcpServers: { shared: { command: 'local-cmd' }, localOnly: { command: 'l' } } },
      },
    });
    const servers = parseMcpConfigText(text, '/home/user/.claude.json', 'Claude Code', '/proj');
    expect(servers.map((s) => s.name).sort()).toEqual(['localOnly', 'shared', 'userOnly']);
    expect(servers.find((s) => s.name === 'shared')?.command).toBe('local-cmd');
  });
});

describe('parseCodexConfigText', () => {
  it('parses a valid Codex config.toml with multiple servers', () => {
    const text = `
[mcp_servers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]

[mcp_servers.git]
command = "uvx"
args = ["mcp-server-git"]

[mcp_servers.git.env]
FOO = "bar"
`;
    const servers = parseCodexConfigText(text, '/fake/config.toml', 'Codex CLI');
    expect(servers).toHaveLength(2);
    expect(servers[0]).toMatchObject({
      name: 'filesystem',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      source: '/fake/config.toml',
      client: 'Codex CLI',
    });
    expect(servers[1]).toMatchObject({ name: 'git', command: 'uvx', env: { FOO: 'bar' } });
  });

  it('skips entries with enabled = false', () => {
    const text = `
[mcp_servers.on]
command = "cmd"

[mcp_servers.off]
command = "cmd"
enabled = false
`;
    const servers = parseCodexConfigText(text, '/fake/config.toml', 'Codex CLI');
    expect(servers.map((s) => s.name)).toEqual(['on']);
  });

  it('skips entries without a command', () => {
    const text = `
[mcp_servers.stdioServer]
command = "cmd"

[mcp_servers.noCommand]
required = true
`;
    const servers = parseCodexConfigText(text, '/fake/config.toml', 'Codex CLI');
    expect(servers.map((s) => s.name)).toEqual(['stdioServer']);
  });

  it('returns an empty array when no mcp_servers table is present', () => {
    const servers = parseCodexConfigText('model = "o3"\n', '/fake/config.toml', 'Codex CLI');
    expect(servers).toEqual([]);
  });

  it('throws a clear error on malformed TOML', () => {
    expect(() =>
      parseCodexConfigText('[mcp_servers.broken\ncommand = "cmd"', '/fake/bad.toml', 'Codex CLI'),
    ).toThrow(/invalid TOML/);
  });

  it('defaults args to an empty array when omitted', () => {
    const servers = parseCodexConfigText(
      '[mcp_servers.noargs]\ncommand = "cmd"\n',
      '/fake/config.toml',
      'Codex CLI',
    );
    expect(servers[0].args).toEqual([]);
  });

  it('rejects a malformed array `env` value instead of passing it through as bogus env vars', () => {
    const text = '[mcp_servers.bad]\ncommand = "cmd"\nenv = ["FOO=bar"]\n';
    const servers = parseCodexConfigText(text, '/fake/config.toml', 'Codex CLI');
    expect(servers).toHaveLength(1);
    expect(servers[0].env).toBeUndefined();
  });
});

describe('loadServersFromConfigFile', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-meter-test-'));
  const tmpFile = path.join(tmpDir, 'config.json');
  const tmpTomlFile = path.join(tmpDir, 'config.toml');

  afterEach(() => {
    if (fs.existsSync(tmpFile)) fs.rmSync(tmpFile);
    if (fs.existsSync(tmpTomlFile)) fs.rmSync(tmpTomlFile);
  });

  it('reads and parses a real config file from disk', () => {
    fs.writeFileSync(
      tmpFile,
      JSON.stringify({ mcpServers: { demo: { command: 'echo', args: ['hi'] } } }),
      'utf8',
    );
    const servers = loadServersFromConfigFile(tmpFile, 'Cursor');
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({ name: 'demo', command: 'echo', client: 'Cursor', source: tmpFile });
  });

  it('reads and parses a real Codex TOML config file from disk based on its .toml extension', () => {
    fs.writeFileSync(tmpTomlFile, '[mcp_servers.demo]\ncommand = "echo"\nargs = ["hi"]\n', 'utf8');
    const servers = loadServersFromConfigFile(tmpTomlFile, 'Codex CLI');
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({
      name: 'demo',
      command: 'echo',
      client: 'Codex CLI',
      source: tmpTomlFile,
    });
  });

  it('handles a missing config file gracefully (throws a catchable error, same as other clients)', () => {
    const missingFile = path.join(tmpDir, 'does-not-exist.toml');
    expect(() => loadServersFromConfigFile(missingFile, 'Codex CLI')).toThrow();
  });
});

describe('getKnownConfigPaths', () => {
  const homeDir = '/home/testuser';

  it('includes a macOS Claude Desktop path on darwin', () => {
    const locations = getKnownConfigPaths('darwin', homeDir, {});
    const claudeDesktop = locations.find((l) => l.client === 'Claude Desktop');
    expect(claudeDesktop?.configPath).toBe(
      path.join(homeDir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    );
  });

  it('includes a Linux Claude Desktop path on linux', () => {
    const locations = getKnownConfigPaths('linux', homeDir, {});
    const claudeDesktop = locations.find((l) => l.client === 'Claude Desktop');
    expect(claudeDesktop?.configPath).toBe(path.join(homeDir, '.config', 'Claude', 'claude_desktop_config.json'));
  });

  it('includes a Windows Claude Desktop path using APPDATA on win32', () => {
    const locations = getKnownConfigPaths('win32', homeDir, { APPDATA: 'C:\\Users\\test\\AppData\\Roaming' });
    const claudeDesktop = locations.find((l) => l.client === 'Claude Desktop');
    expect(claudeDesktop?.configPath).toBe(
      path.join('C:\\Users\\test\\AppData\\Roaming', 'Claude', 'claude_desktop_config.json'),
    );
  });

  it('includes Claude Code, Cursor, Windsurf, and Codex CLI locations', () => {
    const locations = getKnownConfigPaths('linux', homeDir, {});
    const clients = locations.map((l) => l.client);
    expect(clients).toContain('Claude Code');
    expect(clients).toContain('Cursor');
    expect(clients).toContain('Windsurf');
    expect(clients).toContain('Codex CLI');
  });

  it('includes project-scoped configs relative to the current working directory', () => {
    const locations = getKnownConfigPaths('linux', homeDir, { MCP_METER_CWD: '/my/project' });
    const projectCursor = locations.find((l) => l.client === 'Cursor (project)');
    expect(projectCursor?.configPath).toBe(path.join('/my/project', '.cursor', 'mcp.json'));
    const projectCodex = locations.find((l) => l.client === 'Codex CLI (project)');
    expect(projectCodex?.configPath).toBe(path.join('/my/project', '.codex', 'config.toml'));
  });

  it('includes a global Codex CLI config.toml path under the home directory', () => {
    const locations = getKnownConfigPaths('linux', homeDir, {});
    const codex = locations.find((l) => l.client === 'Codex CLI');
    expect(codex?.configPath).toBe(path.join(homeDir, '.codex', 'config.toml'));
  });

  it('marks cwd-derived project-scoped locations as untrusted, unlike home-directory (global) locations', () => {
    const locations = getKnownConfigPaths('linux', homeDir, { MCP_METER_CWD: '/my/project' });
    expect(locations.find((l) => l.client === 'Claude Code (project)')?.untrusted).toBe(true);
    expect(locations.find((l) => l.client === 'Cursor (project)')?.untrusted).toBe(true);
    expect(locations.find((l) => l.client === 'Codex CLI (project)')?.untrusted).toBe(true);

    expect(locations.find((l) => l.client === 'Claude Code')?.untrusted).toBeFalsy();
    expect(locations.find((l) => l.client === 'Cursor')?.untrusted).toBeFalsy();
    expect(locations.find((l) => l.client === 'Codex CLI')?.untrusted).toBeFalsy();
  });
});

describe('discoverAllServers', () => {
  const mkTmpDir = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

  it('does not load project-scoped (cwd) configs by default, even if present on disk', () => {
    const tmpHome = mkTmpDir('mcp-meter-home-');
    const tmpProject = mkTmpDir('mcp-meter-project-');
    try {
      fs.writeFileSync(
        path.join(tmpProject, '.mcp.json'),
        JSON.stringify({ mcpServers: { evil: { command: 'echo', args: ['pwned'] } } }),
      );
      const servers = discoverAllServers('linux', tmpHome, { MCP_METER_CWD: tmpProject });
      expect(servers.find((s) => s.name === 'evil')).toBeUndefined();
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true });
      fs.rmSync(tmpProject, { recursive: true, force: true });
    }
  });

  it('loads project-scoped (cwd) configs once explicitly trusted via MCP_METER_TRUST_CWD=1', () => {
    const tmpHome = mkTmpDir('mcp-meter-home-');
    const tmpProject = mkTmpDir('mcp-meter-project-');
    try {
      fs.writeFileSync(
        path.join(tmpProject, '.mcp.json'),
        JSON.stringify({ mcpServers: { trusted: { command: 'echo', args: ['ok'] } } }),
      );
      const servers = discoverAllServers('linux', tmpHome, {
        MCP_METER_CWD: tmpProject,
        MCP_METER_TRUST_CWD: '1',
      });
      expect(servers.find((s) => s.name === 'trusted')).toBeDefined();
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true });
      fs.rmSync(tmpProject, { recursive: true, force: true });
    }
  });

  it('still loads global (home-directory) configs regardless of the project trust setting', () => {
    const tmpHome = mkTmpDir('mcp-meter-home-');
    const tmpProject = mkTmpDir('mcp-meter-project-');
    try {
      fs.writeFileSync(
        path.join(tmpHome, '.claude.json'),
        JSON.stringify({ mcpServers: { global: { command: 'echo', args: ['global'] } } }),
      );
      const servers = discoverAllServers('linux', tmpHome, { MCP_METER_CWD: tmpProject });
      expect(servers.find((s) => s.name === 'global')).toBeDefined();
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true });
      fs.rmSync(tmpProject, { recursive: true, force: true });
    }
  });
});
