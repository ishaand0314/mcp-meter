import { encode } from 'gpt-tokenizer';
import { ToolManifest } from '../types';

/**
 * Tokenizes arbitrary text using gpt-tokenizer (the OpenAI cl100k/o200k
 * family of BPE tokenizers implemented in pure JS).
 *
 * NOTE: gpt-tokenizer implements OpenAI's tokenizer. Anthropic (Claude),
 * Google (Gemini), and other providers use their own, different tokenizers.
 * Token counts for non-OpenAI models are therefore an APPROXIMATION -
 * typically within the right order of magnitude, but not exact. We use one
 * consistent tokenizer across all models so the numbers are at least
 * comparable to each other.
 */
export function tokenize(text: string): number[] {
  if (!text) return [];
  return encode(text);
}

/** Returns the token count for a string. */
export function countTokens(text: string): number {
  return tokenize(text).length;
}

/**
 * Builds the canonical JSON payload MCP Meter measures for a single tool:
 * name + description + inputSchema, exactly as it would be injected into
 * the model's context by the MCP client on every turn.
 */
export function toolPayload(tool: ToolManifest): string {
  return JSON.stringify({
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema ?? {},
  });
}

/** Counts the tokens a single tool definition contributes to every turn. */
export function countToolTokens(tool: ToolManifest): number {
  return countTokens(toolPayload(tool));
}
