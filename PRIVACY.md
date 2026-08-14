# Privacy and data flows

Blop Browser controls a browser; it does not make browser activity private. A
page can receive normal browser requests, cookies, form data, and uploaded
files. Page observations and evidence return to the process or agent host that
called the harness. Review that host's model, logging, and retention settings
separately.

First-party harness telemetry is off. The package has no telemetry collection
backend or Blop-operated session API, and `off` is the only accepted telemetry
setting. This statement does not include traffic to websites, an attached CDP
browser, installation services, an explicitly enabled container diagnostic,
benchmark services, or a host's model provider.

The standalone CLI reports a `privacy` object when it starts a daemon and in
`status --json` and `doctor --json`. Human startup output prints the same mode,
recording, profile, and retention summary to stderr. Paths and even a sanitized
remote host can be sensitive; do not publish the output without review.

## Local managed sessions

A managed Chromium or Camoufox session has these flows:

| Data                                                                                       | Destination                                                                                               | Retention                                                                                                                 |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Navigation URLs, request headers, cookies, form submissions, and files selected for upload | The selected site and any subresources, redirects, service workers, fetches, or WebSockets it loads       | Defined by the site and the managed browser profile                                                                       |
| Raw caller commands, typed text, and upload paths                                          | CLI to authenticated loopback daemon, then the in-memory `HarnessAction` and any host `onAction` callback | In harness memory for the session; a callback host can retain or transmit its copy                                        |
| Semantic text, URLs, browser logs, action results, and requested screenshots               | Browser to the loopback-only CLI daemon, then stdout or the calling host                                  | In memory unless recorded or retained by the caller                                                                       |
| Cookies, cache, local storage, and other browser state                                     | The named managed profile directory                                                                       | Until `destroy` in persistent mode; until close or idle shutdown in disposable mode                                       |
| Downloads                                                                                  | The named downloads directory                                                                             | Same managed-session lifecycle                                                                                            |
| Bounded action trace and aggregate session metrics                                         | The named artifact directory                                                                              | Same managed-session lifecycle                                                                                            |
| Daemon endpoint metadata and log                                                           | The local runtime directory                                                                               | Endpoint metadata is removed at shutdown; persistent logs remain until `destroy`; disposable logs are removed at shutdown |

The daemon binds a random TCP port on `127.0.0.1`. Its endpoint file contains a
random authentication token and is written with owner-only permissions where
the platform supports them. Browser traffic is not restricted to loopback:
opening a URL lets that page contact its own network destinations.

The CLI always records the bounded action trace and content-free aggregate
metrics. Screenshots are written only when requested, step screenshots are off,
and the CLI screencast is off. An embedding host can configure different
recording callbacks; see [Host and model-provider flows](#host-and-model-provider-flows).
The in-memory `HarnessAction.input` reaches `onAction` before the separate trace
recorder redacts its persisted copy. Do not treat trace redaction as redaction of
IPC, in-memory action state, or host callbacks.

## Attached and remote browser sessions

`--attach-existing` lets the CLI connect to Chrome over HTTP(S) or WebSocket
CDP. If that endpoint is remote, browser commands, typed input, file uploads,
page observations, URLs, logs, and screenshots cross that transport. Use a
trusted authenticated and encrypted transport; the harness does not add
encryption to a plain HTTP or WebSocket endpoint.

The Chrome profile, cookies, cache, downloads, extensions, and tabs remain in
the attached browser's storage. Blop Browser keeps its own trace, aggregate
metrics, artifacts, and daemon log locally until `destroy`. Closing or
destroying the harness connection does not delete the external browser profile
or remote-side logs.

Public status displays only the endpoint scheme, host, and effective port. The
host can itself be sensitive. The owner-only configuration file retains the
complete endpoint needed to reconnect, including credentials or tokens if the
user placed them in the URL; session deletion does not remove this global
configuration. Prefer a credential mechanism that does not put secrets in a
URL and use a dedicated browser profile.

To start an attached daemon without putting the endpoint in its command-line
arguments, the parent CLI briefly supplies the complete CDP endpoint through
the child process environment. The daemon reads and deletes that environment
variable during startup. The owner-only config and this process environment are
still local secret boundaries: same-user process inspection, administrators,
crash tooling, or a modified launcher may observe them.

Container sessions send Playwright control traffic to a browser server in a
Docker container. A custom Docker network can make that transport reachable by
container name instead of a published loopback port. The shared container stays
running until its explicit stop function removes it. Docker images, layers,
caches, and volumes are outside CLI session deletion.

## Host and model-provider flows

The TypeScript package returns tool results to its caller. A host can forward
semantic snapshots, extracted text, URLs, action results, and `NativeModelImage`
data URLs to a model provider. The harness does not know or control that
provider's transmission, training, logging, regional processing, or retention.

Likewise, an embedding host owns `onAction`, trace, metrics, screenshot, and
screencast-frame callbacks. Screencast frames are JPEG page pixels kept only as
the latest in-memory frame by the harness, but a host callback can transmit or
retain them. Review the host before exposing authenticated or confidential
pages.

Human takeover adds request messages, request and lease IDs, control state,
outcomes, and cached page status to authenticated IPC and CLI or host output.
The host owns the browser-access UI, operator notification, identity checks,
and any storage or transmission of that coordination data. Treat request and
lease IDs as sensitive coordination values even though they are not
authentication credentials.

While a person owns control, their direct clicks, keystrokes, uploads, and
other browser actions occur through the visible managed window or an external
browser/CDP access path. They can reach the page and its network destinations,
but they do not pass through harness tool admission, `HarnessAction`, or
`onAction`. The harness trace records ownership transitions and rejected
automation commands; it does not record the person's keystrokes or direct
browser actions. A host or external browser can record them separately.

Cookies are not included as a public tool result. They still reach websites in
ordinary browser requests and remain accessible to an attached browser
profile. A snapshot does not intentionally export a cookie jar, but visible
page text, URLs, logs, and pixels can contain authentication or personal data.

## Other external contacts

These contacts are separate from first-party harness telemetry:

- Browser navigation contacts the selected site and destinations that the page
  loads. Top-level domain rules do not filter subresources.
- A remote CDP endpoint receives browser-control traffic as described above.
- `blop-browser install camoufox` invokes the pinned `camoufox-js` installer.
  That third-party installer chooses browser, release, and add-on download
  services; review its version and network policy before approving the fetch.
- Creating a missing Docker image can contact the configured image registry.
  The default Playwright container starts a version-pinned package command, and
  the default Camoufox image build installs pinned packages and browser assets.
- Container internet-egress diagnosis is off by default. Passing
  `probeInternetEgress: true` makes one cached HTTPS HEAD request from the
  container to `https://1.1.1.1:443` and reports the fixed destination in
  `internetEgressProbe`. A `null` result means it was not probed.
- Interactive CLI sessions and `blop-browser update` can make one GET request
  to the npm registry latest metadata URL for `@blopai/browser-harness`. The
  request sends no usage telemetry; npm may still observe the client IP and
  User-Agent. The result is cached locally for 24 hours. Disable the check with
  `BLOP_BROWSER_UPDATE_CHECK=off`. Approving an update, or passing `--install`,
  runs `npm install --global @blopai/browser-harness`.
- User-invoked package and browser installation commands contact their package
  registries or browser download services.
- Mind2Web setup can download a dataset from Hugging Face. Live benchmark
  adapters contact the configured model provider and selected sites. Benchmark
  credentials, reports, and screenshots are host-owned data.

No listed contact is a guarantee that a dependency or loaded page makes no
other request. Use operating-system, container, proxy, or network controls when
you need an enforceable destination boundary.

## Recording and retention

Trace redaction removes common secret fields, typed values, file paths, URL
credentials, queries, fragments, and recognized token patterns. It is not data
loss prevention. Arbitrary browser text and pixels can still contain secrets.
Metrics contain counts, timings, and exact payload volumes rather than payload
content, but they can reveal workflow shape and approval frequency.
Takeover traces retain bounded ownership transitions and request IDs, while
redacting the optional request message and omitting the lease. This is not a
record of what the person did in the browser.

Inspect retained CLI data without reading profile contents:

```bash
blop-browser data list --json
```

The inventory validates session names, uses no-follow metadata reads, does not
walk profile directories, and classifies at most 1,024 entries. It may read one
additional directory-entry sentinel to report truncation, caps reported entries
and individual file-size metadata, and lists a deletion command for every
recognized session. It separately classifies the global configuration, browser
caches, Docker resources, and external browser profiles as preserved rather
than crawling arbitrary cache or external directories.

Delete one validated session through either equivalent command:

```bash
blop-browser data delete SESSION
blop-browser --session SESSION destroy
```

Deletion closes an active daemon and removes the fixed managed profile,
downloads, artifacts, endpoint, startup lock, and daemon-log paths for that
session only after daemon shutdown is confirmed. A bounded cleanup timeout
returns an error and preserves the relevant managed data rather than claiming
deletion. It does not delete global configuration, browser or package caches,
Docker resources, an external browser profile, website-side data, or host/model
provider records. Filesystem removal is not verified secure erasure; backups,
snapshots, storage journals, and remote copies can remain.

## Reviewed source-to-sink ledger

This ledger maps each declared source to the code-owned sink and names the
boundary that remains outside the harness. It is a review index, not a complete
runtime network observation.

<!-- privacy-data-flows:start -->

| Flow ID               | Source                                                                                                 | Sink                                                                                              | Direct evidence                                                                                                                                                                                                     | Boundary                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LOCAL_IPC`           | Raw caller commands, typed text, upload paths, and browser results                                     | Authenticated loopback daemon socket and in-memory action callbacks                               | [IPC server and client](src/cli/ipc.ts), [action recording](src/create-tools.ts)                                                                                                                                    | Loopback is local transport, not a sandbox against another process running as the same user; trace redaction happens after the live action input exists.   |
| `TARGET_NETWORK`      | URLs, browser headers, cookies, submissions, and uploads                                               | Selected site and page-loaded destinations                                                        | [Navigation tool](src/tools/navigation.ts), [upload tool](src/tools/forms.ts)                                                                                                                                       | Page subresources and server retention are outside the harness.                                                                                            |
| `CDP_TRANSPORT`       | Browser control, input, uploads, and observations                                                      | Configured Chrome CDP endpoint                                                                    | [CDP runtime](src/cli/runtime.ts), [safe CLI disclosure](src/cli/privacy.ts)                                                                                                                                        | Plain endpoints are not upgraded; external browser storage is preserved.                                                                                   |
| `HOST_OUTPUT`         | Tool content, URLs, logs, and model images                                                             | CLI stdout or embedding host callbacks                                                            | [Tool result factory](src/create-tools.ts), [CLI output](src/cli.ts)                                                                                                                                                | A host decides whether to send or retain output with a provider.                                                                                           |
| `HUMAN_CONTROL`       | Takeover message, request and lease IDs, state, outcome, cached status, and direct human browser input | Authenticated IPC and host/UI output; selected page and its destinations for direct browser input | [control state](src/session/control.ts), [CLI takeover transport](src/cli.ts), [runtime access boundary](src/cli/runtime.ts)                                                                                        | The harness records ownership transitions and blocked automation, not the person's direct keystrokes, clicks, uploads, identity, or notification delivery. |
| `LOCAL_RECORDING`     | Redacted actions and aggregate metrics                                                                 | Named artifact directory                                                                          | [Trace store](src/cli/trace-store.ts), [metrics store](src/cli/metrics-store.ts)                                                                                                                                    | Redaction and content-free aggregates do not make workflow evidence anonymous.                                                                             |
| `SCREENCAST_CALLBACK` | Latest JPEG page frame                                                                                 | Embedding host callback                                                                           | [Screencast API](src/screencast.ts)                                                                                                                                                                                 | The harness keeps one frame; the callback controls later transmission and retention.                                                                       |
| `CONTAINER_TRANSPORT` | Playwright commands and optional diagnostic                                                            | Docker browser service and, only when opted in, `https://1.1.1.1:443`                             | [Playwright container](src/session/playwright-container.ts), [Camoufox container](src/session/camoufox-container.ts), [Bun WebSocket shim](src/session/bun-ws-compat.ts), [probe disclosure](src/session/egress.ts) | Shared containers and Docker resources outlive ordinary browser sessions.                                                                                  |
| `CAMOUFOX_INSTALL`    | Explicit install command                                                                               | Third-party `camoufox-js` fetch process                                                           | [CLI installer](src/cli.ts)                                                                                                                                                                                         | Dependency download destinations and retention can change with its pinned version.                                                                         |
| `PACKAGE_UPDATE`      | Interactive version check or explicit `update` / `--install`                                           | npm registry latest metadata and, after approval, `npm install --global`                          | [update checker](src/cli/update.ts), [CLI prompt and spawn](src/cli.ts), [update script](scripts/update-package.mjs)                                                                                                | This is not first-party telemetry. npm sees IP and User-Agent; the check can be disabled; install uses the public package name only.                       |
| `BENCHMARK_SERVICES`  | Dataset request, task traffic, and host model request                                                  | Hugging Face, selected sites, and configured provider                                             | [dataset downloader](benchmarks/mind2web/src/mind2web_bench/download.py), [host adapter boundary](benchmarks/mind2web/core.ts)                                                                                      | Live benchmarks are separate, stochastic workflows with their own credentials and reports.                                                                 |
| `SESSION_RETENTION`   | Profile, downloads, artifacts, endpoint, and log metadata                                              | Named runtime paths                                                                               | [scope builder](src/session/scope.ts), [bounded inventory](src/cli/data-store.ts), [destroy lifecycle](src/cli.ts)                                                                                                  | Listing is metadata-only; deletion is not secure erasure or deletion of external copies.                                                                   |

<!-- privacy-data-flows:end -->

The deterministic privacy checker validates required declarations, onboarding
links, and reviewed source-to-sink signatures. It is drift detection: it does
not capture packets or prove deletion, report delivery, dependency behavior, or
the absence of every possible network request.

For authorization rules, read [Acceptable use](ACCEPTABLE_USE.md). For product
vulnerabilities, use the private process in [Security](SECURITY.md).
