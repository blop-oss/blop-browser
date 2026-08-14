# Mind2Web live benchmark

This benchmark runs normalized Mind2Web tasks against live websites through
Blop Browser (`@blopai/browser-harness`). The benchmark owns task data and
browser setup. An agent adapter owns model calls and tool dispatch. The broader
[benchmark plan](../README.md) defines cold-start, warm-session,
authenticated-session, and parallel-isolation measurements that aren't yet
fully instrumented here.

Read [privacy and data flows](../../PRIVACY.md) before configuring dataset,
website, browser, model-provider, credential, or report handling.

Run live tasks only on targets you are authorized to automate. Dataset inclusion
doesn't grant current website permission. Review the
[acceptable-use policy](../../ACCEPTABLE_USE.md) before selecting tasks, and
exclude purchases, messages, account changes, access-control bypass, and other
consequential workflows.

<!-- prettier-ignore -->
> [!NOTE]
> The original Mind2Web benchmark scores predicted actions against cached HTML.
> This live variant measures end-to-end task execution on current websites. Its
> results aren't directly comparable to the original offline score.

## Agent boundary

The `Mind2WebAgentAdapter` interface receives the task, prompt, Playwright page,
and `NativeToolBridge[]` from the harness:

```ts
import type { Mind2WebAgentAdapter } from "./core.js";

const agent: Mind2WebAgentAdapter = {
  name: "my-agent",
  async run({ prompt, tools }) {
    // Register `tools` with your agent SDK, send `prompt`, and dispatch each
    // tool call to the matching `tool.execute(input)` function.
  },
};
```

This keeps the benchmark independent of an LLM provider or agent runtime. You
can implement adapters for Blop, Claude Code, Codex, Ollama, or another host
without changing the harness or task dataset.

Track benchmark baselines and regressions in
[`PROGRESS.md`](PROGRESS.md). Record the model, task ID, code version, metrics,
and environment caveats for every comparison run.

## Prepare the data

The Python utility downloads Mind2Web from Hugging Face and writes compact task
files under the ignored `data/` directory:

```bash
cd benchmarks/mind2web
uv sync --frozen
uv run mind2web-bench build --split test --limit 80
```

This step needs Python 3.10 or newer, `uv`, and network access to Hugging Face.
Downloaded data is ignored by Git.

You can reuse an existing task file by setting `MIND2WEB_TASKS_PATH` instead of
downloading the dataset again.

## Run with Blop

The Blop adapter exports plain agent-test objects. Blop remains the agent host;
the browser implementation comes from `@blopai/browser-harness`.

```bash
cd benchmarks/mind2web
bun install

export MIND2WEB_TASKS_PATH=/path/to/tasks.json
export BLOP_AGENT_PROVIDER=ollama
export BLOP_AGENT_MODEL=gemma4:31b-cloud
export BLOP_AGENT_BASE_URL=http://localhost:11434/v1
export BLOP_AGENT_API_KEY=ollama

BENCH_WEBSITE=weather BENCH_LIMIT=1 bun run bench:blop
```

The adapter supports these filters:

| Variable              | Effect                              |
| --------------------- | ----------------------------------- |
| `MIND2WEB_TASKS_PATH` | Path to normalized `tasks.json`.    |
| `BENCH_TASK_ID`       | Exact Mind2Web task ID.             |
| `BENCH_LIMIT`         | Maximum number of tasks.            |
| `BENCH_SPLIT`         | Exact split name.                   |
| `BENCH_WEBSITE`       | Case-insensitive website substring. |

Results are written to `.mind2web/blop/`.

## Add another agent

To add an agent, implement `Mind2WebAgentAdapter` and call `runMind2WebTask`.
The adapter must expose harness tools using the agent SDK's tool-registration
API and route tool calls to `NativeToolBridge.execute`. The agent must finish by
calling `finish_test`; this produces the benchmark verdict.

## Run the deterministic smoke test

The repository includes a local adapter test that uses a fixture server and no
model or downloaded dataset. Run it from the repository root:

```bash
bun run test:benchmark-smoke
```

This verifies the runner, prompt, action trail, strict evidence gate, and metric
aggregation. It doesn't produce a live Mind2Web quality result.

## Record portable results

Use [`../result.schema.json`](../result.schema.json) for comparison records. The
current host reports don't yet populate every field in that schema. Record
unavailable values as `null` with a measurement note rather than inventing a
number or treating an unrun check as a pass.
