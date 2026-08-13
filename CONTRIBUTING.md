# Contributing to Blop Browser

Blop Browser welcomes focused changes to controlled browser tools, persistent
sessions, semantic observations, transport, documentation, and benchmark
adapters. This guide explains the project boundaries and the checks required
before a pull request.

## Before you start

Use an issue for behavior changes that affect public tool schemas, CLI
compatibility, security boundaries, or session lifecycle. Small documentation,
test, and bug-fix pull requests can start directly when their scope is clear.

Read these files before changing behavior:

- [`AGENTS.md`](AGENTS.md) for architecture and safety constraints.
- [`README.md`](README.md) for the public CLI and TypeScript contracts.
- [`test/browser/README.md`](test/browser/README.md) for browser-test scope.
- [`benchmarks/README.md`](benchmarks/README.md) for benchmark evidence rules.

Do not include credentials, authenticated storage state, downloaded datasets,
screenshots from private applications, or generated benchmark reports in a
commit.

## Set up the repository

You need Node.js 22 or newer, Bun 1.3.13, and a Chrome, Chromium, or Playwright
Chromium installation. Docker is optional and only required for container
session tests.

```bash
git clone https://github.com/blop-oss/blop-browser.git
cd browser-harness
bun install --frozen-lockfile
bunx playwright install chromium
```

Confirm the CLI can inspect the environment without starting a session:

```bash
bun run build
node dist/cli.js doctor --json
```

## Make a focused change

Keep tool behavior explicit, strict, observable, and bounded. In particular,
don't add arbitrary page-script execution, unrestricted CDP, silent argument
repair, hidden retries, or host-agent policy to the core package.

Follow these implementation rules:

- Preserve the npm package name `@blopai/browser-harness`, the `blop-browser`
  executable, existing environment variables, imports, and response envelopes.
- Add public exports deliberately through `src/index.ts`.
- Use ESM imports with `.js` extensions in TypeScript source.
- Prefer structured targets such as `{ role, name }`, `{ label }`, and
  `{ ref }` over generated CSS selectors.
- Reject stale references and strict-target ambiguity instead of guessing.
- Bound collections, snapshots, extraction output, and batch sizes.
- Record both successful and failed browser actions.
- Use deterministic local fixtures for tests; reserve live websites for
  benchmarks.
- Don't edit `dist/` manually. The build regenerates it.

## Run the checks

Run focused tests during development, then run the complete verification
sequence before opening a pull request.

```bash
bun install --frozen-lockfile
bun run format:check
bun run check:links
bun run lint
bun run typecheck
bun run test
bun run build
npm pack --dry-run
```

Useful focused commands include:

```bash
bun run test:browser
bun run test:cli
bun run test:benchmark-smoke
bun run test:session
```

The Docker suites skip when Docker isn't available. If your change touches
`src/session/`, run the relevant container suite with a working Docker daemon
and state clearly in the pull request whether it ran or skipped.

## Update documentation

Update public documentation whenever behavior, configuration, requirements, or
output changes. Keep claims tied to code or primary documentation, and don't
add benchmark numbers without a reproducible run record.

Check local Markdown links and referenced assets before submitting. When you
change a heading, search for links to its old anchor.

## Open a pull request

Keep each pull request centered on one problem. The description must include
the motivation, compatibility impact, tests actually executed, and any checks
that were skipped.

A review is ready when it demonstrates these conditions:

- Existing commands, imports, configuration, and links remain compatible, or a
  deliberate breaking change is clearly proposed and approved.
- New behavior has regression coverage at the closest layer.
- Tool errors remain visible, semantic references remain scoped, and output
  remains bounded.
- The full verification sequence passes, apart from explicitly explained
  environment-dependent skips.
- Documentation and examples match the shipped behavior.

## Report security problems

Don't disclose a possible vulnerability in a public issue. Follow the private
reporting process in [`SECURITY.md`](SECURITY.md).
