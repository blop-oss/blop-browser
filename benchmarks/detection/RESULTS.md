# Local backend signal results — 2026-08-14

This bounded summary records one six-attempt local run: three fresh-profile
repetitions for each of the two configured backends. All six attempts collected
valid evidence from the loopback fixture. `collected` describes fixture and
session behavior only; it is not a detection pass or a bypass result.

<!-- prettier-ignore -->
> [!IMPORTANT]
> The raw report is intentionally not committed. User agent, hardware, screen,
> time zone, and WebGL values can help correlate a machine or generated
> fingerprint when combined. Keep raw reports private and ignored.

## Provenance

The run used an exact clean source tree and the checked-in version `1.0.0`
protocol.

| Field                       | Recorded value                                                     |
| --------------------------- | ------------------------------------------------------------------ |
| Generated                   | `2026-08-13T23:13:05.522Z` (`2026-08-14` in Europe/Copenhagen)     |
| Source commit               | `6e9d9378fb9200c786e34f700e94e922ea86ae5c`                         |
| Source tree                 | `7666f35ec0bbe6deff8991262ed868885564cb88`                         |
| Working tree dirty          | `false`                                                            |
| Protocol                    | [`1.0.0`](protocol.json)                                           |
| Protocol SHA-256            | `38d189c1be281ea672e8406a813aac6f7d4f38b4c9dda3936560b8ce6aeeee53` |
| Authorization scope         | Built-in `127.0.0.1/signals` fixture only; no third-party site     |
| Raw report size             | 14,473 bytes; ignored and not committed                            |
| Node.js / OS / architecture | `v22.22.1` / Linux / x64                                           |
| Harness package             | `@blopai/browser-harness` `0.1.7`                                  |
| Playwright package          | `1.61.1`                                                           |
| `camoufox-js` package       | `0.11.1`                                                           |

## Configuration

The exact configuration objects are in [`protocol.json`](protocol.json), whose
hash is recorded above.

- Playwright Chromium used its bundled executable in headless mode with a
  `1280 × 720` viewport, `en-US`, UTC, light color scheme, reduced motion,
  `bypassCSP: false`, and a fresh temporary profile per attempt.
- Camoufox used the already-installed package-cache executable in headless mode
  with the Linux constraint, `en-US`, a `1280 × 720` window constraint,
  `humanize: false`, cache disabled, `bypassCSP: false`, and a fresh temporary
  profile per attempt. Fingerprint generation was the launcher's default
  unseeded behavior.

The lockfile pins `camoufox-js`; it does not pin the separately installed
Camoufox browser binary. The actual browser version is recorded below as an
environment input.

## Outcomes

All requested attempts and failures are represented in this summary.

| Backend                       | Actual browser version | Outcome       | Failures | Varying signal paths                                 |
| ----------------------------- | ---------------------- | ------------- | -------- | ---------------------------------------------------- |
| Playwright Chromium, headless | `149.0.7827.55`        | 3/3 collected | None     | None                                                 |
| Camoufox, headless            | `152.0.4-beta.28`      | 3/3 collected | None     | `hardware_concurrency`, `platform`, `webgl.renderer` |

The Camoufox variation is reported as observed local evidence. It is not a
quality ranking, detection score, or recommendation to switch browsers after a
site withholds access.

## Limitations

These limitations traveled with the raw report and apply to every result:

- The loopback fixture records browser-observable signals; it does not
  reproduce a third-party site's detection logic, network reputation, TLS
  fingerprint, account history, or risk model.
- The pinned `camoufox-js` launch API does not expose a seed. Its generated
  fingerprint can vary even when the recorded constraints and actual versions
  are identical.
- A collected result means the fixture loaded and returned valid bounded
  evidence. It is not a pass against bot detection.
- A local result cannot establish anonymity, non-detectability, or permission
  to automate any site.

See the [protocol guide](README.md) for authorized-use requirements, raw-report
handling, and the rules for interpreting or repeating this run.
