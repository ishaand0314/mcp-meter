import { AnalysisResult } from '../types';

export type DiffStatus = 'added' | 'removed' | 'changed' | 'unchanged';

export interface ServerDiffEntry {
  serverName: string;
  baseTokens: number;
  otherTokens: number;
  deltaTokens: number;
  status: DiffStatus;
}

export interface DiffResult {
  entries: ServerDiffEntry[];
  baseTotalTokens: number;
  otherTotalTokens: number;
  deltaTotalTokens: number;
}

/**
 * Compares two analysis results (e.g. two different MCP client configs, or
 * the same config before/after a change) and produces a per-server delta
 * report: tokens added, removed, or changed, plus the net change overall.
 */
export function diffAnalyses(base: AnalysisResult, other: AnalysisResult): DiffResult {
  const baseByName = new Map(base.servers.filter((s) => !s.skipped).map((s) => [s.name, s.totalTokens]));
  const otherByName = new Map(other.servers.filter((s) => !s.skipped).map((s) => [s.name, s.totalTokens]));

  const allNames = new Set([...baseByName.keys(), ...otherByName.keys()]);
  const entries: ServerDiffEntry[] = [];

  for (const serverName of allNames) {
    const baseTokens = baseByName.get(serverName) ?? 0;
    const otherTokens = otherByName.get(serverName) ?? 0;
    const deltaTokens = otherTokens - baseTokens;
    let status: DiffStatus;
    if (!baseByName.has(serverName)) status = 'added';
    else if (!otherByName.has(serverName)) status = 'removed';
    else if (deltaTokens !== 0) status = 'changed';
    else status = 'unchanged';
    entries.push({ serverName, baseTokens, otherTokens, deltaTokens, status });
  }

  entries.sort((a, b) => Math.abs(b.deltaTokens) - Math.abs(a.deltaTokens));

  const baseTotalTokens = base.totalTokens;
  const otherTotalTokens = other.totalTokens;

  return {
    entries,
    baseTotalTokens,
    otherTotalTokens,
    deltaTotalTokens: otherTotalTokens - baseTotalTokens,
  };
}
