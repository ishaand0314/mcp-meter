# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- `--usage-log <path>` to overlay real tool-call counts from an agent session transcript on top of the static report. Supports Claude Code's local session JSONL format (`~/.claude/projects/**/*.jsonl`, including its `mcp__<server>__<tool>` namespaced tool names) and a generic fallback JSON array of `{"tool": "name"}` records for any other client. Every report format (table, JSON, markdown, HTML) gains a per-tool `used` count and a summary callout showing how many tools, and how many tokens, were never called in that session.
- `--watch` to keep MCP Meter running after the first report: it watches the resolved config file(s) for changes and automatically re-analyzes and reprints the report whenever they're modified, with a debounced re-run trigger and graceful Ctrl+C handling. Has no effect with `--demo`, since there is no config file to watch.

## [0.1.0] - 2026-07-14

Initial release.

- Auto-discovery of MCP server configs for Claude Desktop, Claude Code, Cursor, and Windsurf, plus explicit config selection via `--config`.
- Real MCP `initialize` → `tools/list` handshake over stdio for each configured server, with a 10-second per-server timeout and graceful skipping of servers that fail to spawn, error, or hang.
- Token counting of each tool's exact context payload (name, description, input schema) via `gpt-tokenizer`.
- Monthly dollar cost projection across a set of representative models (GPT-4o, Claude Sonnet, Gemini Flash, and others), driven by an assumed daily turn volume (`--turns-per-day`, default 50).
- `--server` to scope a run to a single configured server by name.
- Output formats: terminal table (default), `--json`, `--markdown` (GitHub-flavored), and `--html` for a self-contained static HTML report with an inline stacked bar chart.
- `--badge <serverName>` to print a standalone SVG token-count badge for a single server.
- `--diff <otherConfigPath>` to compare two configs and print an added/changed/removed/unchanged delta report.
- `--max-tokens <n>` to exit non-zero when total tokens exceed a budget, for CI gating.
- Offender detection: verbose description outliers (tools using more than 2x the median tool size, with a naive suggested trim) and possible redundant tool pairs (via blended name+description similarity).
- `--demo` mode: a bundled, fully offline example dataset across six representative MCP servers, so the tool can be evaluated with zero setup and zero risk.
