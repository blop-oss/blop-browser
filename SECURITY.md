# Security policy

Blop Browser controls real browsers and can attach to authenticated Chrome
profiles. Treat its CDP endpoints, runtime files, screenshots, logs, and browser
state as sensitive. This policy identifies supported versions, explains how to
report a product vulnerability privately, and assigns responsibility for
security triage. The [privacy and data-flow contract](PRIVACY.md) separately
documents normal browser, host, recording, and retention behavior.

## Supported versions

Security fixes target the latest published release. This table is current for
the `0.1.9` release and must be updated when a new version is published.

| Version             | Security support |
| ------------------- | ---------------- |
| `0.1.9`             | Supported        |
| `0.1.8` and earlier | Not supported    |
| Unreleased `master` | Best effort      |

Upgrade to the latest release before reporting a problem that only affects an
older version. A report about `master` helps development, but `master` is not a
released support channel.

## Choose the correct reporting path

Sensitive vulnerability and abuse reports are private. Support questions and
ordinary bugs are public, so remove credentials, authenticated state, private
URLs, and personal data before submitting them.

| Report type                             | Use this channel                                                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| A vulnerability in Blop Browser         | [Private vulnerability report](https://github.com/blop-oss/blop-browser/security/advisories/new) with a `[Security]` title |
| Suspected malicious or unauthorized use | Follow the private `[Abuse]` process in the [acceptable-use policy](ACCEPTABLE_USE.md)                                     |
| Setup or usage support                  | [Public support question](https://github.com/blop-oss/blop-browser/issues/new?template=support-question.yml)               |
| A non-sensitive product bug             | [Public bug report](https://github.com/blop-oss/blop-browser/issues/new?template=bug-report.yml)                           |
| A community conduct concern             | Follow the private process in the [Code of Conduct](CODE_OF_CONDUCT.md)                                                    |

Do not move vulnerability details into a public support request, bug report,
discussion, pull request, or commit.

## Report a vulnerability privately

GitHub private vulnerability reporting is enabled for the canonical public
repository. Sign in to a GitHub account, open the
[private vulnerability report](https://github.com/blop-oss/blop-browser/security/advisories/new),
select **Start a private vulnerability report**, and start the title with
`[Security]`. The report and its discussion stay in GitHub's private repository
security-advisory workflow until disclosure.

Include enough information to reproduce and assess the problem:

- The Blop Browser version or commit.
- The operating system, Node.js version, browser, and connection mode.
- The affected tool, CLI command, TypeScript API, or container path.
- Reproduction steps using non-sensitive test data.
- The expected and actual security boundary.
- The realistic impact and any known mitigations.

Remove cookies, tokens, passwords, CDP WebSocket secrets, private URLs,
screenshots, and profile data. The project does not publish a separate verified
security email. If GitHub says the private form is unavailable, do not send the
vulnerability through another public project channel. Use
[GitHub Support](https://support.github.com/contact) to report the broken GitHub
form without including vulnerability details, then retry the private report.

## Security triage ownership

Repository administrators jointly own coverage of the private advisory inbox.
The first repository administrator to acknowledge a report becomes the
**security triage maintainer** for that report and records the assignment in the
private advisory discussion. If that maintainer becomes unavailable, another
repository administrator must record an explicit handoff in the same
discussion.

The security triage maintainer owns these tasks:

- Acknowledge receipt and keep the reporter informed.
- Preserve the report's confidentiality and remove unnecessary secrets from
  working material.
- Reproduce the issue where possible and assess affected versions, severity,
  realistic impact, exploit status, and mitigations.
- Coordinate review, remediation, release, advisory publication, and a CVE
  request when appropriate.
- Keep vulnerability triage separate from `[Abuse]`, conduct, support, and
  public issue workflows.

`CODEOWNERS` review rules do not grant access to private security advisories, so
code-review ownership is not a substitute for this triage assignment.

## Response targets

The following are working targets for this small maintainer team, not guaranteed
service-level agreements:

- Acknowledge a complete or incomplete report within **5 business days** of its
  GitHub submission time and identify the security triage maintainer.
- Provide an initial scope and severity assessment within **10 business days**
  of submission. If required evidence is missing, state what is needed and give
  the reporter a provisional status within the same window.
- Post a status update at least every **14 calendar days** while a confirmed
  vulnerability remains open.

Remediation and release dates depend on severity, active exploitation, fix
complexity, affected users, and downstream coordination. Missing a target does
not make public disclosure safe; add a comment to the existing private report
to request an update.

## Security boundaries

Blop Browser reduces accidental agent capability by exposing controlled,
bounded tools. It isn't a complete sandbox or an authorization system.

Keep these boundaries in mind:

- A CDP endpoint grants broad control over the attached browser profile. Bind
  local endpoints to `127.0.0.1`, use dedicated profiles when possible, and
  never expose an unauthenticated endpoint publicly. CDP access isn't evidence
  that the profile owner or website authorized an automation workflow.
- Attaching to an everyday Chrome profile gives the caller access to its active
  authenticated sessions and tabs.
- Browser pages remain untrusted input. Page content can attempt prompt
  injection or trigger downloads and navigation.
- A human-control handoff stops new harness commands, not page scripts,
  networking, browser extensions, page JavaScript, or external CDP clients.
- Docker browser services isolate browser processes from the caller, but their
  network, mounted volumes, Docker socket access, and host configuration define
  the effective boundary.
- Camoufox is an optional third-party browser download with its own supply-chain
  and behavior risks. Browser fingerprint changes do not establish anonymity or
  avoidance of bot protections and must not be used to bypass site controls.
- Screenshots, semantic snapshots, logs, and benchmark reports can contain
  personal or confidential application data.

## Prompt-injection mitigation

Rendered pages, frame content, accessibility names, DOM extraction, browser
logs, URLs, screenshots, and download metadata are attacker-controlled input.
Blop Browser marks direct browser results as `source: "browser"` and
`trust: "untrusted"`. Results that combine a harness confirmation with observed
page state are marked `source: "mixed"` and remain untrusted. Hosts must
preserve this `contentBoundary`; concatenating page output into system or tool
instructions discards the boundary and defeats the mitigation.

The TypeScript embedding API provides three consequence controls. A host fixes
these controls when it creates tools for a browser context; page content and
model output can't rewrite them:

- `safety.mode: "read-only"` rejects pointer, keyboard, form, upload, and
  page-closing tools before Playwright dispatch. Navigation and observation are
  deliberately still available so read-only research can traverse documents;
  this means the mode is not an HTTP safe-method or network-isolation promise.
- `safety.approvalPolicy` lets a host approve or deny each statically classified
  `ask` interaction. `safety.actions` can set `allow`, `deny`, or `ask` for
  `navigation`, `pointer`, `keyboard`, `form`, `file-upload`, and
  `page-lifecycle`. `browser_upload_file` is always `file-upload`; page text
  cannot reclassify it. Callback input is bounded, secret-bearing values and
  local paths are redacted, and URL queries/fragments are removed. A missing,
  thrown, malformed, or negative decision denies the action. Denials remain
  visible in the action trail and action trace.
- `safety.domains` applies exact or wildcard origin rules to top-level HTTP and
  HTTPS documents. A nonempty allow list denies nonmatches, and deny rules win.
  The gate checks requested `browser_goto` destinations, redirect hops, and
  top-level navigation caused by other commands. It rejects every new page or
  popup before the first request while domain rules are active because
  Chromium doesn't expose that page early enough to cover a later redirect.
  The policy is immutable per `BrowserContext`, and nonempty rules fail setup
  on non-Chromium backends.

The `navigation` action class covers only explicit `browser_goto`, reload,
back, and forward commands. A click or keyboard command that navigates keeps
its original class and does not receive a second destination-aware approval;
the independent domain gate still checks its top-level destination. The
`form` class covers check, uncheck, and option selection, not every possible
form submission. The policy does not infer purchases, messages, account
changes, or other intent from page text.

These mechanisms reduce what an injected instruction can cause, but they
cannot determine whether page text is truthful or whether an approved click is
a purchase, message, account change, or destructive form submission. They also
cannot prevent a site from changing server state during navigation, running
JavaScript, issuing background requests, setting cookies, or initiating a
download without a harness interaction. Domain rules do not filter subframes,
images, scripts, fonts, fetches, WebSockets, service workers, or other
subresources, so they are not network isolation. An approval callback is host
policy, not proof that a human reviewed the decision.

The CLI does not invent an approval workflow on the user's behalf. Hosts that
need enforced approvals must use the embedding API and connect it to their own
trusted UI or policy engine. The CLI can enforce read-only mode when its daemon
starts with `BLOP_BROWSER_READ_ONLY=1`. The CLI doesn't currently expose domain
rules, action decisions, or an approval callback. Named sessions isolate
harness state by name, not by domain; use the TypeScript policy where its
top-level scope is sufficient, and enforce full network boundaries outside
this package. No browser-tool contract can make an everyday authenticated
profile safe for arbitrary hostile pages.

## Human-control handoff

The framework-neutral `BrowserControlSession` serializes harness ownership. A
takeover request closes automation admission synchronously, waits for commands
that were already admitted, and then enters `paused`. Acquiring control and
resuming automation require the matching request and lease IDs. New harness
commands rejected in `pausing`, `paused`, or `human-control` are recorded from
cached pre-pause state without querying Playwright.

The lock applies only at the harness command-admission boundary. It does not
pause page scripts, timers, network requests, service workers, extensions, or
downloads. Page JavaScript and clients that use Playwright or CDP outside this
harness can continue to change the browser and can race a person. Request and
lease IDs are concurrency tokens, not credentials, authentication,
authorization, or proof that a person acted. Any caller with access to the CLI
daemon can request, acquire, or resume control.

The CLI reports either a visible managed window or the configured attached
browser as the access path. It rejects takeover in a standalone managed
headless session before pausing. It cannot verify that an attached browser is
visible or reachable by the intended person. An embedding host owns browser
exposure, user notification, identity checks, and every takeover interface; the
package provides no hosted UI or notification service.

Pause and resume invalidate semantic element refs because a person can change
the DOM. Status uses the cached pre-pause URL and title while human control owns
the session. Default and ARIA snapshots mask values from password fields and
credential-like inputs, textareas, and editable regions. This conservative
masking is not data-loss prevention. Explicit extraction, screenshots,
arbitrary rendered text, logs, URLs, and browser or network data can still
contain credentials or personal data.

## Trace privacy and retention

Action traces are security evidence and sensitive application data. They can
contain bounded page-derived output, visited origins, target labels, command
timing, approval decisions, artifact paths, and workflow intent. Their
`contentBoundary` records provenance; it does not make browser-derived content
safe or truthful.

The recorder redacts typed text, common credential fields and patterns, file
paths, URL credentials, queries, fragments, and secret-labelled path segments.
It applies the same bounded redaction to errors, approval reasons, identities,
and media paths. This mitigation cannot recognize every secret in arbitrary
page output or prove that an export contains no personal or confidential data.
Screenshots remain visual browser data. Review and minimize trace exports before
sharing them, and follow the [acceptable-use policy](ACCEPTABLE_USE.md) when
collecting or retaining data.

Standalone CLI traces are capped at 100 retained events and 768 KiB per JSON or
human export by default. The CLI stores the latest complete exports with mode
`0600` in the session's private artifact directory. Persistent sessions retain
them after close, idle shutdown, or a crash until `destroy` removes the managed
artifacts. Disposable sessions remove them on close or idle shutdown. Attached
CDP sessions use a managed artifact directory; destroying that directory does
not delete the external Chrome profile. See the
[action trace documentation](docs/action-traces.md) for the event contract and
exact lifecycle behavior.

## Coordinated disclosure

The security triage maintainer and reporter will coordinate a disclosure date
after affected versions and mitigations are understood. Maintainers will
prepare a fix and supported release before publication when practical. They may
publish sooner when active exploitation or user protection makes prompt notice
necessary, and they will explain that decision in the private report.

The public advisory will describe affected and patched versions, impact,
mitigations, and credit. Credit is optional and follows the reporter's stated
preference. This process does not require an unlimited embargo or promise a
fixed remediation date.

## Verify the private channel

Maintainers must verify the repository setting after ownership changes and
before each release:

```bash
gh api repos/blop-oss/blop-browser/private-vulnerability-reporting --jq .enabled
```

The expected output is `true`. This read-only configuration check confirms that
GitHub has enabled the private reporting entry point. It does not submit a
report, test notification delivery, or prove that a reporter completed the
form. Do not create a fabricated vulnerability report merely to test routing.
