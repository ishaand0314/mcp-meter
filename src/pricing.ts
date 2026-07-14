/**
 * Static, illustrative per-model pricing table.
 *
 * IMPORTANT: These numbers are hand-entered snapshots for a handful of
 * representative models and are almost certainly stale by the time you read
 * this. They exist purely so MCP Meter can show an order-of-magnitude
 * "what would this standing overhead cost me per month" projection across a
 * few different models a user might route their agent to.
 *
 * Always verify current pricing against the provider's official pricing
 * page before making purchasing or budgeting decisions:
 *   - OpenAI:     https://openai.com/api/pricing/
 *   - Anthropic:  https://www.anthropic.com/pricing#api
 *   - Google:     https://ai.google.dev/gemini-api/docs/pricing
 */

export interface ModelPricing {
  /** Human-readable display name. */
  label: string;
  /** Price in USD per 1,000,000 INPUT tokens. Input tokens are what tool
   * schemas consume, since they're injected into context, not generated. */
  inputPricePerMillion: number;
}

/**
 * A small, representative set of models. Not exhaustive, not authoritative -
 * illustrative only. Last hand-checked: 2025 (see module doc comment above).
 */
export const PRICING_TABLE: Record<string, ModelPricing> = {
  'gpt-4o': {
    label: 'GPT-4o',
    inputPricePerMillion: 2.5,
  },
  'gpt-4o-mini': {
    label: 'GPT-4o mini',
    inputPricePerMillion: 0.15,
  },
  'claude-sonnet': {
    label: 'Claude Sonnet',
    inputPricePerMillion: 3.0,
  },
  'claude-haiku': {
    label: 'Claude Haiku',
    inputPricePerMillion: 0.8,
  },
  'gemini-flash': {
    label: 'Gemini Flash',
    inputPricePerMillion: 0.075,
  },
  'gemini-pro': {
    label: 'Gemini Pro',
    inputPricePerMillion: 1.25,
  },
};

/** The models shown by default in cost projections, in display order. */
export const DEFAULT_PROJECTION_MODELS = [
  'gpt-4o',
  'claude-sonnet',
  'gemini-flash',
];

export function getModelPricing(modelKey: string): ModelPricing | undefined {
  return PRICING_TABLE[modelKey];
}
