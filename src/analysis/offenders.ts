import { ServerAnalysis, ToolAnalysis } from '../types';
import { countToolTokens } from './tokenize';

/** A flattened tool with its owning server name, for cross-server comparisons. */
export interface FlatTool {
  serverName: string;
  tool: ToolAnalysis;
}

export interface VerboseOutlier {
  serverName: string;
  toolName: string;
  tokens: number;
  medianTokens: number;
  /** Naive suggested trim: description capped at ~2 sentences / ~25 words. */
  suggestedDescription: string;
  /** Token count if the suggested trim were applied. */
  suggestedTokens: number;
  /** tokens - suggestedTokens (how much could be saved). */
  potentialSavingsTokens: number;
}

export interface RedundantPair {
  a: { serverName: string; toolName: string };
  b: { serverName: string; toolName: string };
  similarity: number;
}

export interface OffendersReport {
  verboseOutliers: VerboseOutlier[];
  redundantPairs: RedundantPair[];
}

function flattenTools(servers: ServerAnalysis[]): FlatTool[] {
  const flat: FlatTool[] = [];
  for (const server of servers) {
    if (server.skipped) continue;
    for (const tool of server.tools) {
      flat.push({ serverName: server.name, tool });
    }
  }
  return flat;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Naive trim: cap a description to roughly the first two sentences, and to
 * at most ~25 words, whichever is shorter. This is a suggestion for a human
 * to review, never applied automatically.
 */
export function suggestTrim(description: string, maxSentences = 2, maxWords = 25): string {
  if (!description) return description;
  const sentenceMatches = description.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [description];
  const trimmedSentences = sentenceMatches.slice(0, maxSentences).join(' ').trim();
  const words = trimmedSentences.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return trimmedSentences;
  return words.slice(0, maxWords).join(' ') + '...';
}

/**
 * Dice coefficient (bigram-based) string similarity, in [0, 1].
 * A simple, dependency-free approximation of text similarity: no heavy NLP
 * library required. 1.0 means identical bigram sets, 0.0 means no overlap.
 */
export function diceCoefficient(a: string, b: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return na === nb ? 1 : 0;

  const bigrams = (s: string): Map<string, number> => {
    const map = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bigram = s.substring(i, i + 2);
      map.set(bigram, (map.get(bigram) ?? 0) + 1);
    }
    return map;
  };

  const bigramsA = bigrams(na);
  const bigramsB = bigrams(nb);
  let intersection = 0;
  for (const [bigram, countA] of bigramsA) {
    const countB = bigramsB.get(bigram);
    if (countB) intersection += Math.min(countA, countB);
  }
  const totalA = na.length - 1;
  const totalB = nb.length - 1;
  if (totalA + totalB === 0) return 0;
  return (2 * intersection) / (totalA + totalB);
}

const OUTLIER_MULTIPLIER = 2;
export const REDUNDANCY_THRESHOLD = 0.6;

/** Weight given to tool-name similarity vs. description similarity when
 * combining into one redundancy score. Tool names are short and tend to
 * carry most of the "these do the same thing" signal (e.g. `read_file` vs
 * `read_text_file`); full descriptions vary wildly in length, which dilutes
 * plain bigram Dice similarity even for genuinely duplicate tools (a short,
 * deprecated description vs. its long-winded replacement). Weighting name
 * similarity higher recovers those cases while description similarity still
 * contributes and can pull two same-length, near-identical descriptions
 * with dissimilar names into range. */
const NAME_WEIGHT = 0.7;

/**
 * Combined name+description similarity between two tools, in [0, 1]. Still
 * just Dice coefficient under the hood (see diceCoefficient above) - applied
 * to the two fields separately and blended, rather than to one concatenated
 * string, so verbose/short description-length mismatches don't wash out an
 * otherwise obvious naming match.
 */
export function toolSimilarity(a: ToolAnalysis, b: ToolAnalysis): number {
  const nameSim = diceCoefficient(a.name, b.name);
  const descSim = diceCoefficient(a.description ?? '', b.description ?? '');
  return NAME_WEIGHT * nameSim + (1 - NAME_WEIGHT) * descSim;
}

/**
 * Runs offender detection over an entire analysis run:
 *  - "verbose description outlier": any tool whose token count is more than
 *    2x the median tool size across the whole run.
 *  - "possible redundant tools": any two tools (within or across servers)
 *    whose normalized name+description similarity exceeds a threshold.
 */
export function detectOffenders(servers: ServerAnalysis[]): OffendersReport {
  const flat = flattenTools(servers);
  const allTokenCounts = flat.map((f) => f.tool.tokens);
  const medianTokens = median(allTokenCounts);

  const verboseOutliers: VerboseOutlier[] = [];
  if (medianTokens > 0) {
    for (const { serverName, tool } of flat) {
      if (tool.tokens > medianTokens * OUTLIER_MULTIPLIER) {
        const suggestedDescription = suggestTrim(tool.description);
        const suggestedTokens = countToolTokens({
          name: tool.name,
          description: suggestedDescription,
          inputSchema: tool.raw.inputSchema,
        });
        verboseOutliers.push({
          serverName,
          toolName: tool.name,
          tokens: tool.tokens,
          medianTokens,
          suggestedDescription,
          suggestedTokens,
          potentialSavingsTokens: Math.max(0, tool.tokens - suggestedTokens),
        });
      }
    }
  }
  verboseOutliers.sort((a, b) => b.tokens - a.tokens);

  const redundantPairs: RedundantPair[] = [];
  for (let i = 0; i < flat.length; i++) {
    for (let j = i + 1; j < flat.length; j++) {
      const a = flat[i];
      const b = flat[j];
      // Skip comparing a tool to itself across the same server/name.
      if (a.serverName === b.serverName && a.tool.name === b.tool.name) continue;
      const similarity = toolSimilarity(a.tool, b.tool);
      if (similarity >= REDUNDANCY_THRESHOLD) {
        redundantPairs.push({
          a: { serverName: a.serverName, toolName: a.tool.name },
          b: { serverName: b.serverName, toolName: b.tool.name },
          similarity,
        });
      }
    }
  }
  redundantPairs.sort((a, b) => b.similarity - a.similarity);

  return { verboseOutliers, redundantPairs };
}
