# Blop Browser public launch checklist

This checklist separates source-controlled launch work from GitHub and npm
settings that require a maintainer. Complete it immediately before the public
announcement. The repository rename was completed on 2026-08-13; recheck its
redirects and package links before launch.

## Repository identity

The source and repository present the product as Blop Browser while preserving
its published compatibility names. A maintainer must finish the remaining
remote settings.

- [x] Rename `blop-oss/browser-harness` to `blop-oss/blop-browser` in GitHub.
- [x] Confirm GitHub redirects the previous clone, issue, workflow badge, and
      documentation URLs.
- [x] Keep the npm package name `@blopai/browser-harness` and CLI command
      `blop-browser` unchanged.
- [x] Update `package.json`, badges, install instructions, and source links to
      the redirect-free canonical repository URL.
- [x] Set the GitHub description to “Browser infrastructure for coding agents.”
- [ ] Add the chosen homepage or documentation URL to the repository details.

## Discoverability

GitHub topics are repository settings and can't be prepared reliably through a
source commit. Add this exact set unless GitHub's topic limit changes:

```text
ai-agents
browser-automation
coding-agents
playwright
browser-cli
claude-code
codex
opencode
typescript
agent-tools
web-automation
camoufox
cdp
llm-tools
```

Complete the remaining discovery settings:

- [ ] Add all recommended topics.
- [ ] Complete the `blop-oss` organization profile, including a private contact
      for conduct and security reports.
- [ ] Pin Blop Browser on the organization profile.
- [ ] Upload the reviewed social-preview image from the demo asset workflow.
- [ ] Confirm the repository appears correctly in logged-out GitHub search and
      organization views.

## Community and trust

The repository includes issue forms, a pull-request template, contribution
guidance, a code of conduct, and a security policy. Their GitHub-dependent paths
still require maintainer setup.

- [ ] Enable GitHub Discussions, then verify the support link in the issue
      chooser and add initial **Help** and **Show and tell** categories.
- [ ] Enable private vulnerability reporting so the `SECURITY.md` advisory link
      accepts reports.
- [ ] Verify bug and feature issue forms render and apply labels that exist.
- [ ] Review the candidate backlog in
      [`good-first-issues.md`](good-first-issues.md), create approved issues, and add
      the `good first issue` label. Don't bulk-create unreviewed issues.
- [ ] Confirm branch protection requires the CI workflow before merge.

## Demo and documentation

The README links to a recording workflow but intentionally embeds no demo until
one has been recorded and reviewed.

- [ ] Record the demo with [`demo-recording.md`](demo-recording.md).
- [ ] Review every frame for credentials, personal data, private URLs, and
      misleading edits.
- [ ] Commit `docs/assets/demo/blop-browser-demo.mp4` and
      `docs/assets/demo/blop-browser-demo-poster.webp`.
- [ ] Add the poster and video link near the README demo heading only after the
      files exist.
- [ ] Use the reviewed poster as the GitHub social preview.

## Release and announcement

Run the same checks as CI against the release commit and verify the installed
package outside the checkout before announcing it.

- [ ] Run the complete verification sequence in `CONTRIBUTING.md`.
- [ ] Install the packed tarball in a temporary directory and run the README
      quickstart with a local fixture.
- [ ] Confirm the npm page shows the Blop Browser description, README, license,
      Node.js requirement, repository link, and executable.
- [ ] Confirm the CI, npm version, npm downloads, Node.js, and license badges
      render for a logged-out visitor.
- [ ] Publish release notes that mention the new product name and explicitly
      state that the npm package and CLI compatibility names didn't change.
- [ ] Enable or verify npm provenance and trusted publishing after any GitHub
      repository rename because the trusted-publisher repository setting may need
      updating.

## Final logged-out review

Use a private browser window for the final conversion check so maintainer-only
permissions don't hide missing public settings.

- [ ] Understand the product, intended user, differentiators, and install path
      without scrolling past the first README screen.
- [ ] Open every README and community-file link.
- [ ] Follow the bug-report and feature-request flows without submitting them.
- [ ] Verify the old repository URL redirects after the rename.
- [ ] Verify the install, `doctor`, `open`, and `snapshot` commands from the npm
      package rather than the source checkout.
