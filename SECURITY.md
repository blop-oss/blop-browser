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
contact a maintainer through the private channel on the `blop-oss` organization
profile instead of disclosing the report publicly.

## Security boundaries

Blop Browser reduces accidental agent capability by exposing controlled,
bounded tools. It isn't a complete sandbox or an authorization system.

Keep these boundaries in mind:

- A CDP endpoint grants broad control over the attached browser profile. Bind
  local endpoints to `127.0.0.1`, use dedicated profiles when possible, and
  never expose an unauthenticated endpoint publicly.
- Attaching to an everyday Chrome profile gives the caller access to its active
  authenticated sessions and tabs.
- Browser pages remain untrusted input. Page content can attempt prompt
  injection or trigger downloads and navigation.
- Docker browser services isolate browser processes from the caller, but their
  network, mounted volumes, Docker socket access, and host configuration define
  the effective boundary.
- Camoufox is an optional third-party browser download with its own supply-chain
  and behavior risks.
- Screenshots, semantic snapshots, logs, and benchmark reports can contain
  personal or confidential application data.

## Disclosure process

Maintainers will acknowledge a complete report when they review it, reproduce
the issue where possible, and coordinate a fix and release before public
disclosure. Response times aren't guaranteed while the project is maintained by
a small team. Credit is optional and will follow the reporter's preference.
