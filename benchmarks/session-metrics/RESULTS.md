# Local session metrics result: 2026-08-14

This reviewed result publishes all six timed phases from one fixed three-pair
loopback run. It is evidence for the recorded build, browser, machine, and
workflow only. The full generated JSON, browser profiles, traces, and runtime
state remain private and ignored.

## Provenance

The runner built and measured a clean implementation commit before this result
document existed. The protocol hash identifies the method. The runnable build
hash covers sorted relative paths and bytes for every `.js` file under `dist/`,
not only the CLI entry module.

| Field                      | Recorded value                                                     |
| -------------------------- | ------------------------------------------------------------------ |
| Generated at               | `2026-08-14T00:39:51.116Z`                                         |
| Source commit              | `7259b0e462c716e73442c0ea5c8510982acb115c`                         |
| Working tree dirty         | `false`                                                            |
| Protocol                   | [`protocol.json`](protocol.json), version `1.0.0`                  |
| Protocol SHA-256           | `6385430669b2b80ad117aa7c0f7f821653fa92bdaf8872b3768ce6a00fc75b34` |
| Runnable `dist` JS SHA-256 | `2a839e6e27475f500cd28e47fe0dd49b617c1ddb9f588a53c3303f661dbb6a10` |
| Runnable `dist` JS files   | `34`                                                               |
| Runnable `dist` JS bytes   | `358861`                                                           |
| Build hash algorithm       | `complete-dist-js-tree-v1`                                         |
| Harness                    | `@blopai/browser-harness` `0.1.7`                                  |
| Playwright package         | `1.61.1`                                                           |
| Browser                    | Chromium `149.0.7827.55`, headless, all repetitions                |
| Browser executable         | Playwright-bundled Chromium                                        |
| Runtime                    | Node.js `v22.22.1`, Linux, `x64`                                   |
| Hostname                   | Redacted                                                           |
| Target                     | Controlled `127.0.0.1` `/session-metrics` fixture only             |
| Third-party sites          | None                                                               |
| Repetitions / timed phases | Three paired repetitions / six timed phases                        |

## Result summary

All three pairs were collected. Medians summarize the complete three-value
sets; they do not replace the raw rows below.

| Measurement | Reported values (sorted, ms) | Median (ms) | Minimum (ms) | Maximum (ms) |
| ----------- | ---------------------------- | ----------- | ------------ | ------------ |
| Cold start  | 1373.9, 1389, 1946.1         | 1389        | 1373.9       | 1946.1       |
| Warm resume | 754.5, 760.3, 800.9          | 760.3       | 754.5        | 800.9        |

## Raw per-phase evidence

Each row is one measured phase. `Harness ms` is summed tool-dispatch duration,
including time inside Playwright calls; it is not parent-process latency or
model time. Approval cells are requested/approved/denied.

<!-- session-metrics-results:start -->

| Repetition | Phase         | Status      | Parent ms | Commands (ok/error) | Snapshots | Harness retries | Approvals | Harness ms | Saturated |
| ---------- | ------------- | ----------- | --------- | ------------------- | --------- | --------------- | --------- | ---------- | --------- |
| 1          | `cold_start`  | `collected` | 1946.1    | 2 (2/0)             | 1         | 0               | 0/0/0     | 112.1      | `false`   |
| 1          | `warm_resume` | `collected` | 800.9     | 2 (2/0)             | 1         | 0               | 0/0/0     | 36         | `false`   |
| 2          | `cold_start`  | `collected` | 1373.9    | 2 (2/0)             | 1         | 0               | 0/0/0     | 69.4       | `false`   |
| 2          | `warm_resume` | `collected` | 754.5     | 2 (2/0)             | 1         | 0               | 0/0/0     | 38         | `false`   |
| 3          | `cold_start`  | `collected` | 1389      | 2 (2/0)             | 1         | 0               | 0/0/0     | 73.3       | `false`   |
| 3          | `warm_resume` | `collected` | 760.3     | 2 (2/0)             | 1         | 0               | 0/0/0     | 40.4       | `false`   |

<!-- session-metrics-results:end -->

The payload columns show Unicode code points/UTF-8 bytes/unmeasured values.
Image cells show count/data-URL code points/data-URL UTF-8 bytes/unmeasured.
Every token field was `null`, with availability `unavailable` and both source
and tokenizer `null`. Every phase also reported zero unclassified actions and
zero unclassified retries.

| Repetition | Phase         | Tool input | Tool output | Snapshot output | Model images | Tokens                         |
| ---------- | ------------- | ---------- | ----------- | --------------- | ------------ | ------------------------------ |
| 1          | `cold_start`  | 50/50/0    | 751/751/0   | 510/510/0       | 0/0/0/0      | null/null/null (`unavailable`) |
| 1          | `warm_resume` | 50/50/0    | 612/612/0   | 510/510/0       | 0/0/0/0      | null/null/null (`unavailable`) |
| 2          | `cold_start`  | 50/50/0    | 751/751/0   | 510/510/0       | 0/0/0/0      | null/null/null (`unavailable`) |
| 2          | `warm_resume` | 50/50/0    | 612/612/0   | 510/510/0       | 0/0/0/0      | null/null/null (`unavailable`) |
| 3          | `cold_start`  | 50/50/0    | 751/751/0   | 510/510/0       | 0/0/0/0      | null/null/null (`unavailable`) |
| 3          | `warm_resume` | 50/50/0    | 612/612/0   | 510/510/0       | 0/0/0/0      | null/null/null (`unavailable`) |

The final retained aggregates reconcile with the two phase deltas for each
fresh session.

| Repetition | Commands (ok/error) | Snapshots | Retries | Approvals | Harness ms         | Input     | Output      | Snapshot    |
| ---------- | ------------------- | --------- | ------- | --------- | ------------------ | --------- | ----------- | ----------- |
| 1          | 4 (4/0)             | 2         | 0       | 0/0/0     | 148.1              | 100/100/0 | 1363/1363/0 | 1020/1020/0 |
| 2          | 4 (4/0)             | 2         | 0       | 0/0/0     | 107.4              | 100/100/0 | 1363/1363/0 | 1020/1020/0 |
| 3          | 4 (4/0)             | 2         | 0       | 0/0/0     | 113.69999999999999 | 100/100/0 | 1363/1363/0 | 1020/1020/0 |

## Failures and auxiliary checks

Failures: **none**. All three fresh-session preconditions, warm readiness
checks, cold phases, warm phases, and teardown checks completed. No failed pair
was discarded or replaced. Each readiness check recorded the same active
Chromium version and exact loopback fixture URL outside the timer.

## Method

The fixed protocol used a fresh persistent profile and runtime root for every
pair. Both phases spawned the built Node CLI for the same `open` then `snapshot`
workflow and ended only after the parent parsed and validated the snapshot URL
and marker.

- Cold timing began before the first `open` spawn with no healthy daemon,
  profile, downloads, or artifacts.
- Warm timing began before the identical `open` spawn only after `status`
  verified the same daemon and browser outside the timer.
- Metrics reads, readiness, and `destroy` teardown stayed outside both timers.
- The parent used `performance.now()`; no public network or third-party site
  was involved.

## Limitations and privacy

This result has deliberately narrow interpretation and retention boundaries.

- The parent-process timings include CLI process spawn and response handling.
  Cold phases also include daemon startup and browser launch. Harness command
  durations answer a different question and must not be subtracted from them.
- Three local pairs do not predict another machine, browser interface, public
  website, host agent, model, network, or task. They are not a general speed,
  reliability, or task-success claim.
- Exact code-point and UTF-8 volumes are not token estimates. This workflow had
  no model provider, so provider and tokenizer usage stayed unavailable.
- Metrics omit work the harness cannot observe, including host/model context,
  provider retries, Playwright-internal polling counts, and CLI envelope bytes.
- Even without payload content, timings, command mix, approvals, payload sizes,
  versions, and workflow shape can be identifying or sensitive. The full raw
  report remains ignored and private; this reviewed summary contains no
  profile, trace, hostname, raw page content, or raw tool payload.
