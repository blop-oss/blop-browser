# Mind2Web benchmark progression

This ledger tracks browser-agent performance changes against repeatable
Mind2Web tasks. Use it to detect regressions in task completion, tool use,
latency, and model-context efficiency.

## Evaluation contract

Record a run only when it meets these conditions:

- The task comes from the normalized Mind2Web dataset.
- The agent interacts with the live website through Blop Browser tools.
- The run uses no task-specific selectors, shortcuts, or silent action repair.
- Malformed tool calls and failed actions remain visible in the metrics.
- The model, provider, task ID, code commit, and run configuration are recorded.
- A passing result includes deterministic page evidence, not only model prose.

Live websites change over time. A failure caused by a changed website, login,
captcha, outage, or geolocation must be labeled separately from an agent or
harness regression.

## Tracked metrics

Each run records these metrics:

| Metric             | Meaning                                         |
| ------------------ | ----------------------------------------------- |
| Status             | Final `finish_test` verdict.                    |
| Duration           | Wall-clock test duration in milliseconds.       |
| Actions            | Browser actions recorded by the harness.        |
| Tool errors        | Failed tool executions.                         |
| Text-only nudges   | Agent turns that didn't call a tool.            |
| LLM calls          | Model requests made during the task.            |
| Peak input tokens  | Largest prompt sent in one model request.       |
| Total input tokens | Sum of prompt tokens across all model requests. |
| Output tokens      | Sum of model output tokens.                     |

## Regression policy

Treat a comparison as a likely regression when the model, task, and environment
are unchanged and any of these conditions occurs:

- A previously passing task fails for an agent or harness reason.
- Tool errors increase from zero to two or more.
- Duration increases by more than 30% across three runs.
- Total input tokens increase by more than 30% across three runs.
- LLM calls increase by more than 25% across three runs.
- The agent passes without deterministic evidence of the requested outcome.

Run each comparison three times before classifying performance-only changes.
Status and correctness regressions require immediate investigation and don't
need three reproductions when the failure is deterministic.

## Reference task

The first reference task is the Seattle hourly-weather task:

| Field       | Value                                                                    |
| ----------- | ------------------------------------------------------------------------ |
| Task ID     | `3cad7a9a-41bd-4c0a-9fd2-0cc34eb8e836`                                   |
| Split       | `test_domain`                                                            |
| Website     | `weather`                                                                |
| Instruction | Find the hourly weather forecast for Seattle, WA, for the next 24 hours. |
| Model       | `gemma4:31b-cloud`                                                       |
| Provider    | Ollama Cloud through local Ollama                                        |

## Progress log

The following runs established the initial benchmark baseline. The strict
comparison kept malformed actions visible and used no automatic selector or
tool-argument repair.

| Date         | Version                     | Status |   Duration | Actions | Tool errors | Nudges | LLM calls | Peak input | Total input | Output | Notes                                                                                                           |
| ------------ | --------------------------- | ------ | ---------: | ------: | ----------: | -----: | --------: | ---------: | ----------: | -----: | --------------------------------------------------------------------------------------------------------------- |
| July 9, 2026 | Before history compaction   | Pass   | 193,970 ms |      14 |           5 |      2 |        23 |     64,438 |     853,858 |    963 | Repeated full snapshots accumulated in history; several ARIA lines were used as malformed selectors.            |
| July 9, 2026 | `4aad09c` + `b4dc8e4`       | Pass   |  56,814 ms |      14 |           0 |      2 |        13 |     20,486 |     167,106 |    587 | Stale snapshots compacted; structured-target instructions clarified; strict malformed-action behavior retained. |
| July 9, 2026 | ARIA cap, run 1 (`ff3e2fe`) | Pass   |  45,227 ms |      14 |           0 |      0 |        11 |     14,400 |     107,955 |    490 | Default ARIA payload capped at 12,000 characters.                                                               |
| July 9, 2026 | ARIA cap, run 2 (`ff3e2fe`) | Pass   |  92,203 ms |      14 |           0 |      5 |        20 |     14,689 |     220,398 |  1,083 | Same code; five empty provider turns demonstrate model variance.                                                |

Initial change:

- Duration: `-70.7%`
- LLM calls: `-43.5%`
- Peak input tokens: `-68.2%`
- Total input tokens: `-80.4%`
- Tool errors: `5` to `0`

Peak input remained near 14.4K-14.7K across both capped-snapshot runs, down from
20.5K before the cap. Calls, output, and duration still vary with empty model
turns, so compare repeated runs rather than a single best result.

## Reliability improvements

Performance work also exposed failure modes that need hard safety boundaries:

- `7597447` detects short repeated action cycles using normalized page-state
  fingerprints. It stopped live 83-cycle and six-cycle search loops.
- `850b88f` records failed browser tools in the action trail, so reports and the
  cycle detector can observe repeated failures.
- `69b63bc` exposes provider reasoning effort as an explicit option. `low` and
  `none` passed but did not outperform the default reliably, so neither is a
  benchmark default.

## Rejected experiments

These experiments did not produce a stable improvement:

| Experiment                                         | Outcome                                                            | Decision  |
| -------------------------------------------------- | ------------------------------------------------------------------ | --------- |
| Stronger batching and critical-point prompt rules  | 22 calls, 16 actions, 1,173 output tokens.                         | Reverted. |
| Six-turn empty-response budget                     | Two consecutive failed runs entered action cycles.                 | Reverted. |
| Automatic compact observations after batches       | Three passes; median 13 calls, but median output increased to 689. | Reverted. |
| Exact-target prompt and strict-mode recovery prose | Slow passes and a cycle-guarded failure.                           | Reverted. |

Detailed results and rejected-run metrics live in `autoresearch.jsonl` and
`experiments/worklog.md` at the repository root.

## Run command

Use the same task and model when checking for regressions:

```bash
cd benchmarks/mind2web

export MIND2WEB_TASKS_PATH=/path/to/tasks.json
export BENCH_WEBSITE=weather
export BENCH_LIMIT=1
export BENCH_TASK_ID=3cad7a9a-41bd-4c0a-9fd2-0cc34eb8e836
export BLOP_AGENT_PROVIDER=ollama
export BLOP_AGENT_MODEL=gemma4:31b-cloud
export BLOP_AGENT_BASE_URL=http://localhost:11434/v1
export BLOP_AGENT_API_KEY=ollama

bun run bench:blop
```

## New entry template

Add one row to the progress log and include these details below it:

```markdown
### YYYY-MM-DD: Short change name

- Harness commit: `<sha>`
- Agent commit or version: `<sha-or-version>`
- Task ID: `<mind2web-task-id>`
- Provider and model: `<provider> / <model>`
- Browser and mode: `<browser> / <headless-or-headed>`
- Status and reason: `<status> / <reason>`
- Evidence: `<assertions, URL, screenshot, or extracted values>`
- Environment caveats: `<none-or-details>`
- Result directory: `<local-or-CI-artifact-path>`
```

Don't commit credentials, downloaded datasets, screenshots, or complete report
directories. Upload reports as CI artifacts when long-term evidence is needed.
