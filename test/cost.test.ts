import { describe, it, expect } from 'vitest';
import { projectMonthlyCost, projectAcrossModels, formatUsd, DEFAULT_TURNS_PER_DAY } from '../src/analysis/cost';

describe('projectMonthlyCost', () => {
  it('computes tokens_per_turn * turns_per_day * 30 / 1e6 * price_per_million', () => {
    // 1000 tokens/turn, 50 turns/day, $2 per million tokens.
    // 1000 * 50 * 30 / 1e6 * 2 = 1500000 / 1e6 * 2 = 1.5 * 2 = 3
    const cost = projectMonthlyCost(1000, 50, 2);
    expect(cost).toBeCloseTo(3, 6);
  });

  it('returns 0 for 0 tokens', () => {
    expect(projectMonthlyCost(0, 50, 5)).toBe(0);
  });

  it('scales linearly with turns per day', () => {
    const a = projectMonthlyCost(1000, 10, 1);
    const b = projectMonthlyCost(1000, 20, 1);
    expect(b).toBeCloseTo(a * 2, 6);
  });

  it('uses the default turns-per-day constant of 50', () => {
    expect(DEFAULT_TURNS_PER_DAY).toBe(50);
  });
});

describe('projectAcrossModels', () => {
  it('returns a projection entry for each known model key', () => {
    const results = projectAcrossModels(1000, 50, ['gpt-4o', 'claude-sonnet']);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.modelKey)).toEqual(['gpt-4o', 'claude-sonnet']);
    for (const r of results) {
      expect(r.monthlyCostUsd).toBeGreaterThan(0);
      expect(typeof r.label).toBe('string');
    }
  });

  it('silently skips unknown model keys', () => {
    const results = projectAcrossModels(1000, 50, ['gpt-4o', 'totally-made-up-model']);
    expect(results).toHaveLength(1);
    expect(results[0].modelKey).toBe('gpt-4o');
  });

  it('uses the default model list when none is provided', () => {
    const results = projectAcrossModels(1000, 50);
    expect(results.length).toBeGreaterThan(0);
  });
});

describe('formatUsd', () => {
  it('formats large amounts with no decimals', () => {
    expect(formatUsd(150)).toBe('$150');
  });

  it('formats amounts >= 1 with two decimals', () => {
    expect(formatUsd(4.5)).toBe('$4.50');
  });

  it('formats small amounts with four decimals', () => {
    expect(formatUsd(0.0031)).toBe('$0.0031');
  });
});
