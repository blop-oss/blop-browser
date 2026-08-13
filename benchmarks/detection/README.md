# Local backend signal protocol

This protocol records reproducible, bounded evidence about signals visible to a
controlled page in fresh Playwright Chromium and Camoufox sessions. It runs
three repetitions per backend against an internal loopback fixture. It does not
produce a detection score, test a third-party site, or show that either backend
can avoid a site's controls.

<!-- prettier-ignore -->
> [!IMPORTANT]
> Use this protocol only as local compatibility evidence. It doesn't grant
> permission to automate a website, guarantee anonymity or non-detectability,
> or support bypassing a CAPTCHA, rate limit, access denial, or other control.
> Follow the [acceptable-use policy](../../ACCEPTABLE_USE.md).

## What the protocol measures

The local fixture reads a small, reviewable set of browser-observable values.
These values help identify configuration drift and explain differences between
fresh sessions; they don't reproduce a site's private risk model.

The fixture records these signal groups:

- Automation exposure: `navigator.webdriver` and whether the user agent
  contains `Headless`.
- Browser identity: bounded user agent, inferred Chromium or Firefox family,
  platform, locale, and time zone.
- Runtime shape: hardware concurrency, device memory when exposed, plugin and
  MIME type counts, screen dimensions, window dimensions, and device pixel
  ratio.
- Graphics availability: standard WebGL availability, vendor, and renderer
  strings. The fixture doesn't request a debug renderer extension.

The fixture doesn't calculate canvas, audio, or font hashes. It doesn't inspect
an IP address, TLS handshake, cookies, account history, browsing history, or
installed extensions. It makes no network request beyond its own
`127.0.0.1` server.

## Backend assumptions

Each backend serves a different testing workflow. A signal difference is
evidence about that run, not proof that a site will allow or deny it.

| Backend                       | Appropriate workflow                                                              | Threat and reproducibility assumptions                                                                                                                                                                                                                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Playwright Chromium, headless | Deterministic tests for local fixtures, staging, CI, and applications you control | The protocol pins the Playwright package, bundled binary, viewport, locale, time zone, color scheme, motion setting, and fresh profile. Pages can still observe automation and headless-related signals.                                                                                                                       |
| Existing Chrome over CDP      | Authorized workflows that specifically require a dedicated Chrome profile's state | This protocol doesn't attach over CDP. Chrome version, extensions, profile history, cookies, tabs, and login state make an existing profile an uncontrolled comparison input. CDP access grants broad profile control but doesn't grant site permission.                                                                       |
| Camoufox, headless            | Authorized Firefox and fingerprint-compatibility testing                          | The lockfile pins `camoufox-js`; the already-installed Camoufox binary and its actual version are recorded environment inputs. The protocol pins the Linux fingerprint constraint, locale, window, cache, cursor setting, and fresh profile. This launch API exposes no seed, so generated values can differ between attempts. |

Managed Chromium remains the default. Don't switch backends after a site denies
access in an attempt to defeat the denial.

## Pinned protocol

[`protocol.json`](protocol.json) is the source of truth. Its SHA-256 is stored in
every result so you can identify the exact configuration used by a run.

Version `1.0.0` fixes these conditions:

- Three sequential attempts per selected backend.
- A new temporary profile and downloads directory for every attempt.
- The Playwright-bundled Chromium executable and an already-installed Camoufox
  executable. The runner never downloads a browser. It records the actual
  Camoufox binary version rather than claiming the binary itself is lockfile
  pinned.
- Headless mode, a `1280 × 720` viewport or window constraint, `en-US`, and the
  backend-specific settings recorded in `protocol.json`.
- One internally created server bound to `127.0.0.1` with the fixed
  `/signals` path.
- The bounded signal contract listed in `protocol.json`.

Camoufox's `window` option fixes the outer window constraint, not every
generated screen value. The result records observed per-attempt variation
instead of treating the configured constraint as the observed value.

## Run the protocol

You need Node.js 22 or newer, the locked repository dependencies, Playwright's
bundled Chromium, and an existing Camoufox installation. Installing Camoufox is
a separate, explicit action because it downloads a third-party browser.

Run the complete protocol from the repository root:

```bash
bun install --frozen-lockfile
node benchmarks/detection/run.mjs
```

The default command selects both backends and writes a unique JSON file under
`benchmarks/detection/.results/`. Git ignores that directory. To choose an
explicit ignored path, run:

```bash
node benchmarks/detection/run.mjs \
  --output benchmarks/detection/.results/local-signals.json
```

Use a single-backend run only to diagnose an environment problem:

```bash
node benchmarks/detection/run.mjs --backend chromium-headless
node benchmarks/detection/run.mjs --backend camoufox-headless
```

The runner has no URL, proxy, account, or fingerprint override. It rejects
unknown options, constructs the fixture URL internally, binds the server to
`127.0.0.1`, and validates the URL before every navigation.

Treat every raw report as potentially identifying environment data. The user
agent, hardware concurrency, screen dimensions, time zone, and WebGL strings
can help correlate a machine or generated fingerprint when combined. Keep raw
reports private and ignored unless a maintainer reviews the complete file for a
specific disclosure.

## Read a result

[`result.schema.json`](result.schema.json) defines the raw report. The runtime
also validates the attempt count, authorization scope, signal contract,
failures, summary totals, and limitations before writing the file.

The runtime rejects reports larger than 256 KiB. The schema and runtime bound
attempts, failure arrays and reasons, limitations, configuration objects,
signal objects, strings, and variation paths.

Review these fields together:

- `source` records the repository commit, dirty-tree state, protocol hash,
  package version, Playwright version, and Camoufox package version.
- `environment` records Node.js, operating system, and architecture while
  redacting the hostname.
- `attempts` retains every repetition, actual browser version, launch
  configuration, duration, outcome, failure class, reason, and collected
  signals.
- `summary.backends[].failures` repeats all failures in a compact reviewable
  form. Don't remove failures when sharing a summary.
- `summary.backends[].varying_signal_paths` reports which bounded fields varied
  across collected repetitions. It is not a quality score.
- `limitations` travels with every raw report and states what the fixture
  cannot establish.

`collected` means only that the local fixture returned valid bounded evidence
and the temporary browser session closed successfully. It does not mean the
backend passed bot detection. `failed` uses `environment` for a missing or
incompatible installed browser and `harness` for launch, fixture, collection,
validation, or teardown errors.

## Publish evidence responsibly

Generated raw reports stay outside Git by default. Before sharing a result,
inspect every attempt, retain every failure, and publish the protocol hash,
actual versions, selected backends, repetitions, environment, observed
variation, and all limitations. Never publish only the most favorable attempt.

Any result statement must stay narrow. For example, “all three local fixture
attempts returned valid evidence with these versions and settings” is supported
when the raw report says so. “This backend is undetectable” is never supported
by this protocol.

## Third-party detection suites

The shipped runner cannot open a public detection suite. A public page being
reachable is not permission to run automated detection testing against it.

Create a separate, reviewed protocol only when the target's current published
terms expressly authorize this exact automated testing. Before any run, record
the terms URL and revision date, target paths, request rate, test window,
account scope, data-retention rules, and project maintainer approval. Then run
at least three repetitions for every backend and configuration, retain raw
failures, and stop on a CAPTCHA, rate limit, access denial, or changed terms.

Don't add a general live-URL escape hatch to this runner. Don't rotate
fingerprints, accounts, addresses, or network routes to continue after a site
withholds access.

## Change the protocol

Protocol changes require focused tests and a version update. Keep old evidence
interpretable rather than silently changing a field under the same hash.

When you change the protocol:

1. Update `protocol.json` and increment `protocol_version` when evidence
   meaning, launch configuration, signals, or validation changes.
2. Update `result.schema.json`, `core.mjs`, this guide, and
   `test/benchmarks/detection.test.ts` together.
3. Run the focused tests and a complete three-repetition run against both
   installed backends.
4. Compare every attempt and report failures and newly varying fields.
5. Keep generated raw reports under `.results/` or another ignored directory.
