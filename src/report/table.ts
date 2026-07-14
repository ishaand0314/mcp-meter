import { AnalysisResult } from '../types';
import { OffendersReport } from '../analysis/offenders';
import { projectAcrossModels } from '../analysis/cost';
import { formatUsd } from '../analysis/cost';
import { UsageOverlay, usedCountFor, usageSummaryLine } from '../analysis/usage';

export interface TableOptions {
  isDemo: boolean;
  /** When set (from --usage-log), adds a "used" column to the per-tool
   * breakdown plus a dead-weight summary line. Absent by default so the
   * default report is byte-for-byte unchanged. */
  usage?: UsageOverlay;
}

function padRight(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function padLeft(s: string, width: number): string {
  return s.length >= width ? s : ' '.repeat(width - s.length) + s;
}

function formatInt(n: number): string {
  return n.toLocaleString('en-US');
}

/** Renders a simple, dependency-free fixed-width text table. */
function renderSimpleTable(headers: string[], rows: string[][], rightAlignCols: Set<number>): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => (rightAlignCols.has(i) ? padLeft(cell, widths[i]) : padRight(cell, widths[i])))
      .join('  ');
  const separator = widths.map((w) => '-'.repeat(w)).join('  ');
  const out = [line(headers), separator, ...rows.map(line)];
  return out.join('\n');
}

export function renderTable(
  result: AnalysisResult,
  offenders: OffendersReport,
  options: TableOptions,
): string {
  const lines: string[] = [];
  lines.push('MCP Meter — tool schema token overhead report');
  if (options.isDemo) {
    lines.push('(analyzing bundled --demo dataset — see provenance note at the bottom)');
  }
  lines.push('');

  const activeServers = result.servers.filter((s) => !s.skipped);
  const skippedServers = result.servers.filter((s) => s.skipped);

  const serverRows = activeServers
    .slice()
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .map((s) => [s.name, String(s.tools.length), formatInt(s.totalTokens)]);
  lines.push(renderSimpleTable(['SERVER', 'TOOLS', 'TOKENS/TURN'], serverRows, new Set([1, 2])));
  lines.push('');
  lines.push(`TOTAL: ${formatInt(result.totalTokens)} tokens/turn across ${activeServers.length} server(s)`);

  if (skippedServers.length > 0) {
    lines.push('');
    lines.push(`Skipped ${skippedServers.length} server(s) (see stderr warnings for details):`);
    for (const s of skippedServers) {
      lines.push(`  - ${s.name}: ${s.skipReason ?? 'unknown error'}`);
    }
  }

  lines.push('');
  lines.push('Per-tool breakdown:');
  const toolRows: string[][] = [];
  for (const server of activeServers) {
    for (const tool of [...server.tools].sort((a, b) => b.tokens - a.tokens)) {
      const row = [server.name, tool.name, formatInt(tool.tokens)];
      if (options.usage) {
        row.push(formatInt(usedCountFor(options.usage, server.name, tool.name)));
      }
      toolRows.push(row);
    }
  }
  const toolHeaders = options.usage ? ['SERVER', 'TOOL', 'TOKENS', 'USED'] : ['SERVER', 'TOOL', 'TOKENS'];
  const toolRightAlign = options.usage ? new Set([2, 3]) : new Set([2]);
  lines.push(renderSimpleTable(toolHeaders, toolRows, toolRightAlign));

  if (options.usage) {
    lines.push('');
    lines.push(usageSummaryLine(options.usage));
  }

  lines.push('');
  lines.push(`Projected monthly cost (assuming ${formatInt(result.turnsPerDay)} turns/day × 30 days):`);
  const projections = projectAcrossModels(result.totalTokens, result.turnsPerDay);
  const costRows = projections.map((p) => [p.label, formatUsd(p.monthlyCostUsd)]);
  lines.push(renderSimpleTable(['MODEL', 'EST. MONTHLY COST'], costRows, new Set([1])));

  if (offenders.verboseOutliers.length > 0) {
    lines.push('');
    lines.push(`Verbose description outliers (>2x median tool size, median = ${formatInt(offenders.verboseOutliers[0].medianTokens)} tokens):`);
    for (const o of offenders.verboseOutliers) {
      lines.push(`  - ${o.serverName}/${o.toolName}: ${formatInt(o.tokens)} tokens`);
      lines.push(
        `      suggested trim -> ${formatInt(o.suggestedTokens)} tokens (saves ~${formatInt(o.potentialSavingsTokens)}); NOT auto-applied`,
      );
      lines.push(`      suggestion: "${o.suggestedDescription}"`);
    }
  }

  if (offenders.redundantPairs.length > 0) {
    lines.push('');
    lines.push('Possible redundant tools (similar name+description):');
    for (const p of offenders.redundantPairs) {
      lines.push(
        `  - ${p.a.serverName}/${p.a.toolName}  <->  ${p.b.serverName}/${p.b.toolName}  (similarity ${p.similarity.toFixed(2)})`,
      );
    }
  }

  if (options.isDemo) {
    lines.push('');
    lines.push('Provenance: the "filesystem" server above is LIVE-CAPTURED from a real MCP');
    lines.push('handshake against @modelcontextprotocol/server-filesystem. Every other demo');
    lines.push('server is ILLUSTRATIVE example data, not captured from a live server.');
  }

  lines.push('');
  lines.push(
    'Note: token counts use gpt-tokenizer (OpenAI-compatible BPE) for all models as an approximation; ' +
      'non-OpenAI models (Claude, Gemini, ...) use their own tokenizers and actual counts will differ somewhat.',
  );

  return lines.join('\n');
}
