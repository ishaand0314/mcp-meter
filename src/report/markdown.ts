import { AnalysisResult } from '../types';
import { OffendersReport } from '../analysis/offenders';
import { projectAcrossModels, formatUsd } from '../analysis/cost';
import { UsageOverlay, usedCountFor, usageSummaryLine } from '../analysis/usage';

export interface MarkdownOptions {
  isDemo: boolean;
  /** When set (from --usage-log), adds a "Real usage overlay" section with a
   * per-tool Used column and a dead-weight summary. Absent by default so the
   * default markdown report is unchanged. */
  usage?: UsageOverlay;
}

function formatInt(n: number): string {
  return n.toLocaleString('en-US');
}

/** Renders a GitHub-flavored markdown report, suitable for pasting into a README or PR. */
export function renderMarkdown(
  result: AnalysisResult,
  offenders: OffendersReport,
  options: MarkdownOptions,
): string {
  const lines: string[] = [];
  const activeServers = result.servers.filter((s) => !s.skipped).sort((a, b) => b.totalTokens - a.totalTokens);
  const skippedServers = result.servers.filter((s) => s.skipped);

  lines.push('# MCP Meter report');
  lines.push('');
  if (options.isDemo) {
    lines.push('_Analyzing the bundled `--demo` dataset - see provenance note at the bottom._');
    lines.push('');
  }
  lines.push(
    `**${formatInt(result.totalTokens)} tokens** are injected into context on every single agent turn, before the user types anything, across **${activeServers.length} server(s)**.`,
  );
  lines.push('');

  lines.push('## Per-server breakdown');
  lines.push('');
  lines.push('| Server | Tools | Tokens/turn |');
  lines.push('| --- | ---: | ---: |');
  for (const s of activeServers) {
    lines.push(`| ${s.name} | ${s.tools.length} | ${formatInt(s.totalTokens)} |`);
  }
  lines.push(`| **Total** | **${activeServers.reduce((n, s) => n + s.tools.length, 0)}** | **${formatInt(result.totalTokens)}** |`);
  lines.push('');

  if (options.usage) {
    lines.push('## Real usage overlay');
    lines.push('');
    lines.push(`_${usageSummaryLine(options.usage)}_`);
    lines.push('');
    lines.push('| Server | Tool | Tokens | Used |');
    lines.push('| --- | --- | ---: | ---: |');
    for (const server of activeServers) {
      for (const tool of [...server.tools].sort((a, b) => b.tokens - a.tokens)) {
        lines.push(
          `| ${server.name} | ${tool.name} | ${formatInt(tool.tokens)} | ${formatInt(usedCountFor(options.usage, server.name, tool.name))} |`,
        );
      }
    }
    lines.push('');
  }

  if (skippedServers.length > 0) {
    lines.push('## Skipped servers');
    lines.push('');
    for (const s of skippedServers) {
      lines.push(`- \`${s.name}\`: ${s.skipReason ?? 'unknown error'}`);
    }
    lines.push('');
  }

  lines.push('## Projected monthly cost');
  lines.push('');
  lines.push(`_Assuming ${formatInt(result.turnsPerDay)} turns/day x 30 days. Pricing is illustrative - see \`src/pricing.ts\`._`);
  lines.push('');
  lines.push('| Model | Est. monthly cost |');
  lines.push('| --- | ---: |');
  for (const p of projectAcrossModels(result.totalTokens, result.turnsPerDay)) {
    lines.push(`| ${p.label} | ${formatUsd(p.monthlyCostUsd)} |`);
  }
  lines.push('');

  if (offenders.verboseOutliers.length > 0) {
    lines.push('## Verbose description outliers');
    lines.push('');
    lines.push('_Tools using more than 2x the median tool size. Suggested trims below are naive (~2 sentences / ~25 words) and are suggestions only - never auto-applied._');
    lines.push('');
    lines.push('| Server | Tool | Tokens | Suggested tokens | Potential savings |');
    lines.push('| --- | --- | ---: | ---: | ---: |');
    for (const o of offenders.verboseOutliers) {
      lines.push(
        `| ${o.serverName} | ${o.toolName} | ${formatInt(o.tokens)} | ${formatInt(o.suggestedTokens)} | ${formatInt(o.potentialSavingsTokens)} |`,
      );
    }
    lines.push('');
  }

  if (offenders.redundantPairs.length > 0) {
    lines.push('## Possible redundant tools');
    lines.push('');
    lines.push('| Tool A | Tool B | Similarity |');
    lines.push('| --- | --- | ---: |');
    for (const p of offenders.redundantPairs) {
      lines.push(`| ${p.a.serverName}/${p.a.toolName} | ${p.b.serverName}/${p.b.toolName} | ${p.similarity.toFixed(2)} |`);
    }
    lines.push('');
  }

  if (options.isDemo) {
    lines.push('---');
    lines.push('');
    lines.push(
      '_Provenance: the `filesystem` server above is **live-captured** from a real MCP handshake against `@modelcontextprotocol/server-filesystem`. Every other demo server is **illustrative** example data, not captured from a live server._',
    );
    lines.push('');
  }

  lines.push(
    '_Token counts use `gpt-tokenizer` (an OpenAI-compatible tokenizer) for every model as an approximation; non-OpenAI models (Claude, Gemini, ...) use their own tokenizers, so actual counts will differ somewhat._',
  );

  return lines.join('\n');
}
