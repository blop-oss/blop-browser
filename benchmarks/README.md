# Blop Browser benchmark plan

This directory defines a reproducible, agent-neutral evaluation scaffold for
Blop Browser and comparable browser interfaces. It separates deterministic
local checks from live-site and model-dependent measurements, and it provides a
shared output schema without claiming results that haven't been run.

Run benchmarks only against local fixtures or websites and accounts you are
authorized to automate. The [acceptable-use policy](../ACCEPTABLE_USE.md)
applies to dataset selection, browser modes, task execution, and retained
evidence.

## Evaluation questions

The benchmark program measures whether a browser interface helps the same agent
complete the same tasks reliably and efficiently. Each comparison must pin the
agent, model, prompt policy, task data, browser mode, hardware, network, and
repetition count.

The required measurement categories are:

- **Task success rate:** strict passes divided by attempted tasks, with page
  evidence and zero hidden tool errors required for a pass.
- **Context and token usage:** input, output, and total tokens from the host or
  provider. Record `null` with an explanation when the provider doesn't expose
  usage; don't estimate it from characters.
- **Wall-clock time:** monotonic elapsed time from task start to final verdict.
- **Cold-start latency:** time from a stopped or absent browser service to the
  first usable page observation.
- **Warm-session latency:** time from a ready reused service to the first usable
  isolated page observation.
- **Authenticated-session handling:** whether a prepared test account remains
  authenticated, needs an explicit restore, or fails. Never store credentials
  in the result.
- **Parallel-session isolation:** whether concurrent sessions keep cookies,
  storage, tabs, refs, artifacts, and teardown independent.

## Current scaffold

The existing Mind2Web implementation covers task loading, agent-neutral tool
dispatch, strict final-page evidence, wall-clock duration, browser actions,
tool errors, model calls, and provider-reported token usage.

Use these artifacts together:

- [`detection/README.md`](detection/README.md) for the loopback-only Chromium
  and Camoufox signal protocol. It records browser-observable evidence and
  limitations, not a detection score.
- [`mind2web/README.md`](mind2web/README.md) for dataset preparation and live
  execution.
- [`mind2web/core.ts`](mind2web/core.ts) for the agent-neutral task runner.
- [`mind2web/metrics.ts`](mind2web/metrics.ts) for current report aggregation.
- [`mind2web/PROGRESS.md`](mind2web/PROGRESS.md) for historical run discipline.
- [`result.schema.json`](result.schema.json) for portable comparison records.
- `test/benchmarks/mind2web.test.ts` for a deterministic local smoke test.
- `test/session/` for warm-container reuse and isolation behavior.

The output schema is broader than the current Mind2Web reporter on purpose.
Cold-start phases, authenticated-session outcomes, and parallel isolation still
need instrumentation or dedicated fixtures before a complete comparison record
can be produced.

## Run deterministic local checks

The local smoke test needs no dataset, model credentials, or public website. It
uses the repository fixture server and an injected deterministic adapter.

```bash
bun install --frozen-lockfile
bun run test:benchmark-smoke
```

Run session-infrastructure checks separately:

```bash
bun run test:session
```

Those suites skip cleanly when Docker isn't available. A skip is an environment
result, not evidence that warm-session or parallel isolation behavior passed.

## Prepare Mind2Web data

The live runner uses normalized Mind2Web tasks stored outside Git. You need
Python 3.10 or newer, `uv`, network access to Hugging Face for the initial
download, a supported agent host, and model-provider credentials.

Mind2Web task data doesn't grant permission to automate the current website.
Before building a live task set, remove tasks that aren't permitted by the
target's current terms or that require purchases, messages, account changes,
CAPTCHA bypass, or other consequential actions. Treat rate limits, CAPTCHAs,
and access denials as terminal site outcomes.

```bash
cd benchmarks/mind2web
uv sync --frozen
uv run mind2web-bench build --split test --limit 80
```

The normalized file defaults to `benchmarks/mind2web/data/tasks.json`. You can
instead set `MIND2WEB_TASKS_PATH` to a compatible existing file. Dataset files,
credentials, screenshots, and full result directories remain ignored.

## Run a focused live task

Pin one task while validating an adapter. The example uses the existing Blop
host adapter; substitute a controlled provider and model available in your
environment.

```bash
cd benchmarks/mind2web
bun install --frozen-lockfile

export MIND2WEB_TASKS_PATH="$PWD/data/tasks.json"
export BENCH_TASK_ID="<mind2web-task-id>"
export BENCH_LIMIT=1
export BLOP_AGENT_PROVIDER="<provider>"
export BLOP_AGENT_MODEL="<model>"
export BLOP_AGENT_API_KEY="<secret-from-your-environment>"

bun run bench:blop
bun ../../benchmarks/mind2web/metrics.ts .mind2web/blop
```

The current adapter writes host reports under `.mind2web/blop/`. The metrics
command exits unsuccessfully when the strict pass gate fails.

## Comparison protocol

Use the same protocol for Blop Browser and every comparison interface. Don't
tune the task, prompt, or evidence rule for one system after seeing its result.

1. Pin repository commits or released versions, the agent host, model, provider,
   reasoning settings, browser version, task IDs, and machine environment.
2. Prepare an empty test profile for unauthenticated tasks and a dedicated
   non-production account for authenticated tasks.
3. Run at least three cold-start repetitions after removing only resources the
   interface documents as safe to recreate.
4. Start or retain the documented reusable service, then run at least three
   warm-session repetitions with new isolated sessions.
5. Run the same fixed task set and collect strict pass evidence, provider usage,
   wall-clock time, and categorized failures.
6. Start at least two sessions concurrently against a local fixture with
   different cookies, storage values, tabs, and page refs. Verify both positive
   isolation and independent teardown.
7. Run authenticated tasks against the dedicated account, recording only an
   outcome class and sanitized evidence.
8. Write one JSON record that conforms to `result.schema.json`, including `null`
   values and measurement notes for unavailable metrics.
9. Compare success counts and medians across repetitions. Preserve raw run
   records and report failure classes; don't report only the best run.

## Failure classification

Classify each non-pass so harness regressions aren't mixed with external site or
provider failures.

Use one of these classes:

- `agent`: planning, localization, or invalid tool choice.
- `harness`: tool, reference, transport, lifecycle, or isolation defect.
- `site`: changed UI, outage, unavailable content, or deterministic site error.
- `authentication`: expired session, access denial, MFA, or test-account issue.
- `bot_detection`: captcha, challenge, or automated-traffic block.
- `network`: DNS, proxy, egress, or connection failure outside the harness.
- `provider`: model API error, empty response, quota, or unavailable usage data.
- `environment`: missing browser, Docker, display, dependency, or machine
  resource.
- `unknown`: insufficient evidence; include a note describing what's missing.

## Output schema

`result.schema.json` stores comparison metadata and per-run measurements. A run
must never substitute zero for an unobserved measurement; use `null` and explain
the gap in `measurement_notes`.

The schema requires source versions, task identity, browser mode, environment,
outcome, wall-clock time, startup classification, authentication handling, and
parallel-isolation status. Token fields accept `null` because some hosts don't
report usage.

Schema validation automation remains to be implemented. Until then, validate
records with any JSON Schema 2020-12 validator and include the validator name
and version in review notes. A candidate implementation is scoped in
[`../docs/good-first-issues.md`](../docs/good-first-issues.md).

## What remains before publishing a comparison

The repository can run deterministic adapter tests now, but a fair multi-system
benchmark needs external inputs and additional measurement work.

- Obtain and record the Mind2Web dataset revision and selected task IDs.
- Choose released versions of all interfaces and one agent/model configuration.
- Implement adapters that preserve each interface's documented mode without
  silently adding capabilities.
- Add monotonic phase timing around cold and warm service startup.
- Build a local authenticated fixture or provision dedicated test accounts with
  an approved credential-injection process.
- Add a parallel-session fixture that checks cookies, storage, tabs, refs,
  artifacts, and teardown for each interface.
- Run at least three repetitions per condition on the same machine and network.
- Review sanitized evidence and schema-valid records before publishing results.

No comparative result is included because those prerequisites haven't been
completed in this repository.
