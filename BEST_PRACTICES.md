# Writing Lean MCP Servers

A guide for MCP server authors, built directly from the heuristics [MCP Meter](README.md) checks for. Every tool your server exposes gets re-sent — name, description, and full JSON schema — on *every single turn* of every session that has your server configured, whether or not that turn ever calls it. None of this is enforced by the protocol; it's just good citizenship, and it makes your server noticeably better to actually use.

Run `npx mcp-meter --config <path>` (or `--server <name>` to scope to just yours) against a config that includes your server before you publish it. If it comes back clean — no verbose-description flags, no near-duplicate warnings — you're in good shape.

## 1. Keep descriptions short and concrete

MCP Meter flags any tool whose token count is more than 2x the median tool size in a run, and its auto-trim suggestion caps a description at roughly two sentences / 25 words. That's not an arbitrary number — it's the point past which a description is usually restating the tool name, adding marketing language, or documenting edge cases that belong in error messages, not in text that gets sent on every turn.

**Avoid:**
> "This powerful and flexible tool allows you to comprehensively search through files in the filesystem, supporting a wide variety of glob patterns, and can be used whenever you need to find files matching a particular pattern in a directory tree."

**Prefer:**
> "Find files matching a glob pattern under a directory."

Push edge cases and constraints into the JSON Schema (`enum`, `pattern`, `minimum`/`maximum`, required fields) instead of prose — a model reads the schema too, and it's structured, not resent as free text token-for-token in the same bloated way.

## 2. Don't ship near-duplicate tools

MCP Meter flags pairs of tools (within your server or across the servers a user has installed) whose normalized name+description text is suspiciously similar. Two tools that do almost the same thing — `list_files` and `get_directory_listing`, say — cost the user double the standing tokens for one piece of functionality. Consolidate into one tool with an optional parameter instead of two tools with overlapping purposes.

## 3. Split rarely-used tools out of the default set

If your server bundles a large, rarely-needed capability (e.g. an admin/debug tool used once a month) alongside your core tools, every session pays for it on every turn regardless. Consider:
- A separate, optional server for the rarely-used capability, so users only pay for it when they've explicitly opted in.
- For Codex CLI users: document that the optional pieces can be configured with `enabled = false` until needed — a disabled server costs its users nothing.

## 4. Only mark yourself `required` if you mean it

Codex's config supports a `required` flag — if a server marked `required = true` fails to start, the user's entire session fails to start. Don't ask consumers of your server's setup instructions to set this unless your tools are genuinely load-bearing for the workflows you support. Defaulting to "not required" is the better citizen move.

## 5. Watch schema depth, not just description length

Deeply nested or duplicated `inputSchema` definitions (the same nested object repeated across three tools instead of extracted once, or unnecessarily deep optional structures) inflate token count in a way a quick glance at a description won't reveal. When in doubt, run the numbers instead of guessing — that's exactly what MCP Meter's per-tool token breakdown is for.

## Checklist before you publish

- [ ] No tool description flagged as a verbose outlier
- [ ] No near-duplicate tool warnings, in your server alone or alongside commonly-paired servers
- [ ] Rarely-used tools are optional/separable, not bundled into the always-on default
- [ ] `required` is only set where a failed start should really break the session
- [ ] Schema structure reviewed for unnecessary depth/duplication, not just descriptions

If you maintain a popular MCP server and want your before/after numbers featured as a worked example here, open an issue — see [CONTRIBUTING.md](CONTRIBUTING.md).
