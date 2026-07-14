import { DEFAULT_PROJECTION_MODELS, getModelPricing } from '../pricing';

export const DEFAULT_TURNS_PER_DAY = 50;
const DAYS_PER_MONTH = 30;

export interface ModelCostProjection {
  modelKey: string;
  label: string;
  /** Projected cost in USD for one month of standing tool-schema overhead. */
  monthlyCostUsd: number;
}

/**
 * Projects the monthly dollar cost of a given number of standing tokens
 * (tokens injected on every single turn, before the user types anything),
 * for a single model.
 *
 * monthly_cost = tokens_per_turn * turns_per_day * days_per_month / 1e6 * price_per_million
 */
export function projectMonthlyCost(
  tokensPerTurn: number,
  turnsPerDay: number,
  pricePerMillion: number,
): number {
  return (tokensPerTurn * turnsPerDay * DAYS_PER_MONTH * pricePerMillion) / 1_000_000;
}

/** Projects monthly cost for a given token count across a set of models
 * (defaults to a representative handful defined in pricing.ts). */
export function projectAcrossModels(
  tokensPerTurn: number,
  turnsPerDay: number = DEFAULT_TURNS_PER_DAY,
  modelKeys: string[] = DEFAULT_PROJECTION_MODELS,
): ModelCostProjection[] {
  const results: ModelCostProjection[] = [];
  for (const modelKey of modelKeys) {
    const pricing = getModelPricing(modelKey);
    if (!pricing) continue;
    results.push({
      modelKey,
      label: pricing.label,
      monthlyCostUsd: projectMonthlyCost(tokensPerTurn, turnsPerDay, pricing.inputPricePerMillion),
    });
  }
  return results;
}

/** Formats a USD amount for terminal/markdown/html display. */
export function formatUsd(amount: number): string {
  if (amount >= 100) return `$${amount.toFixed(0)}`;
  if (amount >= 1) return `$${amount.toFixed(2)}`;
  return `$${amount.toFixed(4)}`;
}
