# Security Policy

## Reporting a vulnerability

If you find a security issue in MCP Meter, please report it privately rather than opening a public issue.

- Preferred: open a [private GitHub Security Advisory](https://github.com/ishaand0314/mcp-meter/security/advisories/new) on this repository.
- Alternatively, check the maintainer's [GitHub profile](https://github.com/ishaand0314) for a listed contact method.

Please include enough detail to reproduce the issue (affected version, command run, environment) and, if possible, a suggested fix or mitigation. We'll do our best to acknowledge reports promptly and follow up with a fix or a clear explanation.

Please do not disclose the issue publicly until it has been addressed.

## Trust model

MCP Meter's core function is to spawn the MCP server processes defined in your (or a supplied) client config, perform the standard MCP `initialize`/`tools/list` handshake with them over stdio, and measure the resulting tool schemas. This means:

- Running MCP Meter against a server config **executes that server's code locally**, exactly as your MCP client (Claude Desktop, Claude Code, Cursor, Windsurf, etc.) would when it starts up.
- MCP Meter does not sandbox, statically analyze, or vet the servers it spawns in any way.
- **Only run MCP Meter against MCP servers you already trust and would be comfortable running yourself.** Do not point it at a config containing a server you haven't reviewed.

MCP Meter itself does not make outbound network requests, collect telemetry, or transmit your configuration or tool data anywhere: analysis happens entirely locally, and reports are written only to the paths and streams you specify.
