# Candidate good first issues

This maintainer backlog contains small, useful contribution candidates grounded
in the current codebase. It isn't a remote issue tracker, and no GitHub issues
have been created from it. Review current behavior and ownership before
publishing any candidate.

## Add a `blop-browser --version` command

Expose the installed npm package version without starting a browser daemon.
Keep `--help` and all existing commands unchanged.

Acceptance criteria:

- `blop-browser --version` and `blop-browser version` print the exact package
  version and exit successfully.
- `--json` returns the normal response envelope with the version.
- CLI tests cover source execution and the built/symlinked executable path.
- The README command reference mentions the new command.

Likely files: `src/cli.ts`, `test/cli/cli.test.ts`, and `README.md`.

## Show the idle timeout in `doctor --json`

Make session-lifecycle diagnostics report the effective
`BLOP_BROWSER_IDLE_TIMEOUT_MS` value without starting a daemon.

Acceptance criteria:

- Doctor output includes the validated effective timeout in milliseconds.
- Default, custom, invalid, and below-minimum values have unit coverage.
- This issue does not change existing doctor fields or documented
  environment-variable behavior.
- The configuration table links the value to daemon lifecycle behavior.

Likely files: `src/cli.ts`, `test/cli/cli.test.ts`, and `README.md`.

## Add a scoped snapshot example to the agent skill

Document how an agent uses `browser_snapshot` input to reduce output while
retaining enough semantic context for the next action.

Acceptance criteria:

- The example uses an input shape accepted by the current tool schema.
- The guidance explains when to take a fresh full snapshot and why refs become
  stale.
- A CLI test or schema assertion prevents the documented input from drifting.
- The skill remains agent-neutral and doesn't add site-specific selectors.

Likely files: `skills/browser-harness/SKILL.md`, `src/tools/page.ts`, and
`test/cli/cli.test.ts`.

## Improve unavailable-browser doctor guidance

Return actionable, browser-specific next steps when `doctor` can't find
Chromium or Camoufox, without changing documented JSON fields in this issue.

Acceptance criteria:

- Human output distinguishes local Chrome/Chromium discovery from optional
  Camoufox installation.
- JSON adds fields rather than changing or removing existing fields.
- Tests cover both browsers unavailable and each browser available alone.
- Messages don't install software or make network calls automatically.

Likely files: `src/cli.ts`, `src/cli/runtime.ts`, and
`test/cli/cli.test.ts`.

## Add Windows session-name edge-case tests

Extend IPC validation coverage for names and paths that behave differently on
Windows, without weakening the existing portable session-name contract.

Acceptance criteria:

- Tests cover reserved names, separators, whitespace, and maximum length.
- Valid portable names continue to work.
- Invalid names fail before any runtime directory or daemon is created.
- Any platform-specific behavior is documented next to the validator.

Likely files: `src/cli/ipc.ts` and `test/cli/cli.test.ts`.

## Add benchmark result-schema validation

Provide a local command that validates run records against
`benchmarks/result.schema.json` before results are compared or uploaded.

Acceptance criteria:

- The validator reports a clear path and reason for every invalid required
  field.
- A complete fixture passes and fixtures with invented or missing measurement
  provenance fail.
- The command makes no network calls and adds no model-provider dependency.
- Benchmark documentation includes the exact validation command.

Likely files: `benchmarks/result.schema.json`, a new script under
`benchmarks/`, `test/benchmarks/`, and `package.json`.

## Record Playwright container startup phases

Add optional timing hooks around image/container readiness and browser
connection so the benchmark scaffold can distinguish cold start from warm
session latency.

Acceptance criteria:

- This issue does not change documented session behavior or return fields.
- Measurements use a monotonic clock and clearly name each phase.
- Hooks are opt-in and add negligible work when unused.
- Docker tests prove a reused container reports a warm path without asserting a
  machine-specific latency threshold.

Likely files: `src/session/playwright-container.ts`,
`test/session/playwright-container.test.ts`, and `benchmarks/README.md`.

## Add parallel CLI session isolation coverage

Exercise two named local CLI sessions concurrently against the fixture server
and prove that tabs, cookies, and semantic refs don't cross session boundaries.

Acceptance criteria:

- The test uses local fixtures and no public website.
- Both sessions run concurrently and use distinct runtime endpoints.
- A ref from one session is rejected or absent in the other session.
- Cleanup closes both daemons even when an assertion fails.

Likely files: `test/cli/cli.test.ts`, `test/fixtures/server.ts`, and
`src/cli/ipc.ts` only if a defect is found.

## Publish a Docker network configuration example

Add a minimal, tested example showing a caller and warm browser service on a
shared Docker network without exposing the browser server publicly.

Acceptance criteria:

- The example uses `BLOP_PLAYWRIGHT_NETWORK` and documents the Camoufox fallback
  through `BLOP_CAMOUFOX_NETWORK`.
- It binds no unauthenticated CDP or Playwright endpoint to a public interface.
- Commands are checked against the current container implementation.
- The example states which cleanup commands remove its named resources.

Likely files: a new document under `docs/`, `README.md`, and optionally a
non-production Compose example.

## Next steps

Before creating a remote issue, search current issues and recent commits,
confirm the candidate still applies, assign only the relevant files, and add
the repository's `good first issue` label. Keep one acceptance checklist per
issue so a new contributor can finish it independently.
