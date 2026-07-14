# MCP Meter

Find out how many tokens your MCP servers are quietly adding to every single agent turn.

[![npm version](https://img.shields.io/npm/v/mcp-meter.svg)](https://www.npmjs.com/package/mcp-meter)
[![CI](https://github.com/ishaand0314/mcp-meter/actions/workflows/ci.yml/badge.svg)](https://github.com/ishaand0314/mcp-meter/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-source--available-blue.svg)](https://github.com/ishaand0314/mcp-meter/blob/main/LICENSE)

## Why this exists

Every MCP server you connect to an agent registers a set of tools, and every one of those tool definitions — name, description, and JSON input schema — gets injected into the model's context on **every single turn**, before you've typed a word. Add a few servers and that overhead adds up fast, silently, on every request you send. Running MCP Meter against its own bundled demo dataset (`npx mcp-meter --demo`), six typical MCP servers (filesystem, GitHub, Postgres, Slack, a browser, and a memory graph) come out to **3,309 tokens injected per turn** — roughly **$12–15/month** in pure standing overhead at a modest 50 turns/day, before the model has done any actual work. MCP Meter measures your real, configured servers the same way, in seconds, without you writing a single prompt.

## Quick Start

```bash
npx mcp-meter --demo
```

This runs entirely offline against a bundled example dataset, so you can see exactly what a report looks like before pointing it at your own machine.

## Installation

```bash
npm install -g mcp-meter
```

Or run it without installing anything:

```bash
npx mcp-meter
```

With no flags, MCP Meter auto-discovers MCP server configs already on your machine (see [Supported clients](#supported-clients) below) and reports on all of them.

## Usage

```
Usage: mcp-meter [options]

Measures the token and dollar cost that your installed MCP servers' tool schemas
add to every single agent turn, before you even type a prompt.

Options:
  -V, --version             output the version number
  --config <path>           use this specific MCP client config file instead of
                            auto-discovery
  --demo                    analyze the bundled offline demo dataset instead of
                            discovering/spawning real servers
  --server <name>           scope analysis to just one configured server by name
  --turns-per-day <n>       assumed request volume used for the $ projection
                            (default: "50")
  --json                    machine-readable JSON output instead of the table
  --markdown                GitHub-flavored markdown table output
  --html <path>             also write a self-contained static HTML report to
                            this path
  --diff <otherConfigPath>  also analyze a second config and print a delta
                            report vs. the primary target
  --max-tokens <n>          exit non-zero if total tokens exceed this (for CI
                            gating)
  --badge <serverName>      print a standalone SVG badge for one server's token
                            count instead of the full report
  -h, --help                display help for command
```

### Examples

```bash
# Auto-discover every MCP client config on this machine
mcp-meter

# Point at one specific config file (any client's format)
mcp-meter --config ~/.cursor/mcp.json

# Only look at one server by name
mcp-meter --config ~/.cursor/mcp.json --server github

# Machine-readable output for scripting
mcp-meter --json > report.json

# GitHub-flavored markdown, handy for pasting into a PR description
mcp-meter --markdown

# Write a self-contained static HTML report alongside the terminal output
mcp-meter --html report.html

# Compare two configs (e.g. before/after adding a server)
mcp-meter --config ./mcp.before.json --diff ./mcp.after.json

# Fail CI if standing tool-schema overhead crosses a budget
mcp-meter --max-tokens 5000

# Assume a different request volume when projecting monthly cost
mcp-meter --turns-per-day 200

# Print a standalone SVG badge for one server (e.g. to embed in its own README)
mcp-meter --badge filesystem > filesystem-badge.svg
```

## Example Output

```
MCP Meter — tool schema token overhead report
(analyzing bundled --demo dataset — see provenance note at the bottom)

SERVER                  TOOLS  TOKENS/TURN
----------------------  -----  -----------
filesystem                 14        1,456
git-github                  8          731
postgres                    5          354
memory-knowledge-graph      5          299
slack                       5          242
puppeteer-browser           5          227

TOTAL: 3,309 tokens/turn across 6 server(s)

Projected monthly cost (assuming 50 turns/day × 30 days):
MODEL          EST. MONTHLY COST
-------------  -----------------
GPT-4o                    $12.41
Claude Sonnet             $14.89
Gemini Flash             $0.3723

Verbose description outliers (>2x median tool size, median = 63 tokens):
  - git-github/create_pull_request: 224 tokens
      suggested trim -> 112 tokens (saves ~112); NOT auto-applied
      suggestion: "Open a new pull request. You should use this tool whenever a user asks you to open, file, submit, raise, or otherwise create a pull..."
  ...

Possible redundant tools (similar name+description):
  - filesystem/list_directory  <->  filesystem/list_directory_with_sizes  (similarity 0.78)
  ...
```

(Full run also includes a per-tool breakdown table; output above is trimmed for brevity. Try `npx mcp-meter --demo` yourself to see the complete report.)

## Supported clients

MCP Meter auto-discovers server configs from these clients' well-known config file locations:

| Client | Config path(s) it looks for |
| --- | --- |
| **Claude Desktop** | macOS: `~/Library/Application Support/Claude/claude_desktop_config.json` · Windows: `%APPDATA%/Claude/claude_desktop_config.json` · Linux: `~/.config/Claude/claude_desktop_config.json` |
| **Claude Code** | Global: `~/.claude.json` · Project: `.mcp.json` in the current directory |
| **Cursor** | Global: `~/.cursor/mcp.json` · Project: `.cursor/mcp.json` in the current directory |
| **Windsurf** | Windows: `%APPDATA%/Windsurf/mcp_config.json` · macOS/Linux: `~/.codeium/windsurf/mcp_config.json` |
| **Codex CLI** | Global: `~/.codex/config.toml` · Project: `.codex/config.toml` in the current directory |

Any config file whose top-level shape uses an `mcpServers`, `servers`, or `mcp` map of server entries is understood, so `--config` also works against ad-hoc or hand-written config files in the same shape. Only `stdio`-based servers (defined by a `command` to run) are analyzed; URL/SSE-based server entries are currently skipped, and entries explicitly marked `"disabled": true` are skipped too.

Codex CLI is the one exception to the JSON-shaped rule above: it stores its config as TOML rather than JSON, declaring each server as an `[mcp_servers.<name>]` table with `command`, optional `args`/`env`, and an optional `enabled` flag (servers with `enabled = false` are skipped, mirroring `"disabled": true` for the other clients). Any file with a `.toml` extension — whether auto-discovered or passed via `--config` — is parsed as a Codex-style config.

## How it works

1. **Config discovery** — either reads the file passed via `--config`, or probes the known config locations above and parses each one's server map.
2. **MCP handshake** — for each configured server, spawns its command over stdio and performs the real MCP `initialize` → `tools/list` handshake to fetch its actual tool manifests (name, description, input schema). Any server that fails to spawn, errors, or hangs is skipped gracefully after a 10-second timeout — one bad server never blocks the rest of the report.
3. **Tokenization** — for each tool, the exact JSON payload that gets injected into the model's context (`name` + `description` + `inputSchema`) is tokenized with [`gpt-tokenizer`](https://www.npmjs.com/package/gpt-tokenizer), an OpenAI-compatible BPE tokenizer.
4. **Cost model** — total tokens per turn are projected into a monthly dollar figure across a handful of representative models, at an assumed daily request volume (default 50 turns/day, override with `--turns-per-day`).
5. **Report** — rendered as a terminal table by default, or as JSON, GitHub-flavored markdown, a self-contained static HTML page, or a standalone SVG badge. Every report also surfaces two offender checks: tools whose description is a disproportionate token hog, and pairs of tools that look like near-duplicates of each other.

## Limitations

- **Tokenizer approximation.** MCP Meter uses one consistent OpenAI-compatible tokenizer (`gpt-tokenizer`) for every model so numbers are comparable to each other. Anthropic, Google, and other providers use their own, different tokenizers — non-OpenAI token counts are a close approximation, not an exact match.
- **Pricing is illustrative.** The built-in per-model price table is a small, hand-entered snapshot of a few representative models. It is not exhaustive, not authoritative, and will go stale over time. Always check the provider's official pricing page before making real budgeting decisions.
- **Only stdio servers are analyzed.** Config entries that connect over a URL/SSE transport rather than a local command are currently skipped.
- **Running this executes local code.** To fetch a server's real tool list, MCP Meter spawns that server's command on your machine, the same way your MCP client normally would. See Safety below.

## Safety

MCP Meter spawns the actual command configured for each MCP server in order to talk to it. Only run it against servers you already trust and would be comfortable running yourself — it does not sandbox, review, or vet server code in any way.

## Contributing

Bug reports, feature requests, and discussion are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for how to get started, including the ground rules around pull requests given this project's license.

## License

MCP Meter is **source-available**, not open source in the redistribution sense. You're free to install and run the published npm package for any purpose, including commercially. Forking, redistributing, or publishing copies (modified or not) of this source code elsewhere requires the maintainer's prior written permission. See [LICENSE](LICENSE) for the full terms.
