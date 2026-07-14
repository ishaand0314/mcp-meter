# Contributing to MCP Meter

Thanks for taking the time to look at MCP Meter. Bug reports, feature requests, and general discussion are genuinely welcome.

## Reporting bugs and requesting features

Please use [GitHub Issues](https://github.com/ishaand0314/mcp-meter/issues):

- **Found a bug?** Open an issue using the "Bug report" template: include your OS, Node version, the command you ran, and what you expected vs. what happened.
- **Have an idea?** Open an issue using the "Feature request" template and describe the problem it solves, not just the solution.

Before opening a new issue, please do a quick search to see if someone's already reported the same thing.

## Pull requests

Pull requests are welcome as a way to propose and discuss a change. However, because this project is distributed under a [source-available, non-redistributable license](LICENSE) rather than a permissive open-source one, **merging any external code requires the maintainer's explicit agreement first**. Please open an issue (or comment on an existing one) to discuss the change *before* putting time into a PR, so we're aligned on the approach before you write code. PRs opened without that prior discussion may be closed even if the code itself is good, simply because merging outside contributions isn't something this license does automatically.

## Local development setup

```bash
git clone https://github.com/ishaand0314/mcp-meter.git
cd mcp-meter
npm install
npm run build
npm test
```

- `npm run build` compiles TypeScript (`src/`) to `dist/`.
- `npm test` runs the test suite via [Vitest](https://vitest.dev).
- Once built, you can run the CLI locally with `node dist/cli.js --demo` (or `node bin/mcp-meter.js --demo`).

## Code style expectations

- The project is written in TypeScript with `strict` mode on. Please keep it that way.
- Keep things lean: prefer small, focused, dependency-free functions over pulling in new libraries for something a few lines of code can do.
- Add or update tests under `test/` for any new analysis, discovery, or reporting logic. Changes without test coverage are much harder to merge with confidence.
- Match the existing formatting and naming conventions you see in the surrounding file rather than introducing a new style.
