# Browser session metrics

Browser session metrics provide a bounded, framework-neutral aggregate of work
that Blop Browser can observe directly. Use them to inspect one session or to
build a reproducible local comparison. They do not retain tool payload content
or claim model-provider token usage. The
[privacy and data-flow contract](../PRIVACY.md) covers the surrounding browser,
host, and retained-data flows.

## Export CLI metrics

Use `metrics` while a named session is active or after a persistent session has
closed:

```bash
blop-browser --session checkout metrics
blop-browser --session checkout metrics --json
```

The CLI writes `browser-metrics.json` in the session artifact directory when a
daemon starts and after each completed command or lifecycle transition. It
creates the directory with mode `0700` and the file with mode `0600`. Writes
use a temporary file and atomic rename.

An offline `metrics` command reads the last complete aggregate without starting
a daemon. It returns a zero-command aggregate when no retained file exists.
Malformed and oversized retained files fail closed instead of being resumed.

## Understand the aggregate

The `HarnessSessionMetrics` version 1 contract reports only values the harness
can observe without a model provider or host framework:

- Commands use the exhaustive public browser-tool registry as fixed buckets.
  The aggregate reports total, succeeded, failed, snapshot, and unclassified
  action counts.
- Durations measure each browser tool from harness dispatch until its success
  or recorded failure. They do not include a host's planning or model time.
- Retries count explicit harness-owned checks after the first attempt. They
  exclude Playwright's internal polling, network and page-load polling, host or
  agent retries, and model-provider retries.
- Approvals count approved and denied policy decisions, including an approved
  action that later fails in Playwright.
- Payload volume reports exact Unicode code points and UTF-8 bytes for
  serialized tool inputs, returned tool content, the snapshot subset, and
  model-image data URLs. `characters` never means JavaScript UTF-16 code units.
  An `unmeasured` counter remains visible when a value cannot be serialized.
- Token counts are `null`, with `availability: "unavailable"`, because the
  harness cannot observe a provider's tokenizer or request context. It never
  estimates tokens from characters.

`saturated: true` means at least one bounded numeric field was clipped. Do not
treat a saturated aggregate as exact performance evidence.

The recorder caps compact JSON at 64 KiB. Its command buckets come only from
the exhaustive public tool registry, so a caller-controlled name cannot grow
the aggregate. Unknown names increment bounded unclassified counters.

## Interpret session time

`observedActiveMs` is the sum of active recorder segments, not the browser's
age or elapsed wall time since the session was first created. A new segment
starts when a daemon opens or resumes a retained aggregate. Time while a
persistent session is closed and browser lifetime before recorder
initialization are excluded.

Retained active time is current through the latest successful metrics write.
An abrupt process exit can lose the unpersisted idle tail of that segment; the
next process still starts a distinct segment instead of pretending the clocks
were continuous.

Use command durations for harness execution cost. Use an external monotonic
clock with explicit process-boundary definitions for cold-start or warm-resume
latency. The
[local session metrics protocol](../benchmarks/session-metrics/README.md)
defines one such measurement for the built CLI.

## Use the embedding API

Create a recorder and pass it to `createBrowserTools()` when embedding the
harness in another host:

```ts
import {
  createBrowserTools,
  createSessionMetricsRecorder,
} from "@blopai/browser-harness";

const sessionMetricsRecorder = createSessionMetricsRecorder();
const tools = await createBrowserTools({
  // ...page, action, artifact, and finish-state options
  sessionMetricsRecorder,
});

const metrics = sessionMetricsRecorder.snapshot();
const json = sessionMetricsRecorder.json(true);
```

Pass a previously validated `initialMetrics` aggregate to continue counts in a
new process. The recorder increments `observedActiveSegments` and excludes the
inactive gap. It does not retain prior raw inputs or outputs.

If a recorder callback throws after a browser action runs, the harness does not
retry the action or convert a completed action into a tool failure. It adds a
sanitized `metricsRecordingError` to action metadata. The CLI reports recorder,
export, and persistence failures through `status --json`; an export failure is
also added to the latest action metadata when one exists.

## Control retention and privacy

Metrics retain counts and volumes, not payload content. They can still reveal
workflow shape, timing, command mix, approval frequency, output size, and image
use. Review an aggregate before sharing it.

Retention follows the session artifact lifecycle:

- A persistent managed session retains metrics after close, idle shutdown, or
  a crash. Reopening the same session continues the aggregate as a new active
  segment.
- A disposable managed session removes metrics with its profile, downloads,
  and artifacts on close or idle shutdown.
- An attached Chrome session stores metrics only in Blop Browser's managed
  artifact directory.
- `blop-browser --session NAME destroy` removes retained metrics with the other
  managed session state.

An embedding host owns persistence and deletion outside the standalone CLI.
Follow the [acceptable-use policy](../ACCEPTABLE_USE.md) when collecting or
sharing workflow evidence.
