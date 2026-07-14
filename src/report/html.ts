import { AnalysisResult, ServerAnalysis, ToolAnalysis } from '../types';
import { OffendersReport } from '../analysis/offenders';
import { projectAcrossModels, formatUsd } from '../analysis/cost';
import { DEFAULT_PROJECTION_MODELS } from '../pricing';
import { UsageOverlay, usedCountFor, usageSummaryLine } from '../analysis/usage';

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatInt(n: number): string {
  return n.toLocaleString('en-US');
}

// Categorical palette slots (validated 6-slot subset of the reference
// palette; see the dataviz skill's references/palette.md). Colors are wired
// through CSS custom properties so light/dark themes swap in one place.
const SERIES_VARS = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--series-6'];

interface StackSegment {
  label: string;
  tokens: number;
  isOther: boolean;
  otherCount?: number;
}

/** Buckets a server's tools into the top N individually-colored segments
 * plus a single aggregated "other" segment, sorted largest first. */
function buildSegments(tools: ToolAnalysis[], topN = 6): StackSegment[] {
  const sorted = [...tools].sort((a, b) => b.tokens - a.tokens);
  const top = sorted.slice(0, topN);
  const rest = sorted.slice(topN);
  const segments: StackSegment[] = top.map((t) => ({ label: t.name, tokens: t.tokens, isOther: false }));
  if (rest.length > 0) {
    segments.push({
      label: `${rest.length} other tool${rest.length === 1 ? '' : 's'}`,
      tokens: rest.reduce((sum, t) => sum + t.tokens, 0),
      isOther: true,
      otherCount: rest.length,
    });
  }
  return segments;
}

const CHART_WIDTH = 760;
const LEFT_MARGIN = 170;
const RIGHT_MARGIN = 70;
const ROW_HEIGHT = 30;
const ROW_GAP = 14;
const SEGMENT_GAP_PX = 2;
const BAR_AREA_WIDTH = CHART_WIDTH - LEFT_MARGIN - RIGHT_MARGIN;

function buildChartSvg(servers: ServerAnalysis[]): string {
  const maxTotal = Math.max(1, ...servers.map((s) => s.totalTokens));
  const height = servers.length * (ROW_HEIGHT + ROW_GAP) + 30;

  const rows: string[] = [];
  servers.forEach((server, rowIndex) => {
    const y = 20 + rowIndex * (ROW_HEIGHT + ROW_GAP);
    const segments = buildSegments(server.tools);
    const totalWidthPx = (server.totalTokens / maxTotal) * BAR_AREA_WIDTH;

    let cursor = 0;
    const rectMarkup: string[] = [];
    segments.forEach((seg, segIndex) => {
      const share = server.totalTokens > 0 ? seg.tokens / server.totalTokens : 0;
      const rawWidth = share * totalWidthPx;
      const isLast = segIndex === segments.length - 1;
      const width = Math.max(0, isLast ? rawWidth : rawWidth - SEGMENT_GAP_PX);
      const colorClass = seg.isOther ? 'seg-other' : `seg-${(segIndex % SERIES_VARS.length) + 1}`;
      const title = `${server.name} / ${escapeHtml(seg.label)}: ${formatInt(seg.tokens)} tokens`;
      rectMarkup.push(
        `<rect class="bar-seg ${colorClass}" x="${(LEFT_MARGIN + cursor).toFixed(2)}" y="${y}" width="${width.toFixed(2)}" height="${ROW_HEIGHT}" rx="3"><title>${title}</title></rect>`,
      );
      cursor += rawWidth;
    });

    const label = `${escapeHtml(server.name)} (${server.tools.length} tool${server.tools.length === 1 ? '' : 's'})`;
    rows.push(
      `<g class="bar-row">` +
        `<text class="row-label" x="${LEFT_MARGIN - 10}" y="${y + ROW_HEIGHT / 2}" text-anchor="end" dominant-baseline="middle">${label}</text>` +
        rectMarkup.join('') +
        `<text class="row-value" x="${LEFT_MARGIN + totalWidthPx + 8}" y="${y + ROW_HEIGHT / 2}" dominant-baseline="middle">${formatInt(server.totalTokens)}</text>` +
        `</g>`,
    );
  });

  // A light vertical gridline every ~25% of the max scale, for a sense of magnitude.
  const gridLines: string[] = [];
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const x = LEFT_MARGIN + (i / steps) * BAR_AREA_WIDTH;
    gridLines.push(
      `<line class="gridline" x1="${x.toFixed(2)}" y1="10" x2="${x.toFixed(2)}" y2="${height - 10}" />`,
    );
    const value = Math.round((i / steps) * maxTotal);
    gridLines.push(
      `<text class="grid-label" x="${x.toFixed(2)}" y="${height - 2}" text-anchor="middle">${formatInt(value)}</text>`,
    );
  }

  return `<svg class="chart-svg" viewBox="0 0 ${CHART_WIDTH} ${height}" role="img" aria-label="Stacked bar chart of tokens per server, broken down by tool">
    <g class="grid">${gridLines.join('')}</g>
    ${rows.join('\n    ')}
  </svg>`;
}

function buildLegend(): string {
  const items = SERIES_VARS.map(
    (_v, i) => `<span class="legend-item"><span class="legend-swatch seg-${i + 1}"></span>${i + 1}${ordinalSuffix(i + 1)} largest tool</span>`,
  );
  items.push(`<span class="legend-item"><span class="legend-swatch seg-other"></span>Other tools (aggregated)</span>`);
  return `<div class="legend">${items.join('')}</div>`;
}

function ordinalSuffix(n: number): string {
  if (n === 1) return 'st';
  if (n === 2) return 'nd';
  if (n === 3) return 'rd';
  return 'th';
}

function buildOffendersSection(offenders: OffendersReport): string {
  const parts: string[] = [];
  if (offenders.verboseOutliers.length > 0) {
    parts.push('<h2>Verbose description outliers</h2>');
    parts.push(
      '<p class="muted">Tools using more than 2x the median tool size. Suggested trims are naive (~2 sentences / ~25 words) and are suggestions only &mdash; never auto-applied.</p>',
    );
    parts.push('<table class="data-table"><thead><tr><th>Server</th><th>Tool</th><th>Tokens</th><th>Suggested tokens</th><th>Potential savings</th><th>Suggested trim (never auto-applied)</th></tr></thead><tbody>');
    for (const o of offenders.verboseOutliers) {
      parts.push(
        `<tr><td>${escapeHtml(o.serverName)}</td><td>${escapeHtml(o.toolName)}</td><td class="num">${formatInt(o.tokens)}</td><td class="num">${formatInt(o.suggestedTokens)}</td><td class="num">${formatInt(o.potentialSavingsTokens)}</td><td class="muted">${escapeHtml(o.suggestedDescription)}</td></tr>`,
      );
    }
    parts.push('</tbody></table>');
  }
  if (offenders.redundantPairs.length > 0) {
    parts.push('<h2>Possible redundant tools</h2>');
    parts.push('<p class="muted">Tool pairs whose normalized name + description text similarity (Dice coefficient) exceeds the threshold.</p>');
    parts.push('<table class="data-table"><thead><tr><th>Tool A</th><th>Tool B</th><th>Similarity</th></tr></thead><tbody>');
    for (const p of offenders.redundantPairs) {
      parts.push(
        `<tr><td>${escapeHtml(p.a.serverName)}/${escapeHtml(p.a.toolName)}</td><td>${escapeHtml(p.b.serverName)}/${escapeHtml(p.b.toolName)}</td><td class="num">${p.similarity.toFixed(2)}</td></tr>`,
      );
    }
    parts.push('</tbody></table>');
  }
  return parts.join('\n');
}

function buildDataTable(servers: ServerAnalysis[], usage?: UsageOverlay): string {
  const rows: string[] = [];
  for (const server of servers) {
    for (const tool of [...server.tools].sort((a, b) => b.tokens - a.tokens)) {
      const usedCell = usage
        ? `<td class="num">${formatInt(usedCountFor(usage, server.name, tool.name))}</td>`
        : '';
      rows.push(
        `<tr><td>${escapeHtml(server.name)}</td><td>${escapeHtml(tool.name)}</td><td class="num">${formatInt(tool.tokens)}</td>${usedCell}</tr>`,
      );
    }
  }
  const usedHeader = usage ? '<th class="num">Used</th>' : '';
  return `<table class="data-table"><thead><tr><th>Server</th><th>Tool</th><th>Tokens</th>${usedHeader}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

export interface HtmlReportOptions {
  isDemo: boolean;
  /** When set (from --usage-log), adds a "Used" column to the per-tool table
   * plus a dead-weight summary card. Absent by default so the default HTML
   * report is unchanged. */
  usage?: UsageOverlay;
}

/** Renders a fully self-contained static HTML report - inline CSS/SVG only,
 * no external CDN or script dependencies. Opens standalone as a file. */
export function renderHtml(
  result: AnalysisResult,
  offenders: OffendersReport,
  options: HtmlReportOptions,
): string {
  const activeServers = [...result.servers].filter((s) => !s.skipped).sort((a, b) => b.totalTokens - a.totalTokens);
  const skippedServers = result.servers.filter((s) => s.skipped);
  const projections = projectAcrossModels(result.totalTokens, result.turnsPerDay, DEFAULT_PROJECTION_MODELS);
  const headlineModel = projections[0];

  const chartSvg = buildChartSvg(activeServers);
  const legend = buildLegend();
  const offendersHtml = buildOffendersSection(offenders);
  const dataTable = buildDataTable(activeServers, options.usage);
  const usageHtml = options.usage
    ? `<div class="card">
    <h2 style="margin-top:0">Real usage overlay</h2>
    <p>${escapeHtml(usageSummaryLine(options.usage))}</p>
  </div>`
    : '';

  const provenanceHtml = options.isDemo
    ? `<p class="provenance"><strong>Provenance:</strong> the <code>filesystem</code> server above is <strong>live-captured</strong> from a real MCP handshake against <code>@modelcontextprotocol/server-filesystem</code>. Every other demo server is <strong>illustrative</strong> example data, not captured from a live server.</p>`
    : '';

  const skippedHtml =
    skippedServers.length > 0
      ? `<h2>Skipped servers</h2><ul>${skippedServers
          .map((s) => `<li><code>${escapeHtml(s.name)}</code>: ${escapeHtml(s.skipReason ?? 'unknown error')}</li>`)
          .join('')}</ul>`
      : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>MCP Meter report</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {
    color-scheme: light;
    --page: #f9f9f7;
    --surface-1: #fcfcfb;
    --text-primary: #0b0b0b;
    --text-secondary: #52514e;
    --muted: #898781;
    --gridline: #e1e0d9;
    --baseline: #c3c2b7;
    --border: rgba(11,11,11,0.10);
    --series-1: #2a78d6;
    --series-2: #1baf7a;
    --series-3: #eda100;
    --series-4: #008300;
    --series-5: #4a3aa7;
    --series-6: #e34948;
    --series-other: #b6b4ac;
  }
  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) {
      color-scheme: dark;
      --page: #0d0d0d;
      --surface-1: #1a1a19;
      --text-primary: #ffffff;
      --text-secondary: #c3c2b7;
      --muted: #898781;
      --gridline: #2c2c2a;
      --baseline: #383835;
      --border: rgba(255,255,255,0.10);
      --series-1: #3987e5;
      --series-2: #199e70;
      --series-3: #c98500;
      --series-4: #008300;
      --series-5: #9085e9;
      --series-6: #e66767;
      --series-other: #55534d;
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --page: #0d0d0d;
    --surface-1: #1a1a19;
    --text-primary: #ffffff;
    --text-secondary: #c3c2b7;
    --muted: #898781;
    --gridline: #2c2c2a;
    --baseline: #383835;
    --border: rgba(255,255,255,0.10);
    --series-1: #3987e5;
    --series-2: #199e70;
    --series-3: #c98500;
    --series-4: #008300;
    --series-5: #9085e9;
    --series-6: #e66767;
    --series-other: #55534d;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 32px 16px 64px;
    background: var(--page);
    color: var(--text-primary);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .wrap { max-width: 860px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin: 0 0 4px; }
  h2 { font-size: 1.1rem; margin: 32px 0 8px; }
  .subtitle { color: var(--text-secondary); margin: 0 0 24px; }
  .muted { color: var(--text-secondary); font-size: 0.9rem; }
  .card {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px 24px;
    margin-bottom: 20px;
  }
  .headline { display: flex; flex-wrap: wrap; gap: 32px; align-items: baseline; }
  .headline .figure { font-size: 2.6rem; font-weight: 600; line-height: 1; }
  .headline .figure-label { color: var(--text-secondary); font-size: 0.85rem; margin-top: 4px; }
  .headline-item { min-width: 160px; }
  .chart-svg { width: 100%; height: auto; overflow: visible; }
  .row-label { fill: var(--text-secondary); font-size: 12px; }
  .row-value { fill: var(--text-primary); font-size: 12px; font-variant-numeric: tabular-nums; }
  .gridline { stroke: var(--gridline); stroke-width: 1; }
  .grid-label { fill: var(--muted); font-size: 10px; }
  .bar-seg { stroke: var(--surface-1); stroke-width: 0; }
  .seg-1 { fill: var(--series-1); }
  .seg-2 { fill: var(--series-2); }
  .seg-3 { fill: var(--series-3); }
  .seg-4 { fill: var(--series-4); }
  .seg-5 { fill: var(--series-5); }
  .seg-6 { fill: var(--series-6); }
  .seg-other { fill: var(--series-other); }
  .legend { display: flex; flex-wrap: wrap; gap: 12px 20px; margin-top: 12px; font-size: 0.8rem; color: var(--text-secondary); }
  .legend-item { display: inline-flex; align-items: center; gap: 6px; }
  .legend-swatch { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
  table.data-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin: 8px 0 4px; }
  table.data-table th, table.data-table td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--gridline); }
  table.data-table td.num, table.data-table th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .cost-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  .cost-table th, .cost-table td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--gridline); }
  .cost-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .provenance { font-size: 0.85rem; color: var(--text-secondary); border-top: 1px solid var(--gridline); padding-top: 16px; margin-top: 32px; }
  .note { font-size: 0.8rem; color: var(--muted); margin-top: 24px; }
  code { background: var(--gridline); padding: 1px 5px; border-radius: 4px; font-size: 0.85em; }
</style>
</head>
<body>
<div class="wrap">
  <h1>MCP Meter report</h1>
  <p class="subtitle">Standing tool-schema token &amp; cost overhead for your MCP servers, injected into context on every single agent turn.</p>

  <div class="card headline">
    <div class="headline-item">
      <div class="figure">${formatInt(result.totalTokens)}</div>
      <div class="figure-label">tokens injected every turn (${activeServers.length} server${activeServers.length === 1 ? '' : 's'})</div>
    </div>
    ${headlineModel ? `<div class="headline-item">
      <div class="figure">${formatUsd(headlineModel.monthlyCostUsd)}</div>
      <div class="figure-label">projected monthly cost on ${escapeHtml(headlineModel.label)} at ${formatInt(result.turnsPerDay)} turns/day</div>
    </div>` : ''}
  </div>

  <div class="card">
    <h2 style="margin-top:0">Tokens per server, by tool</h2>
    ${chartSvg}
    ${legend}
    <p class="muted">Segment color encodes each tool's size rank within its own server's bar (largest first) - it does not identify the same tool across different servers. Hover any segment for its exact name and token count; full detail is in the table below.</p>
  </div>

  <div class="card">
    <h2 style="margin-top:0">Projected monthly cost by model</h2>
    <p class="muted">Assuming ${formatInt(result.turnsPerDay)} turns/day &times; 30 days. Pricing is illustrative - see <code>src/pricing.ts</code>.</p>
    <table class="cost-table"><thead><tr><th>Model</th><th class="num">Est. monthly cost</th></tr></thead><tbody>
      ${projections.map((p) => `<tr><td>${escapeHtml(p.label)}</td><td class="num">${formatUsd(p.monthlyCostUsd)}</td></tr>`).join('\n      ')}
    </tbody></table>
  </div>

  <div class="card">
    ${offendersHtml || '<p class="muted">No offenders detected.</p>'}
  </div>

  ${usageHtml}

  <div class="card">
    <h2 style="margin-top:0">Full per-tool breakdown</h2>
    ${dataTable}
  </div>

  ${skippedHtml}

  ${provenanceHtml}

  <p class="note">Token counts use gpt-tokenizer (an OpenAI-compatible BPE tokenizer) for every model as an approximation; non-OpenAI models (Claude, Gemini, ...) use their own tokenizers, so actual counts will differ somewhat. Generated by mcp-meter.</p>
</div>
</body>
</html>
`;
}
