# Capability availability

Blop Browser is a local open-source package. Blop Browser has no hosted free or
paid tier. The `blop-browser` CLI, TypeScript API, browser storage, traces, and
Docker helpers run in infrastructure that you operate or in an existing browser
that you explicitly attach.

The Blop organization also publishes a separate hosted QA product at
`blopai.com`. That product is not a hosting tier for this package. Its plans,
credits, runners, platform uploads, retention terms, and support do not change
what `@blopai/browser-harness` provides locally.

## Reviewed official sources

This review uses current first-party sources only. The review date records when
the mutable website and repository metadata were checked; local implementation
links in the matrix describe the version that contains this document.

<!-- availability-sources:start -->

| Source                                                                               | Reviewed finding                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Snapshot                                                                                         | Reviewed on     |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------- |
| [GitHub repository metadata](https://api.github.com/repos/blop-oss/blop-browser)     | The repository is public and MIT-licensed, its description is “Browser infrastructure for coding agents,” its homepage is unset, and GitHub Pages is disabled.                                                                                                                                                                                                                                                                                                        | Repository metadata and default branch at review time; implementation at this document's commit. | August 14, 2026 |
| [GitHub organization metadata](https://api.github.com/orgs/blop-oss)                 | The organization links to `https://blopai.com/` and lists one public repository.                                                                                                                                                                                                                                                                                                                                                                                      | Organization metadata at review time.                                                            | August 14, 2026 |
| [Published npm package](https://registry.npmjs.org/@blopai%2Fbrowser-harness/latest) | `@blopai/browser-harness` 0.1.7 is a public MIT package whose homepage and repository point back to this repository.                                                                                                                                                                                                                                                                                                                                                  | npm `latest` registry metadata for version 0.1.7.                                                | August 14, 2026 |
| [Blop Browser documentation](https://docs.blopai.com/harness/)                       | The official harness page assigns browser control to this package and explicitly excludes the agent loop, test DSL, reporters, and platform uploads.                                                                                                                                                                                                                                                                                                                  | Public documentation at review time.                                                             | August 14, 2026 |
| [Separate Blop QA pricing](https://blopai.com/pricing)                               | The organization website advertises a Free band at €0 and “Free forever”; paid Starter, Team, and Scale bands at €199, €599, and €1,499 per month, each with a 14-day trial; and Enterprise with custom pricing for a separate QA product. Its cancellation copy says a workspace moves to the Free band after the paid period and “Nothing is deleted.” It does not identify these as Blop Browser hosting plans or define a numeric test-artifact retention window. | Public pricing page at review time.                                                              | August 14, 2026 |
| [Separate Blop QA privacy page](https://blopai.com/privacy)                          | The page labels itself placeholder copy, says “Last updated: Not yet published,” and gives no numeric test-artifact retention period.                                                                                                                                                                                                                                                                                                                                 | Public privacy page at review time.                                                              | August 14, 2026 |
| [Separate Blop QA terms page](https://blopai.com/terms)                              | The page labels itself placeholder copy, says “Last updated: Not yet published,” and describes subscriptions without creating a Blop Browser hosting entitlement.                                                                                                                                                                                                                                                                                                     | Public terms page at review time.                                                                | August 14, 2026 |

<!-- availability-sources:end -->

## Availability matrix

Read each local cell as the shipped package contract, not as a hosted-service
promise. “Not offered by this project (N/A)” means there is no Blop Browser
account, hosted quota, hosted retention policy, bill, or service tier for that
cell. It does not mean that a hosted feature exists but has an unknown limit.

<!-- availability-matrix:start -->

| Capability             | Local open source                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Hosted free                        | Hosted paid                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------- |
| Runtime and hosting    | The CLI uses a localhost daemon; the API runs in your host process, self-operated Docker, or an explicitly selected CDP browser. See the [local CLI runtime](../src/cli.ts#L648-L734), [Playwright container lifecycle](../src/session/playwright-container.ts#L217-L339), and [Camoufox container lifecycle](../src/session/camoufox-container.ts#L197-L292).                                                                                                                              | Not offered by this project (N/A). | Not offered by this project (N/A). |
| Profile persistence    | Managed sessions use explicit persistent or disposable storage modes. See [scope derivation](../src/session/scope.ts#L33-L67) and [persistent and disposable lifecycle tests](../test/cli/cli.test.ts#L209-L296).                                                                                                                                                                                                                                                                           | Not offered by this project (N/A). | Not offered by this project (N/A). |
| Parallel sessions      | Distinct session names receive distinct managed profile, download, and artifact paths. See the [parallel-session test](../test/cli/cli.test.ts#L170-L207) and [session-path validation](../test/session/scope.test.ts#L10-L46).                                                                                                                                                                                                                                                             | Not offered by this project (N/A). | Not offered by this project (N/A). |
| Chrome and CDP         | Managed Chromium is local. Existing Chrome attachment accepts an explicit endpoint only with `--attach-existing`, and preserves the external profile on destroy. See the [attachment gate](../src/cli.ts#L648-L734) and [external-profile test](../test/cli/cli.test.ts#L1062-L1154).                                                                                                                                                                                                       | Not offered by this project (N/A). | Not offered by this project (N/A). |
| Camoufox               | Optional Camoufox runs as a separately installed local browser or in a self-operated warm container. See the [launch paths](../src/cli/runtime.ts#L82-L210) and [container test](../test/session/camoufox-container.test.ts#L21-L51).                                                                                                                                                                                                                                                       | Not offered by this project (N/A). | Not offered by this project (N/A). |
| Recordings and traces  | The package provides bounded harness action traces, screenshots, and an optional live Chromium JPEG screencast. It does not provide native Playwright trace or video export. See the [trace recorder](../src/trace-recorder.ts#L124-L290), [trace tests](../test/browser/action-trace.test.ts#L18-L194), and [screencast test](../test/browser/screencast.test.ts#L28-L79).                                                                                                                 | Not offered by this project (N/A). | Not offered by this project (N/A). |
| Session metrics        | The CLI and API export bounded aggregate session counters and durations without retaining observed payload content; provider token counts remain unavailable. See the [recorder and validator](../src/session-metrics.ts#L1-L1084) and [browser regression tests](../test/browser/session-metrics.test.ts#L1-L383).                                                                                                                                                                         | Not offered by this project (N/A). | Not offered by this project (N/A). |
| Human takeover         | The API and CLI provide a local ownership handoff for an active headed managed browser or a configured attached browser. Managed headless CLI sessions reject takeover before pausing; embedding hosts own browser access, UI, and notification. This is a harness admission lock, not authentication or proof that a person acted. See the [control state machine](../src/session/control.ts#L127-L332) and [real-browser takeover tests](../test/browser/human-takeover.test.ts#L5-L221). | Not offered by this project (N/A). | Not offered by this project (N/A). |
| Proxy service          | The project provides no proxy service or managed proxy configuration. The managed CLI publishes no proxy option; an embedding host owns browser and network setup outside the tool contract. See the [installed CLI options](../src/cli.ts#L43-L85) and [public embedding surface](../src/index.ts#L3-L124).                                                                                                                                                                                | Not offered by this project (N/A). | Not offered by this project (N/A). |
| Retention and deletion | Persistent managed state remains until `destroy`. Disposable close or idle shutdown removes the managed profile, downloads, and artifact directories, but the per-session daemon log remains in the runtime directory until `destroy`. Attached Chrome storage remains external. See [disposable close cleanup](../src/cli/runtime.ts#L524-L545), [destroy cleanup](../src/cli.ts#L771-L824), and [lifecycle tests](../test/cli/cli.test.ts#L209-L296).                                     | Not offered by this project (N/A). | Not offered by this project (N/A). |
| Limits and quotas      | There is no account quota. Local observations, extraction, traces, IPC, and other outputs have code-level bounds; session capacity depends on your host resources. See [bounded references](../src/tools/references.ts#L261-L284), [bounded extraction](../src/tools/extract.ts#L5-L97), and [bounded trace tests](../test/browser/action-trace.test.ts#L145-L169).                                                                                                                         | Not offered by this project (N/A). | Not offered by this project (N/A). |
| Billing and accounts   | The MIT package requires no Blop account, platform key, subscription, or payment. You remain responsible for costs from your own machines, browsers, containers, networks, websites, and third-party services. See the [package contract](../package.json#L1-L28) and [MIT license](../LICENSE#L1-L21).                                                                                                                                                                                     | Not offered by this project (N/A). | Not offered by this project (N/A). |
| Support                | Public setup and usage questions use GitHub issues; security reports use GitHub's private advisory flow. Maintainer response targets are not service-level agreements. See the [support form](../.github/ISSUE_TEMPLATE/support-question.yml#L1-L57) and [security support boundary](../SECURITY.md#L24-L105).                                                                                                                                                                              | Not offered by this project (N/A). | Not offered by this project (N/A). |

<!-- availability-matrix:end -->

## Complete local workflow

This workflow installs, configures, runs, inspects, closes, and destroys one
local persistent session. It needs no Blop account, hosted API key,
subscription, or payment.

```bash
npm install --global @blopai/browser-harness
blop-browser doctor
npx playwright install chromium
blop-browser config --mode chromium-headless

blop-browser --session local-review open https://example.com
blop-browser --session local-review snapshot
blop-browser --session local-review status --json
blop-browser --session local-review trace --json
blop-browser --session local-review metrics --json
blop-browser --session local-review close
blop-browser --session local-review destroy
```

Use `--profile disposable` on the first browser command when the managed
profile, downloads, and artifact directory (including traces, metrics, and
screenshots) must be removed automatically on close. The per-session daemon log
still requires `destroy`. Use `--attach-existing` only after you choose to grant
access to a specific CDP browser profile.

## Separate hosted product boundary

The official Blop QA pricing page describes a separate product with a Free €0
band labeled “Free forever”; paid Starter, Team, and Scale bands at €199, €599,
and €1,499 per month, each shown with a 14-day trial; and Enterprise with custom
pricing. The browser package does not unlock, depend on, or inherit those plan
features. Conversely, a Blop QA plan does not create a hosted `blop-browser`
session or change this package's local storage contract.

As reviewed on August 14, 2026, the pricing page's cancellation answer says a
workspace moves to the Free band after the paid period and “Nothing is deleted.”
That statement applies to the separate service and does not define a numeric
test-artifact retention window. Its public privacy and terms pages identify
themselves as unpublished placeholder copy. Do not fill that missing
separate-service contract with assumptions or copy it into the N/A hosted
columns above.

## Next steps

Review the [known limitations](known-limitations.md) before handling
authenticated data. Use the [positioning proof](positioning-proof.md) to decide
whether the local harness boundary fits your host.
