import { describe, it, expect } from 'vitest';
import { tokenize, countTokens, toolPayload, countToolTokens } from '../src/analysis/tokenize';
import { ToolManifest } from '../src/types';

describe('tokenize', () => {
  it('returns an empty array for empty input', () => {
    expect(tokenize('')).toEqual([]);
    expect(countTokens('')).toBe(0);
  });

  it('produces a positive token count for non-empty text', () => {
    const tokens = tokenize('hello world');
    expect(tokens.length).toBeGreaterThan(0);
    expect(countTokens('hello world')).toBe(tokens.length);
  });

  it('produces more tokens for longer text', () => {
    const short = countTokens('a short description');
    const long = countTokens(
      'a much longer and more verbose description that repeats itself several times over ' +
        'in order to pad out the token count considerably beyond the short version above',
    );
    expect(long).toBeGreaterThan(short);
  });

  it('is deterministic for the same input', () => {
    const text = 'This is a deterministic tokenizer test string.';
    expect(countTokens(text)).toBe(countTokens(text));
  });
});

describe('toolPayload', () => {
  it('serializes name, description, and inputSchema', () => {
    const tool: ToolManifest = {
      name: 'read_file',
      description: 'Reads a file.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    };
    const payload = JSON.parse(toolPayload(tool));
    expect(payload).toEqual({
      name: 'read_file',
      description: 'Reads a file.',
      inputSchema: tool.inputSchema,
    });
  });

  it('defaults missing description and inputSchema', () => {
    const tool: ToolManifest = { name: 'no_extras' };
    const payload = JSON.parse(toolPayload(tool));
    expect(payload).toEqual({ name: 'no_extras', description: '', inputSchema: {} });
  });
});

describe('countToolTokens', () => {
  it('counts more tokens for a tool with a verbose description', () => {
    const concise: ToolManifest = {
      name: 'search',
      description: 'Search files.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    };
    const verbose: ToolManifest = {
      name: 'search',
      description:
        'Search for files matching a given query pattern across the entire filesystem, recursively ' +
        'traversing every subdirectory, respecting ignore rules, and returning full paths for every match found.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    };
    expect(countToolTokens(verbose)).toBeGreaterThan(countToolTokens(concise));
  });

  it('returns a stable, reasonable count for a small known tool', () => {
    const tool: ToolManifest = { name: 'ping', description: 'Pings.', inputSchema: {} };
    const tokens = countToolTokens(tool);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(50);
  });
});
