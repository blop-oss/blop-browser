# Blop Browser roadmap

This roadmap describes the project's near-term technical direction. It isn't a
release commitment; safety, compatibility, and evidence from real workloads
determine sequencing.

## Current priorities

The current phase focuses on making the existing package dependable and easy to
adopt without changing its public compatibility surface.

- Stabilize the `blop-browser` CLI, named session lifecycle, and JSON contracts.
- Keep semantic snapshots compact, scoped, and sufficient for reliable actions.
- Expand deterministic coverage for Chromium, CDP attachment, Camoufox, and
  warm container sessions.
- Publish reproducible benchmark protocols with failure classification and no
  unsupported performance claims.
- Complete public-launch documentation, community health files, and release
  automation.

## Next areas

After the public surface is stable, the project can improve observability and
deployment ergonomics.

- Expose clearer session discovery and lifecycle diagnostics.
- Package a maintained screencast/dashboard example for human supervision.
- Add benchmark adapters for more agent hosts without moving model policy into
  the harness.
- Record cold-start, warm-session, authenticated-session, and parallel-isolation
  measurements in a shared schema.
- Improve container configuration guidance for local, CI, and shared-network
  deployments.

## Later exploration

Longer-term work needs design review and benchmark evidence before it becomes a
public commitment.

- Versioned tool contracts for independent host integrations.
- Additional browser transports that preserve the bounded-tool safety model.
- Reusable storage-state workflows with explicit credential handling.
- Resource and concurrency controls for multi-agent deployments.

## Non-goals

Blop Browser remains browser infrastructure rather than an agent framework.

- It won't own model selection, prompting, or an autonomous agent loop.
- It won't expose arbitrary shell execution, page scripts, or unrestricted CDP
  as default browser tools.
- It won't hide tool failures or silently repair malformed actions.
- It won't add task-specific selectors or website rules to production tools.
