# When to choose Blop Browser

Choose Blop Browser when an agent host needs a bounded browser-tool contract and
an explicit session lifecycle more than it needs unrestricted Playwright code.
This guide maps that positioning to implementation and a deterministic local
proof. It also identifies cases where Playwright or another agent interface is
the more direct choice.

Use browser automation only on websites, accounts, and data you own or are
authorized to access. Review the [acceptable-use policy](../ACCEPTABLE_USE.md)
before attaching a profile or automating a site.

## Proof boundaries

This is an architectural contract proof, not task-success, security, or performance evidence.
It verifies specific behavior against a bundled loopback page. It does not
measure model quality, completion rate, latency, token use, browser startup
speed, site compatibility, or resistance to hostile content.

The proof is also not a security certification. Read-only mode bounds input
dispatch through the harness, but page loading can run JavaScript, make network
requests, set cookies, and trigger server-side effects. Profile separation does
not replace operating-system, container, or network isolation.

## Run the local proof

The supported demo builds the package, starts an HTTP fixture bound only to
`127.0.0.1`, creates temporary browser state, and invokes the built CLI as
separate Node.js processes. It accepts no URL or other input.

```bash
bun install --frozen-lockfile
bun run demo:positioning
```

The command fails on the first broken invariant and returns a bounded JSON
report when every check passes. Its `scope` object labels the result as
`architectural-contract` evidence and explicitly excludes task-success,
security, and performance evidence. The runner destroys all three named
sessions, stops the loopback fixture, and removes its temporary runtime
directory in a `finally` block.

The proof exercises this sequence:

1. Start two named managed sessions concurrently against the local fixture.
2. Verify that their profile and download paths differ and that browser storage
   written in one session is absent from the other.
3. Request one semantic control, verify that additional controls are reported
   as omitted, and act through the returned opaque reference from another CLI
   process.
4. Verify that separate commands reuse one daemon and retain live page state,
   then navigate and confirm that the old reference is rejected as stale.
5. Close and reopen a persistent session and confirm that its local storage is
   restored.
6. Inspect the reported profile mode, storage scope, paths, owner, expiry, and
   destruction contract.
7. Start a disposable read-only session, confirm that a pointer action is
   denied before dispatch, and verify that close removes its managed state.
8. Destroy both persistent sessions and confirm that their managed profiles are
   gone.

The [proof runner](../scripts/demo-positioning-proof.mjs) is readable and uses
the same public CLI entry that an installed package exposes. CI runs it after
the package build.

## Choose Blop Browser when

Blop Browser is a focused fit when several of these constraints apply at once.
Each differentiator below points to implementation or to the reproducible local
proof. The boundary column narrows the claim to what that evidence establishes.

<!-- positioning-proof:start -->

| Differentiator                    | Evidence                                                                                                                                                                                                                                                                 | Boundary                                                                                                                                                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bounded semantic observations     | [Reproducible local proof](../scripts/demo-positioning-proof.mjs#L88-L121) and [reference bounding and invalidation](../src/tools/references.ts#L261-L284)                                                                                                               | The caller chooses a limit of 1-60 exposed controls. Omitted counts preserve evidence that the view was compressed. A ref remains valid only for the exact exposed element and current page state; this is not a full DOM or unrestricted evaluation interface. |
| Warm cross-process sessions       | [Cross-process daemon proof](../scripts/demo-positioning-proof.mjs#L123-L163) and [daemon reuse contract](../src/cli.ts#L595-L661)                                                                                                                                       | “Warm” means later CLI processes reuse the same live named daemon, page, and in-memory refs. It is a lifecycle statement, not a browser-startup or command-latency claim.                                                                                       |
| Parallel managed isolation        | [Concurrent path proof](../scripts/demo-positioning-proof.mjs#L47-L86), [browser-storage proof](../scripts/demo-positioning-proof.mjs#L239-L252), and [per-session directory derivation](../src/session/scope.ts#L33-L67)                                                | Different names receive different managed profile, download, and artifact paths by default. This does not claim operating-system, network, or container isolation.                                                                                              |
| Profile lifecycle and scope       | [Persistence proof](../scripts/demo-positioning-proof.mjs#L204-L237), [disposal and destruction proof](../scripts/demo-positioning-proof.mjs#L254-L366), [inspectable scope type](../src/session/scope.ts#L8-L67), and [destroy implementation](../src/cli.ts#L702-L752) | Persistent mode retains managed browser storage after close; disposable mode removes managed state on close. `destroy` removes only known session paths. This does not preserve arbitrary server-side application state.                                        |
| Explicit existing-Chrome reuse    | [Attachment authorization gate](../src/cli.ts#L579-L629), [CDP connection implementation](../src/cli/runtime.ts#L97-L109), and [local CDP regression test](../test/cli/cli.test.ts#L599-L690)                                                                            | Existing-profile access is opt-in through `--attach-existing`. The loopback proof deliberately does not attach to a user profile or claim isolation for that external profile.                                                                                  |
| Chromium and Camoufox portability | [Managed launch implementations](../src/cli/runtime.ts#L83-L135) and [warm container APIs](../src/index.ts#L38-L53)                                                                                                                                                      | Chromium is the default. Camoufox is an optional third-party browser for authorized compatibility testing; support does not promise identical rendering, anonymity, or bypass of site controls.                                                                 |
| Inspectable action evidence       | [Success and failure action recording](../src/create-tools.ts#L87-L176) and [action-count proof across commands](../scripts/demo-positioning-proof.mjs#L146-L163)                                                                                                        | Embedding hosts receive structured action records and an optional `onAction` callback. The current standalone status response exposes the count, not the complete records. Playwright trace and video export are not claimed here.                              |
| Safety and provenance boundary    | [Read-only and disposal proof](../scripts/demo-positioning-proof.mjs#L254-L347), [static policy enforcement](../src/tools/safety.ts#L16-L216), and [content-boundary classification](../src/tools/safety.ts#L38-L173)                                                    | The harness denies statically classified interactions before Playwright dispatch and labels browser-derived content untrusted. It does not understand business consequences, prevent prompt injection, or sandbox page loading.                                 |
| Framework-neutral embedding       | [Public TypeScript exports](../src/index.ts#L16-L65) and [tool factory contract](../src/create-tools.ts#L25-L190)                                                                                                                                                        | The package supplies browser tools, session primitives, and evidence hooks. The host still owns the model loop, prompts, approval UI, reporting, uploads, and task policy.                                                                                      |

<!-- positioning-proof:end -->

The strongest reason to choose this package is the combination, not any single
row: a host can keep browser state across agent turns while constraining the
model-facing surface, separating managed profiles, inspecting ownership and
expiry, and selecting explicit cleanup behavior. A direct Playwright program
can implement the same policies, but then your application owns their design,
enforcement, and regression coverage.

## Choose Playwright directly when

Use Playwright directly when browser automation is application code rather than
a constrained capability exposed to an agent. It is usually the shorter and
more flexible path in these cases:

- You need the complete `Page`, `BrowserContext`, or locator API, including
  `page.evaluate`, raw CDP sessions, custom routing, or a feature the bounded
  harness intentionally omits.
- You are writing a test suite around Playwright Test and want its fixtures,
  projects, retries, reporters, assertions, trace viewer, and test-runner
  lifecycle as the primary abstraction.
- You require first-party Firefox or WebKit coverage. Blop Browser's managed
  CLI supports Chromium and optional Firefox-based Camoufox, not the full
  Playwright engine matrix.
- You have a deterministic, one-off script with a known workflow and no need
  for cross-process session reuse, model-facing schemas, content provenance, or
  managed profile lifecycle.
- Your trusted program must execute arbitrary page JavaScript or CDP commands.
  Adding escape hatches to the agent tool surface would remove the boundary
  that this package is intended to provide.
- You want Playwright's native trace and video artifacts directly and do not
  need the harness action record or semantic-reference contract.

Blop Browser itself uses Playwright. The choice is therefore between consuming
Playwright's general-purpose API directly and adopting this package's narrower
agent-facing contract, not between competing browser engines.

## Choose another agent interface when

Other agent browser projects have real advantages. Use the
[evidence-backed browser tool comparison](browser-tool-comparison.md) for the
source-pinned capability matrix and reviewed versions instead of treating this
guide as a product ranking.

- Choose Playwright CLI when you want an agent-oriented command surface plus
  Playwright code execution, trace/video workflows, and its documented browser
  engine choices.
- Choose Playwright MCP when your host already speaks MCP and its server,
  extension, profile, permission, and evaluation model matches your deployment.
- Choose agent-browser when its broader CLI, dashboard, provider integrations,
  plugins, policies, profiling, or evaluation commands matter more than a small
  model-facing surface.
- Choose Browser Use and Browser Harness when you want a Python agent library,
  editable Python helpers, direct CDP/JavaScript control, or its managed cloud
  browser workflow.

These are interface and lifecycle tradeoffs. Benchmark representative tasks in
your own environment before drawing conclusions about completion rate, latency,
or token use.
