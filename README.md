<p align="center">
  <img src="logo.svg" width="120" alt="Blop Browser logo" />
</p>

# Blop Browser

**Browser infrastructure for coding agents.**

Run persistent, isolated browser sessions through a controlled CLI—using
headless Chromium, your existing Chrome profile, or Camoufox. Blop Browser is
for Codex, Claude Code, OpenCode, and custom agent hosts that need browser
control without adopting another agent framework.

```bash
npm i -g @blopai/browser-harness
blop-browser open https://example.com
blop-browser snapshot
```

[![CI](https://github.com/blop-oss/blop-browser/actions/workflows/ci.yml/badge.svg)](https://github.com/blop-oss/blop-browser/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@blopai/browser-harness)](https://www.npmjs.com/package/@blopai/browser-harness)
[![npm downloads](https://img.shields.io/npm/dm/@blopai/browser-harness)](https://www.npmjs.com/package/@blopai/browser-harness)
[![Node.js 22+](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](package.json)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

The first command starts a local daemon. Later commands in the same named
session reuse its browser, cookies, page state, tabs, action trail, and current
semantic element references.

Blop Browser differs from general-purpose browser automation by combining:

- Controlled, bounded browser tools instead of arbitrary page-script or CDP
  execution.
- Persistent or disposable isolated sessions selected with `--session`.
- Existing Chrome and authenticated profile reuse over CDP.
- Optional Camoufox sessions when a Firefox-based anti-detect browser is needed.
- A public TypeScript API for embedding the same tools in your own agent host.
- Warm Playwright Chromium and Camoufox Docker browser services.
- An agent-neutral CLI, stable JSON output, and an installable agent skill.

The npm package remains `@blopai/browser-harness`, the executable remains
`blop-browser`, and existing imports, commands, configuration variables, and
repository links remain compatible.

## Demo

A real demo has not been recorded yet. The repository intentionally does not
embed a fabricated or broken media asset.

The [demo recording guide](docs/demo-recording.md) provides a shot-by-shot,
reproducible script for an authenticated application. It covers attaching to an
existing Chrome profile, taking a semantic snapshot, interacting through refs,
proving that state persists between CLI commands, and displaying the live
screencast dashboard. Final media belongs in `docs/assets/demo/` after it has
been recorded and reviewed.

## Install

Blop Browser requires Node.js 22 or newer. It uses an installed Chrome or
Chromium when available; you can also install Playwright Chromium or Camoufox.

```bash
npm install --global @blopai/browser-harness
blop-browser doctor
```

If `doctor` doesn't find a Chromium browser, install Playwright Chromium:

```bash
npx playwright install chromium
```

Install the optional agent skill with Vercel's skills CLI:

```bash
npx skills add blop-oss/blop-browser --skill browser-harness
```

Add `-g` for a global skill install, or use `-a opencode`, `-a claude-code`, or
`-a codex` to target one agent. The skill identifier stays `browser-harness` for
compatibility.

<details>
<summary><strong>Install through your coding agent</strong></summary>

Paste this prompt into Codex, Claude Code, OpenCode, or another coding agent:

```text
Install the Blop Browser skill and set up the blop-browser CLI:

1. Run: npx skills add blop-oss/blop-browser --skill browser-harness -g
2. Run: npm install --global @blopai/browser-harness
3. Run: blop-browser doctor --json
4. Read the doctor output. If configuration.mode is null, ask me how I want to
   use the browser and then run the matching config command:
   - Headless Chromium (agents/CI): blop-browser config --mode chromium-headless
   - Visible Chromium (local debugging): blop-browser config --mode chromium-headed
   - Existing Chrome over CDP: blop-browser config --mode chrome-cdp --cdp-endpoint http://127.0.0.1:9222
   - Camoufox headless: blop-browser config --mode camoufox-headless
   - Camoufox visible: blop-browser config --mode camoufox-headed
5. If the mode is managed Chromium or Camoufox, confirm the setup with:
   blop-browser open https://example.com && blop-browser snapshot
6. If the mode is chrome-cdp, get my explicit approval to access that Chrome
   profile, then confirm with:
   blop-browser --attach-existing open https://example.com && blop-browser snapshot
```

</details>

## Choose a browser mode

The first interactive browser command opens `blop-browser config` when no mode
has been saved. The choice is stored in the platform configuration directory.
Non-interactive agents and CI default to headless Chromium.

```bash
blop-browser config --mode chromium-headless
blop-browser config --mode chromium-headed
blop-browser config --mode chrome-cdp \
  --cdp-endpoint http://127.0.0.1:9222
blop-browser config --mode camoufox-headless
blop-browser config --mode camoufox-headed
```

An explicit `--browser`, `--cdp-endpoint`, `--profile`, `--headless`, or
`--headed` option overrides the saved default for a new session. Environment
variables continue to override saved configuration. A CDP endpoint selects the
target, but it doesn't authorize profile access: the command that starts the
attachment must also include `--attach-existing`.

## Use the CLI

Use a named session to isolate concurrent agents or workflows. Each command
targets the same daemon until you close it or its idle timeout expires.

```bash
blop-browser --session checkout open https://example.com
blop-browser --session checkout snapshot
blop-browser --session checkout click e6
blop-browser --session checkout screenshot checkout --full-page
blop-browser --session checkout close
```

Managed sessions use a dedicated persistent profile and downloads directory for
each session name. `close` stops the browser but keeps that state. Inspect the
complete scope before handling authenticated data:

```bash
blop-browser --session checkout status --json
```

The `sessionScope` result reports the profile mode, storage scope, profile,
downloads and artifact directories, local owner, expiry, and whether the
profile is managed by Blop Browser. Use a disposable profile when state must
expire with the daemon:

```bash
blop-browser --session review --profile disposable open https://example.com
blop-browser --session review close
```

Disposable profile, download, and artifact state is removed on explicit close
or idle shutdown. To immediately remove a persistent session's profile,
downloads, artifacts, and daemon metadata, run:

```bash
blop-browser --session checkout destroy
```

`destroy` safely closes an active managed session first. For an attached Chrome
session, it disconnects and removes only Blop Browser's managed artifacts; it
never deletes the external Chrome profile.

Use `--json` for a stable machine-readable response envelope:

```bash
blop-browser --session checkout snapshot --json
```

```json
{ "ok": true, "result": { "content": "...", "metadata": {} } }
```

The CLI exposes every native tool through a self-describing interface:

```bash
blop-browser tools
blop-browser describe browser_click
blop-browser call browser_click --input '{"target":{"ref":"e1"}}'
```

Run `blop-browser --help` for the complete command list.

## Connect to existing Chrome

Attach over CDP to reuse an existing Chrome profile, cookies, and open tabs.
Start Chrome with remote debugging bound to localhost and a dedicated profile
directory:

```bash
google-chrome \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/blop-chrome

blop-browser --session chrome \
  --attach-existing \
  --cdp-endpoint http://127.0.0.1:9222 snapshot
blop-browser --session chrome open https://example.com
blop-browser --session chrome close
```

The first command attaches to Chrome's default context and most recently opened
tab. Later commands reuse that connection without repeating `--cdp-endpoint`.
Closing Blop Browser disconnects from Chrome without closing Chrome itself.

Keep the debugging port on localhost. A CDP endpoint grants full control over
that Chrome profile. Never infer permission from a saved configuration or
environment variable. You can set `BLOP_BROWSER_CDP_ENDPOINT` instead of
passing the endpoint, but the first command must still include
`--attach-existing`.

## Use Camoufox

Camoufox is an optional Firefox-based browser with native fingerprint
protection. Chromium remains the default and is the better choice for
deterministic testing of applications you control.

```bash
blop-browser install camoufox
blop-browser --session research \
  --browser camoufox open https://example.com
```

The Camoufox browser binary is a separate third-party download. Review the
[Camoufox project](https://github.com/daijro/camoufox) before using it in your
environment.

## Embed the TypeScript API

Install the existing npm package locally to embed the same bounded tools in an
agent host.

```bash
npm install @blopai/browser-harness
```

```ts
import { chromium } from "playwright";
import {
  getBrowserSessionScope,
  createBrowserTools,
  type HarnessAction,
} from "@blopai/browser-harness";

const sessionScope = getBrowserSessionScope("demo", {
  runtimeDirectory: ".browser-runtime",
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const actions: HarnessAction[] = [];

const tools = await createBrowserTools({
  page,
  testId: "demo",
  screenshotDir: ".harness-screenshots",
  actions,
  screenshots: [],
  finishState: { status: null, reason: null },
});

const goto = tools.find((tool) => tool.name === "browser_goto")!;
await goto.execute({ url: "https://example.com" });
await browser.close();
```

The public API also exports `NativeToolBridge`, `startScreencast`, structured
target helpers, and warm Docker sessions. `startPlaywrightContainer()` and
`startCamoufoxContainer()` keep their server containers running while each
caller receives an isolated browser connection.

## Compare browser interfaces

This table compares documented architecture and interfaces, not benchmark
quality. Projects change quickly, so uncertain or undocumented fields are
marked instead of inferred. The sources were reviewed on August 13, 2026.

| Capability                       | Blop Browser                                                               | Playwright CLI                                                                   | Vercel agent-browser                                                    | Playwright MCP                                                                           | browser-use/browser-harness                                                   |
| -------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Primary interface                | CLI, skill, JSON, and TypeScript API                                       | CLI and skill                                                                    | CLI, skill, and JSON                                                    | MCP server                                                                               | Python CLI/skill and editable helpers                                         |
| State persists between commands  | Yes, through a per-session daemon                                          | Yes, in memory; optional disk profile                                            | Yes, through a daemon; optional restore                                 | Yes, through the server and profile                                                      | Yes, through a long-lived CDP connection                                      |
| Named session isolation          | Yes, `--session`                                                           | Yes, `-s`                                                                        | Yes, `--session`                                                        | Per-server isolated/profile configuration; no comparable named-session switch documented | Named remote daemons are documented; local multi-session isolation is unclear |
| Existing Chrome reuse            | Yes, direct CDP endpoint                                                   | Yes, CDP or extension                                                            | Yes, direct CDP or auto-connect                                         | Yes, extension or configured endpoint                                                    | Yes, direct CDP                                                               |
| Controlled, bounded tool surface | Yes; arbitrary page script and unrestricted CDP are intentionally excluded | No equivalent restriction documented; code/evaluation capabilities are available | No equivalent restriction documented; `eval` is available               | Structured tools, but evaluation/init-code capabilities are documented                   | No; the project explicitly exposes raw CDP and agent-written helpers          |
| Camoufox support                 | Yes, local and warm container modes                                        | Not documented                                                                   | Not documented                                                          | Not documented                                                                           | Not documented                                                                |
| Public TypeScript embedding API  | Yes                                                                        | Not documented                                                                   | Current docs are CLI-first; no public browser-manager API is documented | Not documented as a browser-tool embedding API                                           | No; the project is Python-based                                               |
| Warm Docker browser service      | Yes; reused service, isolated browser per client                           | Not documented                                                                   | Warm sandbox templates are documented, not this service contract        | Long-lived Docker server documented; isolated-browser-per-client behavior is unclear     | Not documented                                                                |

Comparison sources:

- [Playwright CLI sessions and CDP attachment](https://github.com/microsoft/playwright-cli#sessions)
  and [Playwright CLI introduction](https://playwright.dev/agent-cli/introduction)
- [Vercel agent-browser README](https://github.com/vercel-labs/agent-browser#readme)
- [Playwright MCP profiles, isolation, extension, and Docker](https://github.com/microsoft/playwright-mcp#readme)
- [browser-use/browser-harness README](https://github.com/browser-use/browser-harness#readme)
  and [connection guide](https://github.com/browser-use/browser-harness/blob/main/install.md)

`browser-use/browser-harness` in this table is the separate Browser Use project,
not this repository's retained npm package name.

## Configuration reference

These environment variables configure sessions and browser infrastructure.
Explicit CLI flags take precedence where both forms exist.

| Variable                                | Default                          | Purpose                                               |
| --------------------------------------- | -------------------------------- | ----------------------------------------------------- |
| `BLOP_BROWSER_SESSION`                  | `default`                        | Session name                                          |
| `BLOP_BROWSER`                          | `chromium`                       | `chromium` or `camoufox`                              |
| `BLOP_BROWSER_HEADLESS`                 | `1`                              | Set to `0` for a visible browser                      |
| `BLOP_BROWSER_CDP_ENDPOINT`             | Unset                            | Existing Chrome CDP URL; doesn't authorize attachment |
| `BLOP_BROWSER_PROFILE`                  | `persistent`                     | `persistent` or `disposable` managed profile mode     |
| `BLOP_BROWSER_CONFIG_PATH`              | Platform config directory        | Saved installer choice                                |
| `BLOP_BROWSER_EXECUTABLE_PATH`          | Auto-detect                      | Chrome or Chromium path                               |
| `BLOP_BROWSER_CAMOUFOX_EXECUTABLE_PATH` | Auto-detect                      | Camoufox path                                         |
| `BLOP_BROWSER_IDLE_TIMEOUT_MS`          | `1800000`                        | Daemon idle timeout                                   |
| `BLOP_BROWSER_RUNTIME_DIR`              | OS temporary directory           | Private session state                                 |
| `BLOP_PLAYWRIGHT_CONTAINER`             | `blop-playwright`                | Warm Playwright server container name                 |
| `BLOP_PLAYWRIGHT_IMAGE`                 | Playwright-version-derived image | Playwright image override                             |
| `BLOP_PLAYWRIGHT_NETWORK`               | Unset                            | Shared Docker network                                 |
| `BLOP_CAMOUFOX_CONTAINER`               | `blop-camoufox`                  | Warm Camoufox server container name                   |
| `BLOP_CAMOUFOX_IMAGE`                   | Version-derived local image      | Camoufox image override                               |
| `BLOP_CAMOUFOX_NETWORK`                 | `BLOP_PLAYWRIGHT_NETWORK`        | Camoufox Docker network                               |

## Benchmarks

The benchmark scaffold separates harness behavior from the agent/model that
drives it. No benchmark result is claimed without a reproducible run record.

Start with the [benchmark plan and result schema](benchmarks/README.md). The
[Mind2Web live benchmark](benchmarks/mind2web/README.md) contains the normalized
dataset utility, agent-neutral runner, Blop host adapter, deterministic local
smoke test, and historical experiment ledger.

## Contribute

Contributions are welcome across browser tools, session infrastructure,
documentation, and benchmark adapters.

Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, architecture boundaries,
tests, and pull-request expectations. The [roadmap](ROADMAP.md) lists the near
term direction, and the maintainer's
[candidate good-first-issue backlog](docs/good-first-issues.md) contains scoped
tasks that can be promoted to GitHub issues after review.

## Project policies

Review the project policies before reporting sensitive problems or taking part
in the community.

- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security policy](SECURITY.md)
- [MIT license](LICENSE)

The [public launch checklist](docs/launch-checklist.md) records remaining GitHub
settings that maintainers must complete manually. The canonical repository is
`blop-oss/blop-browser`; GitHub redirects its previous `browser-harness` URL.
