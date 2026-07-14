import { AnalysisResult } from '../types';
import { OffendersReport } from '../analysis/offenders';
import { projectAcrossModels } from '../analysis/cost';
import { DiffResult } from '../analysis/diff';
import { UsageOverlay, usedCountFor, usageSummaryLine } from '../analysis/usage';

export interface JsonReportOptions {
  isDemo: boolean;
  diff?: DiffResult;
  /** When set (from --usage-log), adds a "used" field per tool plus a
   * top-level usageSummary block. Absent by default so the default JSON
   * shape is unchanged. */
  usage?: UsageOverlay;
}

/** Builds the machine-readable JSON representation of a full analysis run. */
export function buildJsonReport(
  result: AnalysisResult,
  offenders: OffendersReport,
  options: JsonReportOptions,
): Record<string, unknown> {
  const activeServers = result.servers.filter((s) => !s.skipped);
  const skippedServers = result.servers.filter((s) => s.skipped);

  const report: Record<string, unknown> = {
    totalTokensPerTurn: result.totalTokens,
    turnsPerDay: result.turnsPerDay,
    costProjection: projectAcrossModels(result.totalTokens, result.turnsPerDay),
    servers: activeServers.map((s) => ({
      name: s.name,
      client: s.client,
      totalTokens: s.totalTokens,
      toolCount: s.tools.length,
      liveCaptured: s.liveCaptured ?? false,
      illustrative: s.illustrative ?? false,
      tools: s.tools.map((t) => ({
        name: t.name,
        tokens: t.tokens,
        description: t.description,
        ...(options.usage ? { used: usedCountFor(options.usage, s.name, t.name) } : {}),
      })),
      costProjection: projectAcrossModels(s.totalTokens, result.turnsPerDay),
    })),
    skippedServers: skippedServers.map((s) => ({ name: s.name, reason: s.skipReason })),
    offenders: {
      verboseOutliers: offenders.verboseOutliers,
      redundantPairs: offenders.redundantPairs,
    },
    isDemo: options.isDemo,
  };

  if (options.isDemo) {
    report.provenance = {
      note:
        'The "filesystem" server is live-captured from a real MCP handshake against ' +
        '@modelcontextprotocol/server-filesystem. All other demo servers are illustrative example data.',
    };
  }

  if (options.diff) {
    report.diff = options.diff;
  }

  if (options.usage) {
    report.usageSummary = {
      totalTools: options.usage.totalTools,
      neverCalledCount: options.usage.neverCalledCount,
      neverCalledTokens: options.usage.neverCalledTokens,
      totalInvocationsParsed: options.usage.totalInvocationsParsed,
      note: usageSummaryLine(options.usage),
    };
  }

  return report;
}

export function renderJson(
  result: AnalysisResult,
  offenders: OffendersReport,
  options: JsonReportOptions,
): string {
  return JSON.stringify(buildJsonReport(result, offenders, options), null, 2);
}
