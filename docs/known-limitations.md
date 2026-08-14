# Known limitations

Blop Browser is browser infrastructure, not a complete browser agent. It gives
an agent host controlled Playwright tools, session lifecycle, and browser
evidence, but it includes no model, planner, or autonomous agent loop. Review
these boundaries before choosing a browser mode or handling authenticated data.
Read the [privacy and data-flow contract](../PRIVACY.md) for the explicit local,
remote, recording, and deletion paths.

## Availability and hosting

Blop Browser has no hosted free or paid tier. Its CLI, TypeScript API, browser
state, and artifacts run in infrastructure you operate or in a browser you
explicitly attach. The package requires no Blop account, platform key,
subscription, or payment.

The separate Blop QA product advertised at `blopai.com` is not a hosted tier for
this package. Its plans and policies do not apply to local Blop Browser storage,
limits, retention, or support. Review the dated
[capability availability](capability-availability.md) instead of inferring a
package entitlement from an organization or pricing link.

## Host responsibilities

Your host supplies the behavior outside browser infrastructure. This package
does not provide prompt orchestration, model selection, planning, a human
approval interface, task DSL, result reporting, uploads, or general lifecycle
policy.

The standalone CLI exposes only read-only mode; it does not create an approval
workflow or expose domain and per-action policy. An embedding host can connect
`safety.approvalPolicy` to its own trusted policy engine or user interface.
Returning an approval decision is not proof that a person reviewed it.

## Safety and authorization

Controlled tools reduce the browser capabilities exposed to an agent. They are
not a sandbox, authorization system, prompt-injection solution, malware
scanner, or semantic understanding of consequences.

Read-only mode blocks statically classified pointer, keyboard, form, upload,
and page-closing tools before Playwright dispatch. It still permits navigation
and observation. Loading a page can run JavaScript, make network requests, set
cookies, initiate downloads, and change server state, including through a GET
request.

The embedding API can assign `allow`, `deny`, or `ask` to static navigation,
pointer, keyboard, form, file-upload, and page-lifecycle classes. Page text and
model output cannot change those classes. An `ask` decision fails closed when
the approval callback is missing, throws, or returns anything but an explicit
approval. Policy denials are structured and remain in the action trail and,
when a recorder is configured, the harness trace. The classes describe
dispatched tools, not intent: the harness does not infer whether a click or key
press submits a purchase, message, or account change.

Domain rules cover top-level HTTP and HTTPS documents in Chromium. They check a
requested `browser_goto`, redirect hops, and same-page navigation caused by
other commands. The harness rejects every new page or popup document while
rules are active, before its first request—even when its initial origin is
allowed—because Chromium does not expose the page soon enough to guard a later
redirect. Nonempty rules fail setup on Camoufox, Firefox, WebKit, or a context
whose backend cannot enforce every top-level redirect. The policy is immutable
for one `BrowserContext`.

Domain rules do not filter iframes, images, scripts, fonts, fetches, WebSockets,
service workers, or other subresources, so they are not network isolation. They
also do not replace filesystem, user, authorization, or full network policy.
Read the [security boundaries](../SECURITY.md#security-boundaries) and
[acceptable-use policy](../ACCEPTABLE_USE.md).

## Human-control handoff

Human takeover is a harness admission lock, not a browser-wide pause. A request
rejects later harness commands before Playwright access and waits for commands
already admitted through the same controller. Page scripts, timers, network
requests, service workers, extensions, downloads, and clients using Playwright
or CDP outside the harness can continue and can race the person.

Request and lease IDs coordinate concurrent callers. They are not
authentication, authorization, or proof that a person saw or changed the page.
Any caller with access to the daemon can invoke the takeover transition
commands. The package supplies no notification, user interface, identity
verification, or browser-sharing service. A host must expose the browser to its
operator and decide when to resume.

The standalone CLI supports takeover only for a visible managed window or a
configured attached browser. It fails before pausing a managed headless
session, and it cannot verify that an attached browser is visible or reachable
by the intended person. Page status is cached while automation is paused.
Pause and resume invalidate every semantic ref; take a new snapshot before
acting again. If the person closes every page, the next resumed command fails
with a structured, recorded error until the host supplies a live page.

Snapshot masking covers password fields and credential-like input, textarea,
and editable values. It does not inspect arbitrary meaning or provide
data-loss prevention. Screenshots, explicit extraction, rendered text, logs,
URLs, and other browser data can still expose secrets.

## Session storage and cleanup

Distinct managed session names receive separate profile, download, and
artifact paths. This is browser-storage separation, not operating-system,
process, container, domain, or network isolation.

Persistent mode retains managed state and the daemon log after close and idle
shutdown until you run `destroy`. Disposable mode removes its managed profile,
downloads, artifacts, and daemon log on close or idle shutdown. `data list`
reports bounded no-follow metadata without walking profile directories. It is
not a complete disk inventory. Neither mode reverses server-side state or
deletes data owned by a website. An attached CDP session uses an external
profile, and Blop Browser does not delete that external profile. Global
configuration, browser caches, Docker resources, backups, and host/provider
records also remain outside session deletion.
If daemon shutdown cannot be confirmed within the bounded cleanup timeout,
`close`, `destroy`, or `data delete` reports `cleanup_timeout` and preserves the
relevant managed paths instead of claiming deletion.

## Existing Chrome and Camoufox

Attaching over CDP grants broad control over the selected Chrome profile,
cookies, accounts, and tabs. `--attach-existing` makes the capability choice
explicit, but it does not prove account-owner or website authorization. Use a
dedicated localhost profile when possible.

Camoufox is an optional third-party Firefox-based browser. Optional anti-bot
mode is off by default and launches Camoufox when enabled. It does not provide
anonymity, permission, or guaranteed avoidance of bot protections and site
controls. The managed CLI does not offer Playwright's complete first-party
Chromium, Firefox, and WebKit engine matrix. Use the
[browser selection guidance](positioning-proof.md) when you need broader
Playwright features.

## Backend signal evidence

The loopback-only backend signal protocol records a bounded set of values that
a controlled page can observe in fresh headless Chromium and Camoufox sessions.
It can expose configuration drift and variation in that local run. It does not
reproduce a third-party site's detection logic, account or network reputation,
TLS fingerprint, or risk model, and it produces no detection score or access
recommendation.

The protocol does not cover existing Chrome over CDP. Its installed Camoufox
browser binary is an environment input, and Camoufox fingerprint generation is
unseeded through the launch API used here. Raw reports contain potentially
identifying browser and machine signals and remain ignored by default. Read the
[protocol and backend assumptions](../benchmarks/detection/README.md) alongside
the [dated local result](../benchmarks/detection/RESULTS.md); neither establishes
anonymity, non-detectability, live-site compatibility, or permission.

## Observations and references

The default semantic snapshot is deliberately bounded and can omit controls,
text, or DOM detail. It reports omitted counts, supports scoped observations,
and offers full ARIA output as an explicit fallback, but it is not raw DOM
access. Dynamic or inaccessible applications can still require screenshots,
focused extraction, or direct Playwright code outside the harness.

Opaque references are scoped to the observed page state. Navigation, element
replacement, modal changes, and other invalidation can make them stale. The
harness rejects stale or ambiguous targets instead of guessing a replacement;
the caller must take another snapshot.

## Traces and screenshots

The action trace is bounded harness evidence, not native Playwright tracing,
video, DOM snapshots, network bodies, or replay. By default it retains at most
100 events, limits strings, and caps JSON and human output at 768 KiB. Dropped
events are counted.

Redaction reduces accidental credential retention but cannot identify every
secret in arbitrary page output. Traces, screenshots, semantic text, URLs,
target labels, timings, and workflow intent can remain sensitive. Review the
[trace privacy and retention contract](action-traces.md) before storing or
sharing an artifact.

## Compatibility and performance

The npm package is in the `0.x` series and publishes no long-term compatibility
guarantee for every schema, command, dependency, platform, or browser version.
Use release notes and regression tests when upgrading. The CLI currently
requires Node.js 22 or newer, and browser or Docker availability depends on the
host environment.

Deterministic tests and the loopback positioning proof establish specific
contracts, not live-site task completion. Historical Mind2Web records are
scoped to their recorded task, model, provider, version, and environment. Blop
Browser does not claim universal correctness, reliability, speed, token
efficiency, security, or superiority over another interface. Use the
[benchmark protocol](../benchmarks/README.md) for workload-specific evidence.

## Session metrics and local timing

Session metrics retain bounded aggregates, not raw tool inputs or page output.
They can still reveal workflow shape, command mix, approvals, timings, payload
sizes, and image use. Review them before sharing. Provider token counts remain
`null` because the harness cannot observe provider requests or tokenizer
accounting; exact Unicode code points and UTF-8 bytes are not token estimates.

Command durations surround harness dispatch, including time inside Playwright
calls. Retry counts include only explicit harness-owned checks after the first
attempt; they exclude Playwright-internal polling and retries made by a host,
agent, model provider, or network stack. Active time is the sum of active
recorder segments, not continuous browser uptime. An abrupt exit can lose an
unpersisted idle tail.

The loopback-only session metrics protocol measures three paired cold-start and
warm-resume workflows for one clean build, installed Chromium, machine, and
configuration. Its six raw durations and command deltas do not establish
general startup speed, task completion, live-site behavior, model time, or
performance on another system. Read the
[session metrics contract](session-metrics.md) and
[local protocol](../benchmarks/session-metrics/README.md) together.

## Next steps

Use the [positioning proof](positioning-proof.md) to decide whether these
boundaries fit your host. Use Playwright directly when you need its unrestricted
API, Playwright Test, raw CDP, native traces and video, or first-party Firefox
and WebKit support.
