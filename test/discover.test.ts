import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  getKnownConfigPaths,
  parseMcpConfigText,
  loadServersFromConfigFile,
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
});

describe('loadServersFromConfigFile', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-meter-test-'));
  const tmpFile = path.join(tmpDir, 'config.json');

  afterEach(() => {
    if (fs.existsSync(tmpFile)) fs.rmSync(tmpFile);
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

  it('includes Claude Code, Cursor, and Windsurf locations', () => {
    const locations = getKnownConfigPaths('linux', homeDir, {});
    const clients = locations.map((l) => l.client);
    expect(clients).toContain('Claude Code');
    expect(clients).toContain('Cursor');
    expect(clients).toContain('Windsurf');
  });

  it('includes project-scoped configs relative to the current working directory', () => {
    const locations = getKnownConfigPaths('linux', homeDir, { MCP_METER_CWD: '/my/project' });
    const projectCursor = locations.find((l) => l.client === 'Cursor (project)');
    expect(projectCursor?.configPath).toBe(path.join('/my/project', '.cursor', 'mcp.json'));
  });
});
