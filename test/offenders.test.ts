import { describe, it, expect } from 'vitest';
import { diceCoefficient, suggestTrim, detectOffenders, toolSimilarity } from '../src/analysis/offenders';
import { ServerAnalysis, ToolAnalysis } from '../src/types';

function makeTool(name: string, description: string, tokens: number): ToolAnalysis {
  return { name, description, tokens, raw: { name, description, inputSchema: {} } };
}

function makeServer(name: string, tools: ToolAnalysis[]): ServerAnalysis {
  return {
    name,
    tools,
    totalTokens: tools.reduce((sum, t) => sum + t.tokens, 0),
    skipped: false,
  };
}

describe('diceCoefficient', () => {
  it('returns 1 for identical strings', () => {
    expect(diceCoefficient('read a file', 'read a file')).toBe(1);
  });

  it('returns 0 for completely dissimilar strings', () => {
    expect(diceCoefficient('abcdefgh', 'zzzzzzzz')).toBe(0);
  });

  it('is symmetric', () => {
    expect(diceCoefficient('read_file', 'read_text_file')).toBeCloseTo(
      diceCoefficient('read_text_file', 'read_file'),
      10,
    );
  });

  it('gives a high score for near-duplicate tool descriptions', () => {
    const a = 'read the complete contents of a file as text';
    const b = 'read the complete contents of a file as text, handling encoding';
    expect(diceCoefficient(a, b)).toBeGreaterThan(0.7);
  });

  it('handles very short / empty strings without throwing', () => {
    expect(diceCoefficient('', '')).toBe(1);
    expect(diceCoefficient('a', 'ab')).toBeGreaterThanOrEqual(0);
  });
});

describe('suggestTrim', () => {
  it('returns short descriptions unchanged', () => {
    const desc = 'Read a file.';
    expect(suggestTrim(desc)).toBe(desc);
  });

  it('caps to the first two sentences', () => {
    const desc = 'First sentence here. Second sentence here. Third sentence should be dropped.';
    const trimmed = suggestTrim(desc);
    expect(trimmed).toContain('First sentence here.');
    expect(trimmed).toContain('Second sentence here.');
    expect(trimmed).not.toContain('Third sentence');
  });

  it('caps to roughly 25 words even within two sentences', () => {
    const longSentence = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ') + '.';
    const trimmed = suggestTrim(longSentence);
    const wordCount = trimmed.replace(/\.\.\.$/, '').trim().split(/\s+/).length;
    expect(wordCount).toBeLessThanOrEqual(25);
  });

  it('returns empty input unchanged', () => {
    expect(suggestTrim('')).toBe('');
  });
});

describe('toolSimilarity', () => {
  it('weighs name similarity alongside description similarity', () => {
    const a = makeTool('read_file', 'Read the complete contents of a file as text. Deprecated.', 20);
    const b = makeTool(
      'read_text_file',
      'Read the complete contents of a file from the file system as text, handling various encodings and providing detailed error messages, only within allowed directories.',
      170,
    );
    // Full-text Dice on the whole (name + long description) would be diluted
    // by the huge length mismatch; weighting name similarity recovers the match.
    expect(toolSimilarity(a, b)).toBeGreaterThan(0.6);
  });

  it('returns a low score for genuinely unrelated tools', () => {
    const a = makeTool('post_message', 'Post a new message to a Slack channel.', 15);
    const b = makeTool('list_schemas', 'List all schemas in the connected database.', 12);
    expect(toolSimilarity(a, b)).toBeLessThan(0.3);
  });
});

describe('detectOffenders', () => {
  it('flags tools with more than 2x the median token count as verbose outliers', () => {
    const servers: ServerAnalysis[] = [
      makeServer('svc', [
        makeTool('a', 'short a', 10),
        makeTool('b', 'short b', 12),
        makeTool('c', 'short c', 11),
        makeTool('huge', 'a very very very very verbose description that goes on and on', 100),
      ]),
    ];
    const { verboseOutliers } = detectOffenders(servers);
    expect(verboseOutliers).toHaveLength(1);
    expect(verboseOutliers[0].toolName).toBe('huge');
    expect(verboseOutliers[0].potentialSavingsTokens).toBeGreaterThanOrEqual(0);
  });

  it('does not flag anything when all tools are similarly sized', () => {
    const servers: ServerAnalysis[] = [
      makeServer('svc', [makeTool('a', 'short a', 10), makeTool('b', 'short b', 11), makeTool('c', 'short c', 9)]),
    ];
    const { verboseOutliers } = detectOffenders(servers);
    expect(verboseOutliers).toHaveLength(0);
  });

  it('flags near-duplicate tools across servers as possibly redundant', () => {
    const servers: ServerAnalysis[] = [
      makeServer('fs1', [makeTool('read_file', 'Read the complete contents of a file as text', 20)]),
      makeServer('fs2', [
        makeTool('read_text_file', 'Read the complete contents of a file as text from disk', 22),
      ]),
    ];
    const { redundantPairs } = detectOffenders(servers);
    expect(redundantPairs.length).toBeGreaterThan(0);
    expect(redundantPairs[0].similarity).toBeGreaterThan(0.6);
  });

  it('skips skipped servers entirely', () => {
    const servers: ServerAnalysis[] = [
      makeServer('active', [makeTool('a', 'desc', 10)]),
      { name: 'broken', tools: [], totalTokens: 0, skipped: true, skipReason: 'timeout' },
    ];
    const { verboseOutliers, redundantPairs } = detectOffenders(servers);
    expect(verboseOutliers).toEqual([]);
    expect(redundantPairs).toEqual([]);
  });
});
