import { describe, it, expect } from 'vitest';
import { diffAnalyses } from '../src/analysis/diff';
import { AnalysisResult, ServerAnalysis } from '../src/types';

function server(name: string, totalTokens: number, skipped = false): ServerAnalysis {
  return { name, tools: [], totalTokens, skipped };
}

function result(servers: ServerAnalysis[], turnsPerDay = 50): AnalysisResult {
  return {
    servers,
    totalTokens: servers.filter((s) => !s.skipped).reduce((sum, s) => sum + s.totalTokens, 0),
    turnsPerDay,
  };
}

describe('diffAnalyses', () => {
  it('reports unchanged status for servers with identical token counts', () => {
    const base = result([server('fs', 100)]);
    const other = result([server('fs', 100)]);
    const diff = diffAnalyses(base, other);
    expect(diff.entries).toHaveLength(1);
    expect(diff.entries[0]).toMatchObject({ serverName: 'fs', baseTokens: 100, otherTokens: 100, deltaTokens: 0, status: 'unchanged' });
    expect(diff.deltaTotalTokens).toBe(0);
  });

  it('reports changed status and correct delta when tokens differ', () => {
    const base = result([server('fs', 100)]);
    const other = result([server('fs', 150)]);
    const diff = diffAnalyses(base, other);
    expect(diff.entries[0]).toMatchObject({ deltaTokens: 50, status: 'changed' });
    expect(diff.deltaTotalTokens).toBe(50);
  });

  it('reports added status for a server only present in the other target', () => {
    const base = result([server('fs', 100)]);
    const other = result([server('fs', 100), server('slack', 80)]);
    const diff = diffAnalyses(base, other);
    const slackEntry = diff.entries.find((e) => e.serverName === 'slack');
    expect(slackEntry).toMatchObject({ baseTokens: 0, otherTokens: 80, deltaTokens: 80, status: 'added' });
  });

  it('reports removed status for a server only present in the base target', () => {
    const base = result([server('fs', 100), server('slack', 80)]);
    const other = result([server('fs', 100)]);
    const diff = diffAnalyses(base, other);
    const slackEntry = diff.entries.find((e) => e.serverName === 'slack');
    expect(slackEntry).toMatchObject({ baseTokens: 80, otherTokens: 0, deltaTokens: -80, status: 'removed' });
  });

  it('excludes skipped servers from comparison', () => {
    const base = result([server('fs', 100), server('broken', 0, true)]);
    const other = result([server('fs', 100)]);
    const diff = diffAnalyses(base, other);
    expect(diff.entries.find((e) => e.serverName === 'broken')).toBeUndefined();
  });

  it('sorts entries by absolute delta magnitude, largest first', () => {
    const base = result([server('a', 100), server('b', 100), server('c', 100)]);
    const other = result([server('a', 105), server('b', 400), server('c', 90)]);
    const diff = diffAnalyses(base, other);
    expect(diff.entries.map((e) => e.serverName)).toEqual(['b', 'c', 'a']);
  });

  it('computes total tokens directly from each AnalysisResult', () => {
    const base = result([server('a', 50)], 25);
    const other = result([server('a', 75)], 25);
    const diff = diffAnalyses(base, other);
    expect(diff.baseTotalTokens).toBe(50);
    expect(diff.otherTotalTokens).toBe(75);
    expect(diff.deltaTotalTokens).toBe(25);
  });
});
