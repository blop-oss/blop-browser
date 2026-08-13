## Summary

Describe the problem and the focused change that solves it.

## Compatibility and safety

Explain any effect on the `@blopai/browser-harness` package, `blop-browser`
commands, imports, tool schemas, environment variables, session state, or links.
State whether the change expands browser execution capability or touches the
bounded-tool safety boundary.

## Verification

List the exact commands you ran and their results. Call out Docker, live-browser,
or benchmark checks that skipped or weren't run.

- [ ] `bun run format:check`
- [ ] `bun run check:links`
- [ ] `bun run lint`
- [ ] `bun run typecheck`
- [ ] Focused tests
- [ ] `bun run test`
- [ ] `bun run build`
- [ ] `npm pack --dry-run`

## Evidence

Add sanitized output, screenshots, or benchmark run records when they materially
help reviewers. Don't include credentials, CDP secrets, authenticated state,
private application data, or unsupported performance claims.

## Checklist

- [ ] I added or updated regression coverage for behavior changes.
- [ ] I updated public documentation and examples where needed.
- [ ] Tool failures remain visible and output remains bounded.
- [ ] I didn't edit generated `dist/` files manually.
