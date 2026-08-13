# Security policy

Blop Browser controls real browsers and can attach to authenticated Chrome
profiles. Treat its CDP endpoints, runtime files, screenshots, logs, and browser
state as sensitive. This policy explains which versions receive fixes and how
to report a vulnerability privately.

## Supported versions

Security fixes target the latest published minor release. The project is still
in the `0.x` series, so users must upgrade to the newest release before
reporting a problem that only affects an older version.

| Version                | Supported   |
| ---------------------- | ----------- |
| Latest `0.1.x` release | Yes         |
| Older releases         | No          |
| Unreleased `master`    | Best effort |

## Report a vulnerability

Use GitHub's
[private vulnerability report](https://github.com/blop-oss/blop-browser/security/advisories/new).
Don't open a public issue for a suspected vulnerability.

Include enough information to reproduce and assess the problem:

- The Blop Browser version or commit.
- The operating system, Node.js version, browser, and connection mode.
- The affected tool, CLI command, TypeScript API, or container path.
- Reproduction steps using non-sensitive test data.
- The expected and actual security boundary.
- The realistic impact and any known mitigations.

Remove cookies, tokens, passwords, CDP WebSocket secrets, private URLs,
screenshots, and profile data. If private vulnerability reporting isn't enabled,
use [GitHub's private support form](https://support.github.com/contact) instead
of disclosing the report publicly.

For suspected malicious or unauthorized use that isn't a product
vulnerability, follow the abuse-reporting process in
the [acceptable-use policy](ACCEPTABLE_USE.md). Start a vulnerability report
title with `[Security]`; the acceptable-use process uses `[Abuse]` so
maintainers can triage the two categories separately.

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
- Docker browser services isolate browser processes from the caller, but their
  network, mounted volumes, Docker socket access, and host configuration define
  the effective boundary.
- Camoufox is an optional third-party browser download with its own supply-chain
  and behavior risks. Browser fingerprint changes don't guarantee anonymity or
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

The TypeScript embedding API provides two consequence controls:

- `safety.mode: "read-only"` rejects pointer, keyboard, form, upload, and
  page-closing tools before Playwright dispatch. Navigation and observation are
  deliberately still available so read-only research can traverse documents;
  this means the mode is not an HTTP safe-method or network-isolation promise.
- `safety.approvalPolicy` lets a host approve or deny each statically classified
  interaction. `browser_upload_file` is classified as `file-upload`; page text
  cannot reclassify it. Callback input is bounded, secret-bearing values and
  local paths are redacted, and URL queries/fragments are removed. A missing or
  negative decision denies the action. Denials remain visible in the action
  trail.

These mechanisms reduce what an injected instruction can cause, but they
cannot determine whether page text is truthful or whether an approved click is
a purchase, message, account change, or destructive form submission. They also
cannot prevent a site from changing server state during navigation, running
JavaScript, issuing background requests, setting cookies, or initiating a
download without a harness interaction. An approval callback is host policy,
not proof that a human reviewed the decision.

The CLI does not invent an approval workflow on the user's behalf. Hosts that
need enforced approvals must use the embedding API and connect it to their own
trusted UI or policy engine. The CLI can enforce read-only mode when its daemon
starts with `BLOP_BROWSER_READ_ONLY=1`. Named sessions isolate harness state by
name, not by domain; use separate browser contexts or dedicated profiles and
enforce domain/network boundaries outside this package. No browser-tool
contract can make an everyday authenticated profile safe for arbitrary hostile
pages.

## Disclosure process

Maintainers will acknowledge a complete report when they review it, reproduce
the issue where possible, and coordinate a fix and release before public
disclosure. Response times aren't guaranteed while the project is maintained by
a small team. Credit is optional and will follow the reporter's preference.
