#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import {
  createBrowserControlSession,
  createBrowserTools,
  createTraceRecorder,
} from "../dist/index.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageEntry = join(repositoryRoot, "dist", "index.js");
const maximumReportBytes = 16 * 1024;

main().catch((error) => {
  const name = error instanceof Error ? error.name : typeof error;
  writeReport({
    ok: false,
    proof: "human-takeover-ownership",
    network: "loopback-only",
    evidence: "automated-ownership-contract",
    error: `Proof failed (${safeName(name)}).`,
  });
  process.exitCode = 1;
});

async function main() {
  if (process.argv.length > 2) {
    throw new Error(
      "This proof takes no arguments and only uses its bundled loopback fixture.",
    );
  }
  await access(packageEntry).catch(() => {
    throw new Error("dist/index.js is missing. Run `bun run build` first.");
  });

  const artifactDirectory = await mkdtemp(
    join(tmpdir(), "blop-takeover-proof-"),
  );
  let browser;
  let fixture;
  try {
    fixture = await startLoopbackFixture();
    browser = await chromium.launch({ headless: true, timeout: 10_000 });
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    page.setDefaultNavigationTimeout(5_000);
    await page.goto(fixture.origin, {
      waitUntil: "domcontentloaded",
      timeout: 5_000,
    });

    const control = createBrowserControlSession();
    const traceRecorder = createTraceRecorder({
      identity: { sessionId: "takeover-proof", agentId: "automated-proof" },
    });
    const actions = [];
    const tools = await createBrowserTools({
      page,
      pages: [page],
      testId: "takeover-proof",
      screenshotDir: artifactDirectory,
      actions,
      screenshots: [],
      finishState: { status: null, reason: null },
      control,
      traceRecorder,
    });

    const initialSnapshot = await execute(tools, "browser_snapshot", {});
    const parsedInitialSnapshot = JSON.parse(initialSnapshot.content);
    const staleRef = parsedInitialSnapshot.actionTargets?.find(
      (target) =>
        target.role === "button" && target.name === "Complete challenge",
    )?.target?.ref;
    requireInvariant(
      staleRef,
      "Initial snapshot did not expose the challenge control.",
    );

    const admitted = execute(tools, "browser_expect_text", {
      text: "Ready for handoff",
      timeoutMs: 2_000,
    });
    await waitUntil(
      () => control.status().activeAutomation === 1,
      1_000,
      "The admitted browser command did not start.",
    );

    const releaseAdmitted = delay(150).then(() =>
      page.locator("#ready").evaluate((element) => {
        element.textContent = "Ready for handoff";
      }),
    );
    const pause = control.requestTakeover({
      reason: "challenge",
      message: "Complete the visible loopback challenge.",
    });
    const stateDuringDrain = control.status();
    const blocked = await captureFailure(
      execute(tools, "browser_snapshot", {}),
      "A concurrent harness command unexpectedly crossed the ownership gate.",
    );
    await releaseAdmitted;
    await admitted;
    const paused = await pause;

    const lease = control.takeControl({ requestId: paused.requestId });
    const secret = randomUUID();
    await page.getByLabel("Password").fill(secret);
    await page.getByRole("button", { name: "Complete challenge" }).click();
    await page.getByText("Human step complete").waitFor({ timeout: 2_000 });
    const invalidLease = await captureFailure(
      Promise.resolve().then(() =>
        control.resumeAutomation({
          requestId: lease.requestId,
          leaseId: randomUUID(),
          outcome: "completed",
        }),
      ),
      "Automation resumed with a mismatched ownership lease.",
    );
    const stateAfterInvalidLease = control.status().state;
    control.resumeAutomation({
      requestId: lease.requestId,
      leaseId: lease.leaseId,
      outcome: "completed",
    });

    const staleAttempt = await captureFailure(
      execute(tools, "browser_click", { target: { ref: staleRef } }),
      "A semantic reference from before takeover was unexpectedly accepted.",
    );
    const finalSnapshot = await execute(tools, "browser_snapshot", {
      includeAria: true,
    });
    const trace = traceRecorder.snapshot();
    const lifecycle = [
      "browser_control_pause_requested",
      "browser_control_paused",
      "browser_control_human_acquired",
      "browser_control_automation_resumed",
    ];
    const sequences = lifecycle.map(
      (command) =>
        trace.events.find((event) => event.command === command)?.sequence,
    );
    const sensitiveEvidence = JSON.stringify({
      actions,
      finalSnapshot,
      trace,
    });
    const blockedEvent = trace.events.find(
      (event) =>
        event.command === "browser_snapshot" &&
        event.status === "failed" &&
        event.error?.includes("paused"),
    );

    const checks = {
      initialSnapshotProducedRef: Boolean(staleRef),
      admittedCommandDrained:
        stateDuringDrain.state === "pausing" &&
        stateDuringDrain.activeAutomation === 1 &&
        paused.state === "paused" &&
        paused.activeAutomation === 0,
      concurrentCommandRejected:
        blocked?.code === "automation_paused" &&
        blocked?.command === "browser_snapshot" &&
        Boolean(blockedEvent),
      explicitLeaseRequired:
        invalidLease?.code === "invalid_control_transition" &&
        stateAfterInvalidLease === "human-control" &&
        lease.requestId === paused.requestId &&
        control.status().state === "automation",
      humanStepObserved: finalSnapshot.content.includes("Human step complete"),
      staleReferenceRejected:
        staleAttempt?.message?.includes(
          "Unknown or stale element reference",
        ) === true,
      orderedLifecycleTrace:
        sequences.every(Number.isInteger) && strictlyIncreasing(sequences),
      blockedCommandTraced: Boolean(blockedEvent),
      sensitiveInputRedacted: !sensitiveEvidence.includes(secret),
      leaseExcludedFromTrace: !JSON.stringify(trace).includes(lease.leaseId),
      traceBounded: trace.events.length <= 100,
    };
    for (const [name, passed] of Object.entries(checks)) {
      requireInvariant(passed, `Takeover proof invariant failed: ${name}.`);
    }

    writeReport({
      ok: true,
      proof: "human-takeover-ownership",
      network: "loopback-only",
      evidence: "automated-ownership-contract",
      notEvidenceFor: [
        "human identity",
        "proof a person acted",
        "host UI or notification",
        "browser-wide pause",
      ],
      checks,
      trace: {
        events: trace.events.length,
        lifecycle,
      },
    });
  } finally {
    await browser?.close().catch(() => undefined);
    await fixture?.close();
    await rm(artifactDirectory, { recursive: true, force: true });
  }
}

function execute(tools, name, input) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Built package is missing ${name}.`);
  return tool.execute(input);
}

async function captureFailure(promise, message) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error(message);
}

async function waitUntil(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await delay(10);
  }
  requireInvariant(predicate(), message);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function strictlyIncreasing(values) {
  return values.every(
    (value, index) => index === 0 || Number(value) > Number(values[index - 1]),
  );
}

function requireInvariant(value, message) {
  if (!value) throw new Error(message);
}

function writeReport(report) {
  const json = JSON.stringify(report, null, 2);
  if (Buffer.byteLength(json, "utf8") > maximumReportBytes) {
    process.stdout.write(
      '{"ok":false,"proof":"human-takeover-ownership","error":"Proof report exceeded its byte limit."}\n',
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${json}\n`);
}

function safeName(value) {
  return (
    String(value)
      .replace(/[^A-Za-z0-9_.-]/g, "")
      .slice(0, 80) || "unknown"
  );
}

async function startLoopbackFixture() {
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(`<!doctype html>
      <html><body>
        <main>
          <h1>Loopback verification challenge</h1>
          <p id="ready">Waiting for admitted command</p>
          <label>Password <input type="password" autocomplete="current-password"></label>
          <button type="button" onclick="document.querySelector('#outcome').textContent = 'Human step complete'">Complete challenge</button>
          <p id="outcome">Human step pending</p>
        </main>
      </body></html>`);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Loopback fixture did not expose a TCP port.");
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
