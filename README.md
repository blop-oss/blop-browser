<p align="center">
  <img src="logo.svg" width="120" alt="Blop Browser logo" />
</p>

# Blop Browser

**Browser infrastructure for coding agents.**

Run browser sessions through a controlled CLI with headless Chromium, explicit
existing-Chrome attachment, or optional Camoufox. Blop Browser integrates with
Codex, Claude Code, OpenCode, and custom agent hosts.

Blop Browser is browser infrastructure, not a complete browser agent. It has no
model, planner, or autonomous agent loop; your host owns orchestration and
approval decisions. Review the [known limitations](docs/known-limitations.md)
and [privacy and data-flow contract](PRIVACY.md) before choosing it for a
workflow.

Blop Browser has no hosted free or paid tier. Commands and APIs run in
infrastructure you operate or in a browser you explicitly attach. The separate
Blop QA product is not a hosting tier for this package. Review the
[capability availability](docs/capability-availability.md) for the local
contract and the dated official-source audit.

Use Blop Browser only on websites, accounts, and data you own or are authorized
to access. Read the [acceptable-use policy](ACCEPTABLE_USE.md) before setup.

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
- Persistent or disposable managed storage separated by `--session` name.
- Existing Chrome and authorized profile reuse over CDP.
- An explicit automation-to-human control handoff for active headed or attached
  sessions.
- Optional Camoufox sessions for compatibility testing across browser
  fingerprints.
- A public TypeScript API for embedding the same tools in your own agent host.
- Warm Playwright Chromium and Camoufox Docker browser services.
- An agent-neutral CLI, machine-readable JSON output, and an installable agent
  skill.

The published npm package is `@blopai/browser-harness`, and its executable is
`blop-browser`. Current imports, commands, configuration variables, and
repository links use those compatibility names.

## Demo

A real demo has not been recorded yet. The repository intentionally does not
embed a fabricated or broken media asset.

The [demo recording guide](docs/demo-recording.md) provides a shot-by-shot,
reproducible script for the bundled local fixture. It covers taking a semantic
snapshot, interacting through refs, proving that state persists between CLI
commands, and displaying the live screencast dashboard. Final media belongs in
`docs/assets/demo/` after it has been recorded and reviewed.

## Install

Blop Browser requires Node.js 22 or newer. It uses an installed Chrome or
Chromium when available; you can also install Playwright Chromium or Camoufox.
Use each mode only for workflows permitted by the
[acceptable-use policy](ACCEPTABLE_USE.md).

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

1. Read https://github.com/blop-oss/blop-browser/blob/master/ACCEPTABLE_USE.md
   and confirm this setup is for websites and accounts I own or am authorized
   to automate.
2. Run: npx skills add blop-oss/blop-browser --skill browser-harness -g
3. Run: npm install --global @blopai/browser-harness
4. Run: blop-browser doctor --json
5. Read the doctor output. If configuration.mode is null, ask me how I want to
   use the browser and then run the matching config command:
   - Headless Chromium (agents/CI): blop-browser config --mode chromium-headless
   - Visible Chromium (local debugging): blop-browser config --mode chromium-headed
   - Existing Chrome over CDP: blop-browser config --mode chrome-cdp --cdp-endpoint http://127.0.0.1:9222
   - Camoufox headless: blop-browser config --mode camoufox-headless
   - Camoufox visible: blop-browser config --mode camoufox-headed
6. If the mode is managed Chromium or Camoufox, confirm the setup with:
   blop-browser open https://example.com && blop-browser snapshot
7. If the mode is chrome-cdp, get my explicit approval to access that Chrome
   profile, then confirm with:
   blop-browser --attach-existing open https://example.com && blop-browser snapshot
```

</details>

Interactive terminals check the npm registry at most once every 24 hours and
ask before installing a newer `@blopai/browser-harness`. This is not telemetry.
Disable the check with `BLOP_BROWSER_UPDATE_CHECK=off`.

```bash
blop-browser update
blop-browser update --json
```

`--json` reports the current and latest versions without installing. Approving
an update, or passing `--install`, runs
`npm install --global @blopai/browser-harness` and overwrites any existing
`browser-harness` skill copies in the usual user and project skill directories.
It does not create a skill install that was not already present.

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

Choose the backend from the workflow, not from a promise of avoiding
detection:

- Use managed Chromium for deterministic testing of local fixtures, staging
  environments, and applications you control.
- Use a dedicated Chrome profile over CDP when an authorized workflow requires
  its real Chrome state. Profile history, extensions, login state, and the
  installed Chrome version make CDP runs less controlled as comparisons.
- Use Camoufox only for authorized Firefox and fingerprint-compatibility
  coverage. Its generated fingerprint can vary between otherwise identical
  launches. This does not establish anonymity or avoidance of site controls.

The [local backend signal protocol](benchmarks/detection/README.md) records
versions, launch constraints, bounded browser-observable signals, failures, and
limitations across three fresh-profile repetitions. It isn't a detection score
or a bot-protection bypass benchmark.

## Use the CLI

Use distinct session names to give concurrent agents or workflows separate
managed browser storage. Each command targets the same named daemon until you
close it or its idle timeout expires.

```bash
blop-browser --session docs-review open https://example.com
blop-browser --session docs-review snapshot
blop-browser --session docs-review click e6
blop-browser --session docs-review screenshot docs-review --full-page
blop-browser --session docs-review close
```

Managed sessions use a dedicated persistent profile and downloads directory for
each session name. `close` stops the browser but keeps that state. Inspect the
reported scope before handling authenticated data:

```bash
blop-browser --session checkout status --json
```

The `sessionScope` result reports the profile mode, storage scope, profile,
downloads and artifact directories, local owner, expiry, and whether the
profile is managed by Blop Browser. The `privacy` result separately reports
local or attached mode, first-party harness telemetry (`off`), CLI recording
states, the daemon log, and distinct local, managed-browser, and
external-browser retention. A newly started daemon returns the same object at
the top of its first JSON response; human output prints a concise version to
stderr. See [privacy and data flows](PRIVACY.md) before handling sensitive
pages.

Use a disposable profile when state must expire with the daemon:

```bash
blop-browser --session review --profile disposable open https://example.com
blop-browser --session review close
```

Disposable profile, download, artifact, and daemon-log state is removed on
explicit close or idle shutdown. List retained session metadata without
reading profile contents, then delete one validated session through the
discoverable lifecycle commands:

```bash
blop-browser data list --json
blop-browser data delete checkout
```

`data delete checkout` is the strict alias of:

```bash
blop-browser --session checkout destroy
```

`destroy` closes an active managed session before deleting its state. For an
attached Chrome session, it disconnects and removes only Blop Browser's managed
artifacts; it does not delete the external Chrome profile. Neither command
removes global configuration, browser caches, Docker resources, website data,
or host/provider records, and filesystem removal is not secure erasure.

Use `--json` for a machine-readable response envelope:

```bash
blop-browser --session docs-review snapshot --json
```

```json
{
  "ok": true,
  "result": {
    "content": "...",
    "contentBoundary": {
      "source": "browser",
      "trust": "untrusted",
      "url": "https://example.com/"
    },
    "metadata": {}
  }
}
```

Every tool result has a `contentBoundary`. Direct page observations use
`source: "browser"`; action results that combine harness text with page state
use `source: "mixed"`; and messages generated only by the harness use
`source: "harness"`. Lifecycle results that echo host input use
`source: "caller"`. Browser, mixed, and caller results are always
`trust: "untrusted"`. Model images carry their own untrusted browser boundary.
Preserve these fields when adapting tools to a model SDK, and pass untrusted
content as tool data—not as system, developer, or host instructions.

The CLI exposes every native tool through a self-describing interface:

```bash
blop-browser tools
blop-browser describe browser_click
blop-browser call browser_click --input '{"target":{"ref":"e1"}}'
```

Run `blop-browser --help` for the complete command list.

Export the bounded action trace as a human timeline or JSON. Persistent
sessions retain the latest complete trace after close or idle shutdown, until
you run `destroy`:

```bash
blop-browser --session docs-review trace
blop-browser --session docs-review trace --json
```

Trace events include ordered timestamps, redacted inputs and URLs, target refs,
successes and failures, approval metadata, content boundaries, and available
screenshot or screencast positions. See the
[action trace contract, redaction limits, and retention rules](docs/action-traces.md)
before storing or sharing an export.

Export bounded aggregate session metrics as text or JSON. Persistent sessions
retain the latest aggregate across close and resume until `destroy`:

```bash
blop-browser --session docs-review metrics
blop-browser --session docs-review metrics --json
```

Metrics report command outcomes, snapshots, explicit harness retries,
approvals, durations, and exact Unicode code-point and UTF-8 payload volume.
They retain no payload content and report provider token counts as unavailable,
not as character-based estimates. Read the
[session metrics contract and retention rules](docs/session-metrics.md) before
using an aggregate as evidence.

## Hand control to a person

Pause harness automation when a person needs to handle a challenge or a
sensitive step in an active headed managed browser or an attached browser. A
managed headless session has no browser access path for a person, so a takeover
request fails before pausing it.

```bash
blop-browser config --mode chromium-headed
blop-browser --session review open https://example.com
blop-browser --session review takeover request challenge \
  --message "Complete the visible challenge." --json
blop-browser --session review takeover control REQUEST_ID --json
# The person uses the reported managed window.
blop-browser --session review takeover resume REQUEST_ID LEASE_ID \
  --outcome completed --json
```

For an attached browser, the response identifies the configured attached
browser. The CLI cannot verify that a remote or local CDP endpoint is visible
or reachable by the intended person. The host or operator must provide the
actual browser access, notification, and user interface.

`takeover request` changes the state from `automation` to `pausing`, rejects new
harness commands before any `Page` access, waits for already admitted commands,
and then reports `paused`. `takeover control` returns a lease and changes the
state to `human-control`. `takeover resume` requires the matching request and
lease IDs before returning to `automation`. These IDs serialize callers; they
are not authentication, authorization, or evidence that a person acted. Any
caller authenticated to the daemon can invoke the transition commands.

While automation is paused, `status --json` returns the cached pre-pause URL
and title with `pageState: "cached"`. Page scripts and network activity continue,
and page JavaScript or an external CDP client can still race the person. Pause
and resume invalidate all semantic refs, so take a new snapshot before the next
agent action. If the person closes the active page, leave another tracked page
open for the harness to select after resume; if none remains, the next tool call
returns a recorded structured failure.

Embedding hosts can use the same framework-neutral controller and transition
callback:

```ts
import {
  createBrowserControlSession,
  createBrowserTools,
} from "@blopai/browser-harness";

const control = createBrowserControlSession({
  onTransition: (transition) => hostLifecycleSink(transition),
});
const tools = await createBrowserTools({
  // ...page, action, artifact, and finish-state options
  control,
});

const paused = await control.requestTakeover({
  reason: "sensitive-step",
  message: "Enter the account recovery value.",
});
const lease = control.takeControl({ requestId: paused.requestId! });
// The host exposes the browser and waits for its operator workflow here.
control.resumeAutomation({
  requestId: lease.requestId,
  leaseId: lease.leaseId,
  outcome: "completed",
});
```

Transition callback failures are bounded in `control.status()` and don't roll
back or retry a transition. The action trace records pause, acquisition, and
resume in order, redacts the optional message, and never stores the lease.
Semantic snapshots conservatively mask values from password fields and
credential-like inputs, textareas, and editable regions. This masking is not
data-loss prevention: screenshots, explicit extraction, arbitrary rendered
text, browser logs, and network activity can still expose sensitive data.

Run the bundled loopback-only automated ownership proof against the built
package:

```bash
bun run demo:takeover
```

It verifies command draining, concurrent rejection, resume, stale-ref
invalidation, redaction, and ordered trace transitions. It does not provide or
test a host UI, notification delivery, human identity, or proof that a person
acted.

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
`--attach-existing`. Attach only to a dedicated profile and accounts you are
authorized to control; CDP access doesn't grant permission to automate a
website.

Status and doctor output reduce a CDP URL to its scheme, host, and effective
port; even that host can be sensitive. The owner-only global configuration
retains the full endpoint needed to reconnect. Browser control, input, uploads,
page state, and screenshots cross a remote CDP transport, while the attached
profile and remote-side logs remain outside harness deletion.

## Use Camoufox

Camoufox is an optional Firefox-based browser that changes browser-observable
fingerprint characteristics. Chromium remains the default; use it for
deterministic testing of applications you control.

```bash
blop-browser install camoufox
blop-browser --session compatibility-test \
  --browser camoufox open https://staging.example.com
```

The Camoufox browser binary is a separate third-party download. Review the
[Camoufox project](https://github.com/daijro/camoufox) before using it in your
environment. Use it only for authorized compatibility testing. It doesn't grant
permission to access a site, and it does not establish anonymity or avoidance
of bot protections and other site controls. If a site denies access,
stop instead of switching fingerprints to bypass the denial. See the
[acceptable-use policy](ACCEPTABLE_USE.md).

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
  createSessionMetricsRecorder,
  createTraceRecorder,
  type HarnessAction,
} from "@blopai/browser-harness";

const sessionScope = getBrowserSessionScope("demo", {
  runtimeDirectory: ".browser-runtime",
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const actions: HarnessAction[] = [];
const traceRecorder = createTraceRecorder({
  identity: { sessionId: "demo", agentId: "accessibility-review" },
});
const sessionMetricsRecorder = createSessionMetricsRecorder();

const tools = await createBrowserTools({
  page,
  testId: "demo",
  screenshotDir: ".harness-screenshots",
  actions,
  screenshots: [],
  finishState: { status: null, reason: null },
  traceRecorder,
  sessionMetricsRecorder,
  safety: {
    mode: "read-only",
  },
});

const goto = tools.find((tool) => tool.name === "browser_goto")!;
await goto.execute({ url: "https://example.com" });
process.stdout.write(`${traceRecorder.timeline()}\n`);
process.stdout.write(`${sessionMetricsRecorder.json(true)}\n`);
await browser.close();
```

`safety.mode: "read-only"` rejects pointer, keyboard, form, file-upload, and
page-closing interactions before they reach Playwright. Navigation and
observation remain available so a host can inspect links and traverse public
documents without granting input dispatch; this is a capability mode, not an
HTTP safe-method guarantee. Denied attempts throw `BrowserSafetyError` and are
still recorded in `actions` with deterministic policy metadata.

For the standalone CLI, set `BLOP_BROWSER_READ_ONLY=1` before the command that
starts a named session. The daemon keeps that mode for the session, and
`status --json` reports it as `safetyMode`:

```bash
BLOP_BROWSER_READ_ONLY=1 blop-browser --session research open https://example.com
blop-browser --session research snapshot
```

### Enforce domain and action rules

An embedding host can freeze a static policy into each browser context. The
policy can combine top-level origin rules with `allow`, `deny`, or `ask`
decisions for harness-defined action classes:

```ts
const tools = await createBrowserTools({
  // ...the page, artifact, action, and finish-state options above
  safety: {
    domains: {
      allow: ["https://app.example.com", "https://*.assets.example.com"],
      deny: ["https://admin.assets.example.com"],
    },
    actions: {
      navigation: "allow",
      pointer: "ask",
      keyboard: "allow",
      form: "ask",
      "file-upload": "deny",
      "page-lifecycle": "deny",
    },
    approvalPolicy: async (request) => {
      const approved = await approvalUi.confirm({
        tool: request.toolName,
        category: request.category,
        url: request.url,
        input: request.input,
      });
      return { approved, reason: approved ? undefined : "User declined." };
    },
  },
});
```

Domain entries must be HTTP or HTTPS origins without paths, credentials,
queries, or fragments. A nonempty `allow` list denies nonmatching origins, and
`deny` takes precedence. `https://*.example.com` matches any subdomain depth,
but not `example.com`, `evil-example.com`, another scheme, or a nondefault
port. Add an explicit port to a rule when you need one. Hostnames are matched
as normalized ASCII names with DNS label boundaries.

For an existing page, the gate checks a `browser_goto` destination before its
request and checks every top-level redirect hop. The same top-level gate
applies to navigation caused by clicks, forms, or page scripts. While domain
rules are active, the harness rejects every new-page or popup document before
its first request, even when its requested origin is allowed. Chromium exposes
that request before it exposes a page that can cover later redirects, so this
fail-closed rule prevents an allowed popup from redirecting outside policy.

A domain policy is immutable for the lifetime of its `BrowserContext`. Tool
sets that share a context must use the same rules, or must all omit rules;
mixing policies fails setup. Nonempty domain rules currently require Chromium.
Factory setup fails on Firefox, Camoufox, or a context whose backend can't
enforce every top-level redirect hop. Existing host-owned context routes remain
in the route chain.

Action classes describe dispatched tool commands, not the meaning of a web
page:

- `navigation` covers `browser_goto`, `browser_reload`, `browser_go_back`, and
  `browser_go_forward`.
- `pointer` covers clicks, hover, and drag commands.
- `keyboard` covers type, press, tab, focus, blur, and clear commands.
- `form` covers check, uncheck, and select-option commands.
- `file-upload` covers `browser_upload_file`.
- `page-lifecycle` currently covers `browser_close_page`.

Viewport changes, page selection, observations, and evidence tools stay
outside the interaction gate. A click that submits a form remains `pointer`,
and Enter remains `keyboard`; the harness does not guess that either command
is a submission, purchase, or message. Navigation caused by such a command
does not trigger a second `navigation` approval, because its destination isn't
known before dispatch. Domain rules still check that top-level destination.

The callback runs only for a category whose decision is `ask`. If you supply
`approvalPolicy` without explicit action decisions, existing non-navigation
interactions default to `ask`; navigation defaults to `allow` unless you
configure it. Callback URLs omit query and fragment values. Text, values,
credentials, and file paths in `request.input` become bounded redaction
summaries. Page wording never changes the static category. A missing callback,
exception, malformed result, or negative decision denies the command. A host
denial reason is reduced to a bounded single line before it enters an error or
action record. Batch envelopes don't bypass the gate: each inner command is
checked and recorded, and nested batches are rejected.

These controls bound consequences; they do not solve prompt injection. A page
can mutate itself or make network requests while loading, and a GET navigation
can have server-side effects on a poorly designed site. Read-only mode does not
disable JavaScript, networking, cookies, downloads initiated by the page, or
access already granted to an attached profile. Domain rules cover top-level
documents only; they don't filter iframes, images, scripts, fonts, fetches,
WebSockets, service workers, or other subresources. They are not network
isolation. The policy does not impose download, message, submission, or general
resource rules beyond the explicit tool classes above. Use a dedicated browser
profile, enforce network and filesystem boundaries outside the harness, and
require a human decision for consequential actions.

The standalone CLI currently exposes only read-only mode through
`BLOP_BROWSER_READ_ONLY`. Domain rules, action decisions, and approval
callbacks are embedding API features; the CLI does not invent a policy or
human approval workflow.

The trace API returns immutable copies and bounded JSON or human timelines.
Failed and policy-denied actions remain visible. Read the
[action trace documentation](docs/action-traces.md) for the complete public
contract and privacy limitations.

The metrics API returns immutable bounded aggregates without retaining raw
payload content. It counts only harness-observable retries and leaves provider
tokens `null`. Read the [session metrics documentation](docs/session-metrics.md)
for exact byte, character, duration, and resume semantics.

The public API also exports `NativeToolBridge`, `startScreencast`, structured
target helpers, `BrowserSafetyError`, the safety policy types, and warm Docker
sessions. `startPlaywrightContainer()` and `startCamoufoxContainer()` keep their
server containers running while each caller receives a separate browser
instance. They do not probe a public endpoint by default. Pass
`probeInternetEgress: true` only when the fixed `https://1.1.1.1:443`
diagnostic is acceptable; the returned `internetEgressProbe` discloses the
destination and `hasInternetEgress` is `null` when it was not probed. This does
not provide operating-system or network isolation.

## Compare browser interfaces

Use the [positioning and local contract proof](docs/positioning-proof.md) to
decide whether this package's bounded tools and managed session lifecycle fit
your host, and to reproduce those contracts on a loopback-only fixture. It also
states when a direct Playwright program is the better fit.

See the [evidence-backed browser tool comparison](docs/browser-tool-comparison.md)
for a reviewed, source-pinned matrix covering Blop Browser, Playwright CLI,
Playwright MCP, agent-browser, and Browser Use CLI with Browser Harness. It
compares profiles, parallel isolation, existing-browser access, engines,
embedding, remote execution, recordings, safety controls, and cleanup.

The document records competitor advantages and tradeoffs instead of treating
the matrix as a ranking. Unknown or untested behavior stays explicit, and every
nontrivial product cell links to primary evidence.

The [public claims and evidence](docs/public-claims.md) ledger inventories
release-facing copy and maps each retained material promise to direct evidence
and a stated boundary.

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
| `BLOP_BROWSER_TELEMETRY`                | `off`                            | First-party harness telemetry; only `off` is valid    |
| `BLOP_BROWSER_CONFIG_PATH`              | Platform config directory        | Saved installer choice                                |
| `BLOP_BROWSER_EXECUTABLE_PATH`          | Auto-detect                      | Chrome or Chromium path                               |
| `BLOP_BROWSER_CAMOUFOX_EXECUTABLE_PATH` | Auto-detect                      | Camoufox path                                         |
| `BLOP_BROWSER_IDLE_TIMEOUT_MS`          | `1800000`                        | Daemon idle timeout                                   |
| `BLOP_BROWSER_READ_ONLY`                | Unset                            | Set to `1` to deny interactions                       |
| `BLOP_BROWSER_AGENT_ID`                 | Unset                            | Optional identity in bounded action traces            |
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
[local session metrics protocol](benchmarks/session-metrics/README.md) measures
three paired cold-start and warm-resume workflows against a deterministic
loopback fixture. Its
[dated local result](benchmarks/session-metrics/RESULTS.md) publishes all six
timed phases and limitations without committing the full report. The
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
in the community. Product vulnerabilities use the private security process;
support questions and ordinary bugs are public after sensitive data is removed.

- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Acceptable-use policy](ACCEPTABLE_USE.md)
- [Security policy](SECURITY.md)
- [MIT license](LICENSE)

The [public launch checklist](docs/launch-checklist.md) records remaining GitHub
settings that maintainers must complete manually. The canonical repository is
`blop-oss/blop-browser`; GitHub redirects its previous `browser-harness` URL.
