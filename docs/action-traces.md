# Browser action traces

Browser action traces provide a bounded, ordered record of browser commands for
debugging and authorized post-mortem review. You can export the same trace as
machine-readable JSON or a compact human timeline.

## Export a CLI trace

Use `trace` while a named session is active or after a persistent session has
closed:

```bash
blop-browser --session checkout trace
blop-browser --session checkout trace --json
```

The CLI writes `browser-trace.json` and `browser-trace.txt` in the session's
artifact directory after each completed command. It creates the directory with
mode `0700` and the trace files with mode `0600`. Writes use temporary files
and atomic renames, so a process crash leaves either the previous complete
trace or the new complete trace.

Set an optional agent identifier before the daemon starts when several agents
share an external reporting system:

```bash
BLOP_BROWSER_AGENT_ID=review-agent \
  blop-browser --session checkout open https://staging.example.com
```

The session name is always included as `identity.sessionId`. The environment
value becomes `identity.agentId`.

## Understand the event contract

Each event has enough information to reconstruct the command order without
replaying it. The public `HarnessTraceEvent` contract includes these fields:

- A monotonic `sequence`, start and completion timestamps, and duration.
- Optional session and agent identity.
- An `action`, `batch`, or `lifecycle` kind and an explicit read/write
  classification.
- The command, bounded redacted input, and semantic target references.
- Redacted URLs before and after the command.
- A succeeded or failed status with a bounded result or error.
- The tool result's content and trust boundary when available.
- Approved or denied policy metadata when an approval policy applies.
- Screenshot indexes and screencast frame positions when the host provides
  them.

Every public browser tool is explicitly classified as `read`, `write`, or
`batch`. A batch event is an envelope, not a second browser mutation; each
inner command still receives its own ordered trace event. Failed and
policy-denied attempts remain in the same sequence as successful commands.

Session start, close, and destroy transitions use lifecycle events. A destroy
response can include its final lifecycle event, but `destroy` then removes the
managed artifact directory, including retained trace files.

## Use the embedding API

Create a recorder and pass it to `createBrowserTools()` when you embed the
harness in another framework:

```ts
import {
  createBrowserTools,
  createTraceRecorder,
} from "@blopai/browser-harness";

const traceRecorder = createTraceRecorder({
  identity: { sessionId: "checkout", agentId: "review-agent" },
  maxEvents: 100,
});

const tools = await createBrowserTools({
  // ...page, action, artifact, and finish-state options
  traceRecorder,
});

const immutableTrace = traceRecorder.snapshot();
const json = traceRecorder.json(true);
const timeline = traceRecorder.timeline();
```

`snapshot()` and `events()` return deeply frozen copies. The recorder keeps a
bounded in-memory ring and reports dropped entries through `omittedEvents`.
Hosts can pass an explicit `stateChanging` value when recording a
framework-defined action that isn't part of the public browser tool registry.

If an external recorder throws after a browser command runs, the harness does
not retry or convert the completed command into a tool failure. It adds a
sanitized `traceRecordingError` to the normal action metadata and calls the
host's action callback once. The CLI also reports trace persistence failures in
`status --json`.

## Review redaction and size boundaries

Trace redaction reduces accidental credential retention, but it is not a data
loss prevention system. Review exports before sharing them.

The recorder redacts `browser_type` text, values, file paths, common
secret-bearing keys, URL credentials, URL query and fragment values, and
recognized secret patterns. It also applies redaction to results, errors,
approval reasons, identity strings, media paths, and secret-labelled URL path
segments. Redacted string and array inputs retain only type and length
summaries when useful for debugging.

By default, the recorder retains at most 100 events, limits individual strings
to 1,000 characters, and caps compact JSON and human output at 768 KiB. It
drops the oldest events to meet the byte ceiling and increments
`omittedEvents`. The CLI rejects oversized or malformed persisted traces before
offline export.

<!-- prettier-ignore -->
> [!WARNING]
> Browser result text can contain secrets that don't match a known pattern.
> Screenshots contain pixels from the page, and trace metadata can reveal
> visited origins, command timing, target labels, and workflow intent. Don't
> treat redaction as proof that an export is anonymous or safe to publish.

Follow the [acceptable-use policy](../ACCEPTABLE_USE.md): collect only the data
needed for an authorized workflow, and handle personal, confidential, and
authentication data safely. See the [security policy](../SECURITY.md) for the
broader browser and prompt-injection boundaries.

## Control retention

Trace retention follows the session artifact lifecycle. Choose the profile
mode based on your post-mortem and deletion requirements.

- A persistent managed session retains bounded trace files after explicit
  close, idle shutdown, or a crash. `trace` reads the last complete files while
  the daemon is offline. Reopening the same session appends new lifecycle and
  action events to the bounded sequence. `destroy` removes them with the other
  managed artifacts.
- A disposable managed session removes its trace files, browser profile,
  downloads, and artifacts on close or idle shutdown. Offline export is empty
  after that deletion.
- An attached CDP session stores traces only in Blop Browser's managed artifact
  directory. `destroy` removes those artifacts but preserves the external
  Chrome profile.

Use `blop-browser --session NAME destroy` when retained trace data is no longer
needed. A host that embeds the recorder owns persistence and deletion outside
the standalone CLI.
