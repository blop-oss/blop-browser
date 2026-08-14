# Local session metrics protocol

This protocol measures cold-start and warm-resume latency plus exact
harness-observable session metrics for the built Blop Browser CLI. It runs
three paired repetitions against an internal `127.0.0.1` fixture. It does not
open a third-party site or estimate provider tokens.

See the dated `RESULTS.md` after a reviewed run is published. The summary
retains every repetition's cold and warm duration, metric delta, and failure.
Full generated reports remain private and ignored.

## Define the paired phases

[`protocol.json`](protocol.json) is the source of truth. Its SHA-256 travels
with every generated report.

Each repetition uses a fresh session name and temporary runtime root. Both
timed phases run the same built Node CLI workflow: `open` the controlled
fixture, then request `snapshot`. The parent process validates the snapshot's
exact URL and fixture marker before stopping its monotonic timer.

The phase boundaries are:

- Cold start begins immediately before the parent spawns the first `open`
  command. No healthy daemon, profile, downloads, or artifacts exist for that
  fresh session.
- Warm resume begins immediately before the parent spawns the same first
  `open` command, after a separate `status` call verifies that the same daemon
  and browser are ready. The readiness call is outside the timer.
- Metrics exports, readiness checks, and teardown remain outside both timers.

Cold start includes parent process spawn, daemon startup, browser launch,
navigation, a second CLI process, snapshot creation, response parsing, and
validation. Warm resume includes the same two CLI processes and validation but
reuses the verified-ready daemon and browser.

## Understand measured metrics

Each phase retains the exact aggregate delta for its two browser commands:

- Command totals, outcomes, snapshots, explicit harness-owned retries,
  approvals, and summed harness execution duration. Duration surrounds each
  tool dispatch, including time spent inside Playwright calls; retry counts do
  not infer Playwright's internal polling.
- Serialized tool-input, tool-output, and snapshot-output volume as Unicode
  code points and UTF-8 bytes, plus visible unmeasured counts.
- Model-image data URL counts and volume.
- `null` token fields with an unavailable source and tokenizer. This local CLI
  workflow has no provider-reported or tokenizer-specific token count.

The protocol also records the repository commit and dirty state, protocol
hash, and a deterministic hash of every runnable `.js` file under `dist/`.
The build digest includes sorted relative paths and bytes, with bounded file
count, per-file size, and total size; the report records those counts. It also
records package and Playwright versions, actual browser version, Node.js
version, operating system, and architecture. The hostname is redacted.

Read the [session metrics contract](../../docs/session-metrics.md) for recorder
scope, persistence, active-segment timing, and privacy details.

## Run the protocol

You need Node.js 22 or newer, locked dependencies, and Playwright's installed
bundled Chromium. The runner passes that exact executable path and records the
actual browser version. Build the exact CLI before running:

```bash
bun install --frozen-lockfile
bun run build
node benchmarks/session-metrics/run.mjs
```

The runner writes a unique JSON report under
`benchmarks/session-metrics/.results/`. Git ignores that directory. You can
choose another file only within that ignored directory:

```bash
node benchmarks/session-metrics/run.mjs \
  --output benchmarks/session-metrics/.results/local-session-metrics.json
```

The runner fixes three repetitions, Chromium, headless mode, a fresh
persistent profile per pair, the built `dist/cli.js`, and the two-command
workflow. It has no URL, repetition, browser, profile, proxy, or account
override. It validates the loopback URL before navigation.

## Read and retain evidence

[`result.schema.json`](result.schema.json) defines the raw machine report. The
runtime also enforces the exact protocol configuration, three attempts, fixed
field sets, summary reconciliation, bounded counters, at most 15 failure rows,
1,000-code-point failure reasons, and a 256 KiB report ceiling.

Review these fields together:

- `attempts` retains every cold and warm duration, per-phase metric delta,
  actual browser version, readiness result, teardown result, and final session
  aggregate.
- `summary` contains sorted raw duration arrays, medians, minima, maxima, pair
  counts, and every failure. A failed pair stays visible and is never replaced
  by a favorable attempt.
- `source` identifies the exact protocol, build, source tree, and package
  versions.
- `limitations` travels with the report and narrows every result claim.

Generated reports contain no raw page or tool payload content, but timing,
command mix, payload sizes, approvals, and environment versions can still be
sensitive. The browser profiles, traces, and complete generated report remain
private and ignored until a maintainer reviews a bounded summary for
publication.

## Interpret results narrowly

Three paired local repetitions are performance evidence only for the recorded
machine, versions, build, and workflow. They do not predict a different host,
browser interface, public website, model provider, network, or machine.

The parent-process latency and summed harness command duration answer different
questions. Do not subtract one from the other or describe either as model time.
Do not convert exact characters or UTF-8 bytes into tokens without naming a
specific tokenizer and publishing its version and method.

## Change the protocol

Protocol changes require focused tests and a version update. Keep earlier
results interpretable instead of changing a field under the same version.

When changing the protocol:

1. Update `protocol.json` and increment `protocol_version` when measurement
   meaning, configuration, phase boundaries, or validation changes.
2. Update `result.schema.json`, `core.mjs`, this guide, and
   `test/benchmarks/session-metrics.test.ts` together.
3. Commit the implementation, build from that clean commit, and run all three
   paired repetitions.
4. Publish a separate bounded summary naming the exact source commit, dirty
   state, protocol and complete runnable `dist` JavaScript tree hashes,
   versions, all six timed phases, metric deltas, failures, and limitations.
5. Keep full generated reports under `.results/` and out of Git.
