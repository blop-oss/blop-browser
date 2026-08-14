# Agent instructions for `@blopai/browser-harness`

This repository contains the open-source Playwright browser harness used by AI
agents. Keep changes focused on controlled browser tools, browser sessions,
semantic page observations, and transport. Host frameworks such as Blop CLI own
the agent loop, prompts, test DSL, lifecycle policy, reporting, and uploads.

<!-- prettier-ignore -->
> [!IMPORTANT]
> Treat browser tools as a safety boundary. Do not expose arbitrary page
> scripts, shell commands, unrestricted CDP commands, or automatic repair of
> malformed actions without explicit review.

## Repository layout

Use this map to find the correct layer before editing code.

```text
src/
  index.ts                 Public package exports
  types.ts                 Harness action, log, and artifact types
  create-tools.ts          Tool factory, recording, and shared behavior
  screencast.ts            CDP live JPEG screencast
  tools/
    locators.ts            Structured target parsing and resolution
    references.ts          Semantic snapshots and scoped element references
    action-outcome.ts      Compact before-and-after action feedback
    page.ts                Snapshots, viewport tools, and screenshots
    navigation.ts          Navigation and wait operations
    mouse.ts               Click, hover, and drag operations
    keyboard.ts            Fill, press, focus, and clear operations
    forms.ts               Check, select, and upload operations
    assertions.ts          Retrying browser assertions
    extract.ts             Bounded structured extraction
    batch.ts               Controlled multi-step execution
    lifecycle.ts           Critical points and test completion
    logs.ts                Browser log evidence
    tabs.ts                Page and popup management
  session/
    playwright-container.ts
    bun-ws-compat.ts
test/
  browser/                 Real-browser tool behavior tests
  session/                 Optional Docker container tests
  benchmarks/              Benchmark adapter tests
  fixtures/                Local HTTP and file fixtures
benchmarks/
  mind2web/                Agent-neutral live benchmark and host adapters
```

## Package boundaries

Preserve these boundaries when adding features.

- Keep tool implementations independent of any model provider or agent SDK.
- Use framework-neutral names such as `HarnessAction`, not Blop-specific names.
- Keep prompts limited to concise tool-use contracts. Put orchestration policy
  in the host agent.
- Keep benchmark definitions agent-neutral. Put model execution in adapters.
- Keep platform uploads, reporters, and test DSL behavior out of this package.
- Do not add task-specific selectors, URLs, website rules, or expected answers
  to production tools.
- Do not hide tool errors or silently change benchmark verdicts.

## Tool contracts

Tools must remain explicit, strict, observable, and bounded.

- Prefer structured targets such as `{ role, name }`, `{ label }`, and
  `{ ref }` over generated CSS selectors.
- Preserve Playwright strictness. Ambiguous targets must fail unless the caller
  explicitly requests `first`.
- Reject stale semantic references instead of resolving them to similar nodes.
- Keep references scoped to the page state that produced them.
- Preserve Playwright visibility and actionability checks after reference
  resolution.
- Record successful and failed actions in the action trail.
- Return concise, deterministic errors with enough state for recovery.
- Bound collections, text fields, snapshots, batch sizes, and extraction
  results.
- Never convert a structured target to display text before calling
  `locateTarget`.

## Semantic observations

The default snapshot is a compact semantic interaction view. Full ARIA output
is an explicit fallback, not the default representation.

- Do not return the semantic view and a duplicate full ARIA tree by default.
- Include exact roles, names, values, states, destinations, frame identity, and
  valid actions when available.
- Collect frame-hosted controls and require references when page-level locators
  cannot cross the frame boundary.
- Treat `occluded` as evidence, not proof. Layout overlap can produce false
  positives, so blocker enforcement requires careful live evaluation.
- Preserve content needed to choose an action, not only interactive controls.
- Keep compression reversible through omitted counts, scoped observations, or
  explicit ARIA escalation.
- Do not mutate application DOM to create references when Playwright locators
  can be retained in memory.
- Do not use model-based or task-aware pruning in the core harness.

## Action outcomes

Interaction results may include compact state changes to reduce unnecessary
snapshots. Keep this feedback narrow and evidence-based.

- Report URL, title, focus, dialog, alert, and meaningful content changes.
- Avoid unconditional waits after every action. Live experiments showed that
  generalized settling delays increase calls and token usage.
- Add action-specific settling only when repeated benchmark results demonstrate
  a stable gain.
- Do not treat dynamic body text, advertisements, or clocks as reliable proof
  of task progress.
- Keep the runner's cycle guard as a final safety boundary.

## Implementation style

Make the smallest correct change and follow the existing TypeScript style.

- Use ESM imports with `.js` extensions in TypeScript source files.
- Keep public types framework-neutral and export them deliberately.
- Prefer one browser round trip with `evaluateAll` over repeated locator reads.
- Use Playwright locators and browser semantics instead of custom selector
  engines.
- Keep timeouts explicit and consistent with nearby tools.
- Add comments only for non-obvious safety, lifecycle, or performance behavior.
- Use ASCII unless an existing fixture requires localized text.
- Do not edit generated `dist/` files manually. Run `bun run build`.

## Tests

Use deterministic local fixtures for tool behavior. Live websites belong in
benchmarks, not the unit test suite.

- Add regression coverage for every corrected tool contract.
- Test strict ambiguity, stale references, frame scope, invalid affordances,
  bounded output, and failure recording when relevant.
- Prefer `setupToolPage` and the local fixture server over public websites.
- Keep optional container tests skippable when Docker is unavailable.
- Do not weaken assertions to accommodate stochastic live behavior.

Run focused tests while developing:

```bash
bun test test/browser/structured-target-tools.test.ts
bun test test/browser/keyboard-tools.test.ts
bun run test:benchmarks
```

Run the full verification sequence before finalizing a change:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
```

## Live benchmarks

Mind2Web runs exercise real sites and model providers. Treat their results as
stochastic evidence rather than deterministic tests.

- Pin the task ID, model, provider, and browser settings for comparisons.
- Run performance experiments at least three times.
- Compare medians, failure modes, and pass rates, not only the best run.
- Separate harness failures from localization, consent, bot detection, network,
  provider, and website failures.
- Keep correctness and zero hidden tool errors as hard gates.
- Reject changes that reduce one snapshot but increase total calls or tokens.
- Use `--progress-file` for long runs so progress is observable.
- Set a bounded `--max-steps` during diagnostics to prevent expensive loops.
- Keep generated reports, screenshots, credentials, and datasets out of Git.

Example focused run through a local Blop CLI checkout:

```bash
MIND2WEB_TASKS_PATH=/path/to/tasks.json \
BENCH_TASK_ID=<task-id> \
BLOP_AGENT_PROVIDER=ollama \
BLOP_AGENT_MODEL=gemma4:31b-cloud \
BLOP_AGENT_BASE_URL=http://localhost:11434/v1 \
BLOP_BROWSER_ANTI_BOT=on \
bun run /path/to/blop/src/cli/index.ts test \
  benchmarks/mind2web/adapters/blop.blop.ts \
  --browser camoufox \
  --report-dir benchmarks/mind2web/.mind2web/local-run \
  --progress-file benchmarks/mind2web/.mind2web/local-progress.ndjson \
  --max-steps 60 \
  --reporter all
```

## Local package linking

Blop CLI may consume this package through a pnpm `file:` dependency. Existing
compiled files can be hard-linked while newly added files are absent from the
pnpm store.

After adding a new source module:

1. Run `bun run build` in this repository.
2. Confirm the compiled module exists under the consuming package.
3. If it is missing, run `pnpm install --offline --force` in the consuming
   workspace.
4. Confirm the consuming package resolves the current `dist` files before
   running a benchmark.

Do not count dependency-resolution failures as benchmark results.

## Git safety

The worktree may contain changes from the user or another agent.

- Do not revert or modify changes you did not create.
- Do not use `git reset --hard`, destructive checkout commands, or interactive
  Git operations.
- Keep independent fixes in separate commits when practical.
- Revert performance experiments that fail repeated evaluation.
- Do not amend commits unless the user explicitly requests it.
- Check `git status` before and after your work.

## Completion checklist

Before reporting completion, confirm the following conditions.

- The change stays inside the harness package boundary.
- Tool failures remain visible and recorded.
- New output is bounded and does not duplicate existing context unnecessarily.
- Structured targets reach `locateTarget` without lossy conversion.
- Typecheck, relevant tests, full tests, and build results are reported.
- Live benchmark claims include task, model, repetitions, and failure context.
- The worktree contains no accidental generated artifacts.
