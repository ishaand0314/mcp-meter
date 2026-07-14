#!/usr/bin/env node
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';

import { AnalysisResult, ServerAnalysis, ServerConfig, ToolManifest } from './types';
import { discoverAllServers, loadServersFromConfigFile } from './config/discover';
import { fetchToolsFromServer } from './mcp/client';
import { countToolTokens } from './analysis/tokenize';
import { DEFAULT_TURNS_PER_DAY } from './analysis/cost';
import { detectOffenders } from './analysis/offenders';
import { diffAnalyses } from './analysis/diff';
import { renderTable } from './report/table';
import { renderJson, buildJsonReport } from './report/json';
import { renderMarkdown } from './report/markdown';
import { renderHtml } from './report/html';
import { renderBadge } from './report/badge';
import { DEMO_MANIFESTS } from './fixtures/demo-manifests';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../package.json');

interface CliOptions {
  config?: string;
  demo?: boolean;
  server?: string;
  turnsPerDay: string;
  json?: boolean;
  markdown?: boolean;
  html?: string;
  diff?: string;
  maxTokens?: string;
  badge?: string;
}

/** Turns a list of raw MCP tool manifests into per-tool token analyses. */
function analyzeTools(tools: ToolManifest[]) {
  return tools.map((tool) => ({
    name: tool.name,
    description: typeof tool.description === 'string' ? tool.description : '',
    tokens: countToolTokens(tool),
    raw: tool,
  }));
}

/** Builds the demo analysis result from the bundled fixture dataset. Never
 * touches the filesystem or network - always fast and fully offline. */
function analyzeDemo(serverFilter: string | undefined, turnsPerDay: number): AnalysisResult {
  const manifests = serverFilter
    ? DEMO_MANIFESTS.filter((m) => m.name === serverFilter)
    : DEMO_MANIFESTS;

  const servers: ServerAnalysis[] = manifests.map((manifest) => {
    const tools = analyzeTools(manifest.tools);
    return {
      name: manifest.name,
      client: manifest.client,
      tools,
      totalTokens: tools.reduce((sum, t) => sum + t.tokens, 0),
      skipped: false,
      liveCaptured: manifest.liveCaptured,
      illustrative: manifest.illustrative,
    };
  });

  const totalTokens = servers.reduce((sum, s) => sum + s.totalTokens, 0);
  return { servers, totalTokens, turnsPerDay };
}

/** Spawns and analyzes every configured server, skipping any that fail or
 * time out. Never throws - failures are captured per-server. */
async function analyzeServerConfigs(
  configs: ServerConfig[],
  turnsPerDay: number,
): Promise<AnalysisResult> {
  const servers: ServerAnalysis[] = await Promise.all(
    configs.map(async (config): Promise<ServerAnalysis> => {
      const outcome = await fetchToolsFromServer(config);
      if (!outcome.ok) {
        process.stderr.write(
          `mcp-meter: warning: skipping server "${config.name}" (${config.client}): ${outcome.reason}\n`,
        );
        return {
          name: config.name,
          client: config.client,
          source: config.source,
          tools: [],
          totalTokens: 0,
          skipped: true,
          skipReason: outcome.reason,
        };
      }
      const tools = analyzeTools(outcome.tools);
      return {
        name: config.name,
        client: config.client,
        source: config.source,
        tools,
        totalTokens: tools.reduce((sum, t) => sum + t.tokens, 0),
        skipped: false,
      };
    }),
  );

  const totalTokens = servers.filter((s) => !s.skipped).reduce((sum, s) => sum + s.totalTokens, 0);
  return { servers, totalTokens, turnsPerDay };
}

/** Resolves the set of ServerConfig entries to analyze for a single "target"
 * (either an explicit --config file, or auto-discovery across known clients). */
function resolveServerConfigs(configPath: string | undefined, serverFilter: string | undefined): ServerConfig[] {
  let configs: ServerConfig[];
  if (configPath) {
    const resolved = path.resolve(configPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`config file not found: ${resolved}`);
    }
    configs = loadServersFromConfigFile(resolved, 'custom');
  } else {
    configs = discoverAllServers();
  }
  if (serverFilter) {
    configs = configs.filter((c) => c.name === serverFilter);
  }
  return configs;
}

async function analyzeTarget(
  configPath: string | undefined,
  useDemo: boolean,
  serverFilter: string | undefined,
  turnsPerDay: number,
): Promise<AnalysisResult> {
  if (useDemo) {
    return analyzeDemo(serverFilter, turnsPerDay);
  }
  const configs = resolveServerConfigs(configPath, serverFilter);
  return analyzeServerConfigs(configs, turnsPerDay);
}

function parsePositiveInt(value: string, flagName: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new Error(`${flagName} must be a positive integer, got: ${value}`);
  }
  return n;
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('mcp-meter')
    .description(
      'Measures the token and dollar cost that your installed MCP servers\' tool schemas ' +
        'add to every single agent turn, before you even type a prompt.',
    )
    .version(pkg.version)
    .option('--config <path>', 'use this specific MCP client config file instead of auto-discovery')
    .option('--demo', 'analyze the bundled offline demo dataset instead of discovering/spawning real servers')
    .option('--server <name>', 'scope analysis to just one configured server by name')
    .option('--turns-per-day <n>', 'assumed request volume used for the $ projection', String(DEFAULT_TURNS_PER_DAY))
    .option('--json', 'machine-readable JSON output instead of the table')
    .option('--markdown', 'GitHub-flavored markdown table output')
    .option('--html <path>', 'also write a self-contained static HTML report to this path')
    .option('--diff <otherConfigPath>', 'also analyze a second config and print a delta report vs. the primary target')
    .option('--max-tokens <n>', 'exit non-zero if total tokens exceed this (for CI gating)')
    .option('--badge <serverName>', 'print a standalone SVG badge for one server\'s token count instead of the full report');

  program.parse(process.argv);
  const options = program.opts<CliOptions>();

  let turnsPerDay: number;
  let maxTokens: number | undefined;
  try {
    turnsPerDay = parsePositiveInt(options.turnsPerDay, '--turns-per-day');
    maxTokens = options.maxTokens !== undefined ? parsePositiveInt(options.maxTokens, '--max-tokens') : undefined;
  } catch (err) {
    process.stderr.write(`mcp-meter: error: ${(err as Error).message}\n`);
    process.exitCode = 1;
    return;
  }

  let primary: AnalysisResult;
  try {
    primary = await analyzeTarget(options.config, Boolean(options.demo), options.server, turnsPerDay);
  } catch (err) {
    process.stderr.write(`mcp-meter: error: ${(err as Error).message}\n`);
    process.exitCode = 1;
    return;
  }

  if (options.server && primary.servers.length === 0) {
    process.stderr.write(`mcp-meter: error: no server named "${options.server}" was found.\n`);
    process.exitCode = 1;
    return;
  }

  if (!options.demo && !options.config && primary.servers.length === 0) {
    process.stdout.write(
      'mcp-meter: no MCP client configs were found on this machine.\n' +
        'Try `mcp-meter --demo` to see an example report, or `mcp-meter --config <path>` ' +
        'to point at a specific config file.\n',
    );
    return;
  }

  // --badge short-circuits everything else: print only the SVG for one server.
  if (options.badge) {
    const server = primary.servers.find((s) => s.name === options.badge);
    if (!server) {
      process.stderr.write(`mcp-meter: error: no server named "${options.badge}" was found to badge.\n`);
      process.exitCode = 1;
      return;
    }
    if (server.skipped) {
      process.stderr.write(`mcp-meter: error: server "${options.badge}" was skipped: ${server.skipReason}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(renderBadge(server.name, server.totalTokens));
    return;
  }

  const offenders = detectOffenders(primary.servers);

  let diffResult;
  if (options.diff) {
    try {
      const otherConfigs = resolveServerConfigs(options.diff, options.server);
      const other = await analyzeServerConfigs(otherConfigs, turnsPerDay);
      diffResult = diffAnalyses(primary, other);
    } catch (err) {
      process.stderr.write(`mcp-meter: error: --diff failed: ${(err as Error).message}\n`);
      process.exitCode = 1;
      return;
    }
  }

  const isDemo = Boolean(options.demo);

  if (options.json) {
    const report = buildJsonReport(primary, offenders, { isDemo, diff: diffResult });
    process.stdout.write(renderJsonFromReport(report) + '\n');
  } else if (options.markdown) {
    process.stdout.write(renderMarkdown(primary, offenders, { isDemo }) + '\n');
    if (diffResult) {
      process.stdout.write('\n' + renderDiffMarkdown(diffResult) + '\n');
    }
  } else {
    process.stdout.write(renderTable(primary, offenders, { isDemo }) + '\n');
    if (diffResult) {
      process.stdout.write('\n' + renderDiffTable(diffResult) + '\n');
    }
  }

  if (options.html) {
    const htmlPath = path.resolve(options.html);
    const html = renderHtml(primary, offenders, { isDemo });
    fs.writeFileSync(htmlPath, html, 'utf8');
    process.stderr.write(`mcp-meter: wrote HTML report to ${htmlPath}\n`);
  }

  if (maxTokens !== undefined) {
    if (primary.totalTokens > maxTokens) {
      process.stderr.write(
        `mcp-meter: FAIL: total tokens ${primary.totalTokens.toLocaleString('en-US')} exceed --max-tokens ${maxTokens.toLocaleString('en-US')}\n`,
      );
      process.exitCode = 1;
    }
  }
}

function renderJsonFromReport(report: Record<string, unknown>): string {
  return JSON.stringify(report, null, 2);
}

function renderDiffTable(diff: ReturnType<typeof diffAnalyses>): string {
  const lines: string[] = ['Diff vs. --diff target:'];
  for (const entry of diff.entries) {
    const sign = entry.deltaTokens > 0 ? '+' : '';
    lines.push(
      `  ${entry.status.padEnd(9)} ${entry.serverName}: ${entry.baseTokens} -> ${entry.otherTokens} (${sign}${entry.deltaTokens})`,
    );
  }
  const sign = diff.deltaTotalTokens > 0 ? '+' : '';
  lines.push(`  TOTAL: ${diff.baseTotalTokens} -> ${diff.otherTotalTokens} (${sign}${diff.deltaTotalTokens})`);
  return lines.join('\n');
}

function renderDiffMarkdown(diff: ReturnType<typeof diffAnalyses>): string {
  const lines: string[] = ['## Diff vs. --diff target', '', '| Server | Status | Before | After | Delta |', '| --- | --- | ---: | ---: | ---: |'];
  for (const entry of diff.entries) {
    const sign = entry.deltaTokens > 0 ? '+' : '';
    lines.push(`| ${entry.serverName} | ${entry.status} | ${entry.baseTokens} | ${entry.otherTokens} | ${sign}${entry.deltaTokens} |`);
  }
  const sign = diff.deltaTotalTokens > 0 ? '+' : '';
  lines.push(`| **Total** | | ${diff.baseTotalTokens} | ${diff.otherTotalTokens} | ${sign}${diff.deltaTotalTokens} |`);
  return lines.join('\n');
}

main().catch((err) => {
  process.stderr.write(`mcp-meter: unexpected error: ${(err as Error).stack ?? err}\n`);
  process.exitCode = 1;
});
