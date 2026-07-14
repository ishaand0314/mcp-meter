import { describe, it, expect } from 'vitest';
import { parseUsageLog, crossReferenceUsage, usedCountFor, usageSummaryLine } from '../src/analysis/usage';
import { ServerAnalysis, ToolAnalysis } from '../src/types';

function makeTool(name: string, tokens: number): ToolAnalysis {
  return { name, description: '', tokens, raw: { name } };
}

function makeServer(name: string, tools: ToolAnalysis[], skipped = false): ServerAnalysis {
  return { name, tools, totalTokens: tools.reduce((sum, t) => sum + t.tokens, 0), skipped };
}

describe('parseUsageLog', () => {
  it('parses the Claude Code JSONL transcript shape, extracting tool_use blocks from assistant messages', () => {
    const lines = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'ok, reading the file' },
            { type: 'tool_use', id: 't1', name: 'mcp__filesystem__read_text_file', input: { path: '/a' } },
          ],
        },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'ls' } }],
        },
      }),
      'not json at all, should be skipped without aborting the whole parse',
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 't3', name: 'mcp__filesystem__read_text_file', input: {} }],
        },
      }),
    ];

    const records = parseUsageLog(lines.join('\n'));

    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({
      rawName: 'mcp__filesystem__read_text_file',
      serverName: 'filesystem',
      toolName: 'read_text_file',
    });
    expect(records[1]).toMatchObject({ rawName: 'Bash', toolName: 'Bash' });
    expect(records[1].serverName).toBeUndefined();
    expect(records[2].toolName).toBe('read_text_file');
  });

  it('also accepts a bare top-level tool_use line (pre-flattened logs)', () => {
    const line = JSON.stringify({ type: 'tool_use', name: 'mcp__github__create_issue' });
    const records = parseUsageLog(line);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ serverName: 'github', toolName: 'create_issue' });
  });

  it('parses the generic fallback JSON array format', () => {
    const text = JSON.stringify([
      { tool: 'search_repositories' },
      { tool: 'search_repositories' },
      { tool: 'mcp__github__create_issue' },
    ]);
    const records = parseUsageLog(text);
    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({ toolName: 'search_repositories' });
    expect(records[0].serverName).toBeUndefined();
    expect(records[2]).toMatchObject({ serverName: 'github', toolName: 'create_issue' });
  });

  it('ignores non-object / malformed entries in the generic format', () => {
    const text = JSON.stringify([{ tool: 'ok' }, { notTool: 'nope' }, 'not-an-object', 42]);
    const records = parseUsageLog(text);
    expect(records).toHaveLength(1);
    expect(records[0].toolName).toBe('ok');
  });

  it('returns an empty array for an empty or whitespace-only log', () => {
    expect(parseUsageLog('')).toEqual([]);
    expect(parseUsageLog('   \n  ')).toEqual([]);
  });

  it('returns an empty array for a JSONL log with no assistant/tool_use content', () => {
    expect(parseUsageLog('{"tool": "x"}')).toEqual([]);
    expect(parseUsageLog(JSON.stringify({ type: 'user', message: { content: 'hi' } }))).toEqual([]);
  });

  it('throws a clear error for a malformed generic-format array', () => {
    expect(() => parseUsageLog('[ not valid json')).toThrow(/invalid usage log JSON/);
  });
});

describe('crossReferenceUsage', () => {
  const servers: ServerAnalysis[] = [
    makeServer('filesystem', [
      makeTool('read_text_file', 100),
      makeTool('write_file', 50),
      makeTool('list_directory', 20),
    ]),
    makeServer('github', [makeTool('create_issue', 80)]),
  ];

  it('counts how many times each configured tool was actually invoked, stripping the mcp__ namespace prefix', () => {
    const records = parseUsageLog(
      JSON.stringify([
        { tool: 'mcp__filesystem__read_text_file' },
        { tool: 'mcp__filesystem__read_text_file' },
        { tool: 'mcp__github__create_issue' },
      ]),
    );
    const overlay = crossReferenceUsage(servers, records);
    expect(usedCountFor(overlay, 'filesystem', 'read_text_file')).toBe(2);
    expect(usedCountFor(overlay, 'github', 'create_issue')).toBe(1);
    expect(usedCountFor(overlay, 'filesystem', 'write_file')).toBe(0);
  });

  it('computes the never-called dead-weight summary correctly', () => {
    const records = parseUsageLog(JSON.stringify([{ tool: 'read_text_file' }]));
    const overlay = crossReferenceUsage(servers, records);
    expect(overlay.totalTools).toBe(4);
    expect(overlay.neverCalledCount).toBe(3);
    expect(overlay.neverCalledTokens).toBe(50 + 20 + 80);
    expect(usageSummaryLine(overlay)).toContain('3 of 4 tools were never called in this session');
    expect(usageSummaryLine(overlay)).toContain('150 tokens of pure dead weight every turn');
  });

  it('ignores invocations of tools that are not part of any analyzed server (e.g. built-in agent tools)', () => {
    const records = parseUsageLog(JSON.stringify([{ tool: 'Bash' }, { tool: 'Read' }]));
    const overlay = crossReferenceUsage(servers, records);
    expect(overlay.usedByKey.size).toBe(0);
    expect(overlay.neverCalledCount).toBe(4);
  });

  it('excludes skipped servers from both the tool universe and matching', () => {
    const withSkipped: ServerAnalysis[] = [
      ...servers,
      { name: 'broken', tools: [makeTool('should_not_count', 10)], totalTokens: 0, skipped: true },
    ];
    const overlay = crossReferenceUsage(withSkipped, [{ rawName: 'should_not_count', toolName: 'should_not_count' }]);
    expect(overlay.totalTools).toBe(4);
    expect(usedCountFor(overlay, 'broken', 'should_not_count')).toBe(0);
  });

  it('records totalInvocationsParsed as the raw record count regardless of matching', () => {
    const records = parseUsageLog(JSON.stringify([{ tool: 'read_text_file' }, { tool: 'Bash' }]));
    const overlay = crossReferenceUsage(servers, records);
    expect(overlay.totalInvocationsParsed).toBe(2);
  });
});
