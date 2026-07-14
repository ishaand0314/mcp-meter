import * as fs from 'fs';
import { ServerAnalysis } from '../types';

/**
 * A single real tool invocation extracted from a usage log, after stripping
 * any `mcp__<server>__<tool>` namespace prefix Claude Code applies to MCP
 * tool names.
 */
export interface UsageRecord {
  /** The tool name exactly as it appeared in the log. */
  rawName: string;
  /** Server name extracted from an `mcp__<server>__<tool>` prefix, if present. */
  serverName?: string;
  /** Bare tool name, with any `mcp__<server>__` namespace prefix stripped. */
  toolName: string;
}

/**
 * Per-tool usage counts cross-referenced against a main analysis run, plus
 * the "dead weight" summary shared by every report format.
 */
export interface UsageOverlay {
  /** Invocation count keyed by `${serverName}::${toolName}`. */
  usedByKey: Map<string, number>;
  /** Total number of (server, tool) pairs considered (across active servers). */
  totalTools: number;
  /** How many of those were never invoked in the log. */
  neverCalledCount: number;
  /** Combined standing token cost of every never-called tool. */
  neverCalledTokens: number;
  /** Total number of tool_use records recognized while parsing the log
   * (whether or not they matched a configured tool). */
  totalInvocationsParsed: number;
}

const MCP_NAMESPACE_RE = /^mcp__(.+?)__(.+)$/;

/**
 * Splits a possibly-namespaced tool name (Claude Code's `mcp__<server>__<tool>`
 * convention for MCP-provided tools) into its bare tool name plus, if
 * present, the server name it was called under.
 */
function splitNamespacedToolName(rawName: string): UsageRecord {
  const match = MCP_NAMESPACE_RE.exec(rawName);
  if (match) {
    return { rawName, serverName: match[1], toolName: match[2] };
  }
  return { rawName, toolName: rawName };
}

/**
 * Parses a real agent session transcript into a flat list of tool
 * invocation records. Supports two formats, auto-detected from the content:
 *
 *  - Claude Code's local session JSONL format
 *    (`~/.claude/projects/**\/*.jsonl`): one JSON object per line; assistant
 *    turns carry a `message.content` array, some entries of which are
 *    `{"type": "tool_use", "name": "..."}` blocks. A bare top-level
 *    `{"type": "tool_use", "name": "..."}` line is also accepted, in case a
 *    caller passes an already-flattened log.
 *  - A generic fallback format, for any other client/log source: a single
 *    JSON array of `{"tool": "name"}` records.
 *
 * Malformed individual JSONL lines are skipped rather than failing the whole
 * parse (real transcripts are large and can be truncated mid-write); a
 * malformed top-level generic-format array throws, since there is nothing
 * sensible to fall back to once we've committed to that format.
 */
export function parseUsageLog(text: string): UsageRecord[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    return parseGenericUsageLog(trimmed);
  }
  return parseClaudeCodeUsageLog(trimmed);
}

function parseGenericUsageLog(trimmed: string): UsageRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new Error(`invalid usage log JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('generic usage log must be a JSON array of {"tool": "..."} records');
  }
  const records: UsageRecord[] = [];
  for (const entry of parsed) {
    if (entry && typeof entry === 'object' && typeof (entry as Record<string, unknown>).tool === 'string') {
      records.push(splitNamespacedToolName((entry as Record<string, unknown>).tool as string));
    }
  }
  return records;
}

function parseClaudeCodeUsageLog(trimmed: string): UsageRecord[] {
  const records: UsageRecord[] = [];
  for (const line of trimmed.split('\n')) {
    const lineTrimmed = line.trim();
    if (!lineTrimmed) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(lineTrimmed);
    } catch {
      continue; // ignore malformed/non-JSON lines rather than failing the whole log
    }
    if (!obj || typeof obj !== 'object') continue;
    const entry = obj as Record<string, unknown>;

    // A bare top-level tool_use block (already-flattened logs).
    if (entry.type === 'tool_use' && typeof entry.name === 'string') {
      records.push(splitNamespacedToolName(entry.name));
      continue;
    }

    // The standard Claude Code shape: an assistant turn with a content array,
    // some entries of which are tool_use blocks.
    if (entry.type !== 'assistant') continue;
    const message = entry.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (
        block &&
        typeof block === 'object' &&
        (block as Record<string, unknown>).type === 'tool_use' &&
        typeof (block as Record<string, unknown>).name === 'string'
      ) {
        records.push(splitNamespacedToolName((block as Record<string, unknown>).name as string));
      }
    }
  }
  return records;
}

/** Reads and parses a usage log file from disk. */
export function loadUsageLog(filePath: string): UsageRecord[] {
  const text = fs.readFileSync(filePath, 'utf8');
  return parseUsageLog(text);
}

/**
 * Cross-references parsed usage records against the tools actually seen in a
 * main analysis run, matching by bare tool name (any `mcp__<server>__`
 * namespace prefix has already been stripped by parseUsageLog). Invocations
 * that don't match any analyzed tool - e.g. an agent's own built-in tools
 * like Bash or Read - are ignored, since only MCP tool overlap matters here.
 */
export function crossReferenceUsage(servers: ServerAnalysis[], records: UsageRecord[]): UsageOverlay {
  const keysByToolName = new Map<string, string[]>();
  let totalTools = 0;
  for (const server of servers) {
    if (server.skipped) continue;
    for (const tool of server.tools) {
      totalTools++;
      const key = `${server.name}::${tool.name}`;
      const keys = keysByToolName.get(tool.name) ?? [];
      keys.push(key);
      keysByToolName.set(tool.name, keys);
    }
  }

  const usedByKey = new Map<string, number>();
  for (const record of records) {
    const keys = keysByToolName.get(record.toolName);
    if (!keys) continue;
    for (const key of keys) {
      usedByKey.set(key, (usedByKey.get(key) ?? 0) + 1);
    }
  }

  let neverCalledCount = 0;
  let neverCalledTokens = 0;
  for (const server of servers) {
    if (server.skipped) continue;
    for (const tool of server.tools) {
      const key = `${server.name}::${tool.name}`;
      if (!usedByKey.has(key)) {
        neverCalledCount++;
        neverCalledTokens += tool.tokens;
      }
    }
  }

  return {
    usedByKey,
    totalTools,
    neverCalledCount,
    neverCalledTokens,
    totalInvocationsParsed: records.length,
  };
}

/** Looks up the used count for one specific (server, tool) pair. Returns 0
 * (never called) rather than undefined for anything not seen in the log. */
export function usedCountFor(usage: UsageOverlay, serverName: string, toolName: string): number {
  return usage.usedByKey.get(`${serverName}::${toolName}`) ?? 0;
}

/** Builds the one-line "dead weight" summary callout shared by every report format. */
export function usageSummaryLine(usage: UsageOverlay): string {
  return (
    `${usage.neverCalledCount} of ${usage.totalTools} tools were never called in this session — ` +
    `${usage.neverCalledTokens.toLocaleString('en-US')} tokens of pure dead weight every turn.`
  );
}
