#!/usr/bin/env node

import { execFile } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliEntry = join(repositoryRoot, "dist", "cli.js");
const outputLimit = 1_048_576;
const sessions = ["proof-alpha", "proof-beta", "proof-read-only"];

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Positioning proof failed: ${message}\n`);
  process.exitCode = 1;
});

async function main() {
  if (process.argv.length > 2) {
    throw new Error(
      "This proof takes no arguments and only uses its bundled loopback fixture.",
    );
  }
  await access(cliEntry).catch(() => {
    throw new Error(
      "dist/cli.js is missing. Run `bun run build` before the proof.",
    );
  });

  const runtimeDirectory = await mkdtemp(
    join(tmpdir(), "blop-positioning-proof-"),
  );
  let fixture;
  const checks = [];
  let cliInvocations = 0;

  const invoke = async (args, environment = {}) => {
    cliInvocations += 1;
    return await runCli(args, runtimeDirectory, environment);
  };

  try {
    fixture = await startLoopbackFixture();
    const [openedAlpha, openedBeta] = await Promise.all([
      invoke([
        "--session",
        "proof-alpha",
        "open",
        `${fixture.origin}/workspace?owner=alpha`,
        "--json",
      ]),
      invoke([
        "--session",
        "proof-beta",
        "open",
        `${fixture.origin}/workspace`,
        "--json",
      ]),
    ]);
    requireSuccess(openedAlpha, "open proof-alpha");
    requireSuccess(openedBeta, "open proof-beta");

    const [initialAlphaStatus, betaStatus] = await Promise.all([
      invoke(["--session", "proof-alpha", "status", "--json"]),
      invoke(["--session", "proof-beta", "status", "--json"]),
    ]);
    const alphaStatus = successfulResult(
      initialAlphaStatus,
      "status proof-alpha",
    );
    const initialBetaStatus = successfulResult(betaStatus, "status proof-beta");
    const alphaScope = sessionScope(alphaStatus, "proof-alpha");
    const betaScope = sessionScope(initialBetaStatus, "proof-beta");
    recordCheck(checks, "parallel-isolation", {
      concurrentStartup: true,
      distinctProfiles:
        alphaScope.profileDirectory !== betaScope.profileDirectory,
      distinctDownloads:
        alphaScope.downloadsDirectory !== betaScope.downloadsDirectory,
      managedStorage:
        alphaScope.storageScope === "session" &&
        betaScope.storageScope === "session",
    });

    const boundedResponse = await invoke([
      "--session",
      "proof-alpha",
      "call",
      "browser_snapshot",
      "--input",
      JSON.stringify({ maxElements: 1 }),
      "--json",
    ]);
    const boundedResult = successfulResult(boundedResponse, "bounded snapshot");
    const boundedSnapshot = parseToolContent(boundedResult, "bounded snapshot");
    const requestedMaximum = 1;
    const exposedReferences = nonemptyLines(
      boundedSnapshot.semanticSnapshot,
    ).filter((line) => /^\[((?:f\d+)?e\d+|x\d+)\]/.test(line));
    const incrementRef = exposedReferences[0]?.match(
      /^\[((?:f\d+)?e\d+|x\d+)\] button "Increment"/,
    )?.[1];
    recordCheck(checks, "bounded-observation", {
      requestedMaximum,
      exposedReferenceCount: exposedReferences.length,
      withinRequestedMaximum: exposedReferences.length <= requestedMaximum,
      omittedInteractiveElementCount:
        boundedSnapshot.omittedInteractiveElements,
      omissionReported: Number(boundedSnapshot.omittedInteractiveElements) > 0,
      opaqueReference: Boolean(incrementRef),
      untrustedBrowserBoundary:
        boundedResult.contentBoundary?.source === "browser" &&
        boundedResult.contentBoundary?.trust === "untrusted",
    });
    requireInvariant(
      Boolean(incrementRef),
      "bounded snapshot did not expose Increment",
    );

    const clicked = await invoke([
      "--session",
      "proof-alpha",
      "click",
      String(incrementRef),
      "--json",
    ]);
    requireSuccess(clicked, "click current semantic ref");
    const afterClickResponse = await invoke([
      "--session",
      "proof-alpha",
      "snapshot",
      "--json",
    ]);
    const afterClick = parseToolContent(
      successfulResult(afterClickResponse, "snapshot after click"),
      "snapshot after click",
    );
    requireInvariant(
      afterClick.text.includes("Count 1"),
      "semantic ref click did not update the fixture",
    );

    const activeStatusResponse = await invoke([
      "--session",
      "proof-alpha",
      "status",
      "--json",
    ]);
    const activeStatus = successfulResult(
      activeStatusResponse,
      "active status",
    );
    recordCheck(checks, "cross-process-session", {
      cliInvocationCount: cliInvocations,
      multipleSeparateCliInvocations: cliInvocations > 1,
      sameDaemonPid: alphaStatus.pid === activeStatus.pid,
      retainedPageState: afterClick.text.includes("Count 1"),
      recordedActionsIncreased:
        Number(activeStatus.actions) > Number(alphaStatus.actions),
    });
    recordCheck(checks, "inspectable-scope", {
      mode: alphaScope.mode,
      persistentMode: alphaScope.mode === "persistent",
      storageScope: alphaScope.storageScope,
      sessionStorageScope: alphaScope.storageScope === "session",
      profilePathReported: typeof alphaScope.profileDirectory === "string",
      downloadsPathReported: typeof alphaScope.downloadsDirectory === "string",
      artifactPathReported: typeof alphaScope.artifactDirectory === "string",
      ownerReported:
        typeof alphaScope.owner === "string" && alphaScope.owner.length > 0,
      destroyable: alphaScope.destroyable === true,
    });

    const navigated = await invoke([
      "--session",
      "proof-alpha",
      "open",
      `${fixture.origin}/other`,
      "--json",
    ]);
    requireSuccess(navigated, "navigate before stale-ref check");
    const staleAttempt = await invoke([
      "--session",
      "proof-alpha",
      "click",
      String(incrementRef),
      "--json",
    ]);
    recordCheck(checks, "stale-reference", {
      rejected:
        staleAttempt.exitCode !== 0 && staleAttempt.response?.ok === false,
      deterministicMessage:
        staleAttempt.response?.error?.message?.includes(
          "Unknown or stale element reference",
        ) === true,
      untrustedMixedBoundary:
        staleAttempt.response?.error?.contentBoundary?.source === "mixed" &&
        staleAttempt.response?.error?.contentBoundary?.trust === "untrusted",
    });

    const closedAlpha = await invoke([
      "--session",
      "proof-alpha",
      "close",
      "--json",
    ]);
    requireSuccess(closedAlpha, "close persistent proof-alpha");
    requireInvariant(
      await pathExists(alphaScope.profileDirectory),
      "persistent profile disappeared after close",
    );
    const reopenedAlpha = await invoke([
      "--session",
      "proof-alpha",
      "open",
      `${fixture.origin}/workspace`,
      "--json",
    ]);
    requireSuccess(reopenedAlpha, "reopen persistent proof-alpha");
    const restoredResponse = await invoke([
      "--session",
      "proof-alpha",
      "snapshot",
      "--json",
    ]);
    const restored = parseToolContent(
      successfulResult(restoredResponse, "restored snapshot"),
      "restored snapshot",
    );
    recordCheck(checks, "persistent-profile", {
      survivedExplicitClose: true,
      ownerRestored: restored.text.includes("Owner alpha"),
      counterRestored: restored.text.includes("Count 1"),
    });

    const betaSnapshotResponse = await invoke([
      "--session",
      "proof-beta",
      "snapshot",
      "--json",
    ]);
    const betaSnapshot = parseToolContent(
      successfulResult(betaSnapshotResponse, "isolated beta snapshot"),
      "isolated beta snapshot",
    );
    recordCheck(checks, "parallel-browser-storage", {
      ownerStorageSeparated: betaSnapshot.text.includes("Owner empty"),
      counterStorageSeparated: betaSnapshot.text.includes("Count 0"),
    });

    const readOnlyOpened = await invoke(
      [
        "--session",
        "proof-read-only",
        "--profile",
        "disposable",
        "open",
        `${fixture.origin}/workspace`,
        "--json",
      ],
      { BLOP_BROWSER_READ_ONLY: "1" },
    );
    requireSuccess(readOnlyOpened, "open disposable read-only session");
    const readOnlyStatusResponse = await invoke([
      "--session",
      "proof-read-only",
      "status",
      "--json",
    ]);
    const readOnlyStatus = successfulResult(
      readOnlyStatusResponse,
      "read-only status",
    );
    const disposableScope = sessionScope(readOnlyStatus, "proof-read-only");
    const readOnlySnapshotResponse = await invoke([
      "--session",
      "proof-read-only",
      "snapshot",
      "--json",
    ]);
    const readOnlySnapshotResult = successfulResult(
      readOnlySnapshotResponse,
      "read-only snapshot",
    );
    const readOnlySnapshot = parseToolContent(
      readOnlySnapshotResult,
      "read-only snapshot",
    );
    const readOnlyRef = nonemptyLines(
      readOnlySnapshot.semanticSnapshot,
    )[0]?.match(/^\[((?:f\d+)?e\d+|x\d+)\] button "Increment"/)?.[1];
    requireInvariant(
      Boolean(readOnlyRef),
      "read-only snapshot did not expose Increment",
    );
    const denied = await invoke([
      "--session",
      "proof-read-only",
      "click",
      readOnlyRef,
      "--json",
    ]);
    const unchangedResponse = await invoke([
      "--session",
      "proof-read-only",
      "snapshot",
      "--json",
    ]);
    const unchanged = parseToolContent(
      successfulResult(unchangedResponse, "snapshot after denied click"),
      "snapshot after denied click",
    );
    recordCheck(checks, "read-only-policy", {
      modeReported: readOnlyStatus.safetyMode === "read-only",
      deniedBeforeDispatch:
        denied.exitCode !== 0 &&
        denied.response?.error?.policy?.code === "read_only",
      staticCategory: denied.response?.error?.policy?.category === "pointer",
      trustedPolicyBoundary:
        denied.response?.error?.contentBoundary?.source === "harness" &&
        denied.response?.error?.contentBoundary?.trust === "trusted",
      pageUnchanged: unchanged.text.includes("Count 0"),
    });

    const readOnlyClosed = await invoke([
      "--session",
      "proof-read-only",
      "close",
      "--json",
    ]);
    requireSuccess(readOnlyClosed, "close disposable read-only session");
    await waitForMissing([
      disposableScope.profileDirectory,
      disposableScope.downloadsDirectory,
      disposableScope.artifactDirectory,
    ]);
    recordCheck(checks, "disposable-cleanup", {
      mode: disposableScope.mode,
      disposableMode: disposableScope.mode === "disposable",
      expiryReported: typeof disposableScope.expiresAt === "string",
      profileRemoved: !(await pathExists(disposableScope.profileDirectory)),
      downloadsRemoved: !(await pathExists(disposableScope.downloadsDirectory)),
      artifactsRemoved: !(await pathExists(disposableScope.artifactDirectory)),
    });

    const [destroyedAlphaResponse, destroyedBetaResponse] = await Promise.all([
      invoke(["--session", "proof-alpha", "destroy", "--json"]),
      invoke(["--session", "proof-beta", "destroy", "--json"]),
    ]);
    const destroyedAlpha = successfulResult(
      destroyedAlphaResponse,
      "destroy proof-alpha",
    );
    const destroyedBeta = successfulResult(
      destroyedBetaResponse,
      "destroy proof-beta",
    );
    recordCheck(checks, "managed-destruction", {
      alphaProfileDestroyed: destroyedAlpha.profileDestroyed === true,
      betaProfileDestroyed: destroyedBeta.profileDestroyed === true,
      alphaProfileRemoved: !(await pathExists(alphaScope.profileDirectory)),
      betaProfileRemoved: !(await pathExists(betaScope.profileDirectory)),
    });

    const report = `${JSON.stringify(
      {
        proof: "blop-browser-positioning-contract",
        scope: {
          network: "loopback-only",
          evidence: "architectural-contract",
          notEvidenceFor: ["task-success", "security", "performance"],
        },
        passed: true,
        checks,
      },
      null,
      2,
    )}\n`;
    requireInvariant(
      Buffer.byteLength(report) <= outputLimit,
      `proof report exceeded the ${outputLimit}-byte output limit`,
    );
    process.stdout.write(report);
  } finally {
    await Promise.all(
      sessions.map((session) =>
        invoke(["--session", session, "destroy", "--json"]).catch(
          () => undefined,
        ),
      ),
    );
    await fixture?.close();
    await rm(runtimeDirectory, { recursive: true, force: true });
  }
}

function recordCheck(checks, id, evidence) {
  const failed = Object.entries(evidence)
    .filter(
      ([, value]) => value === false || value === null || value === undefined,
    )
    .map(([name]) => name);
  if (failed.length > 0) {
    throw new Error(`${id} failed invariant(s): ${failed.join(", ")}`);
  }
  checks.push({ id, passed: true, evidence });
}

function requireInvariant(condition, message) {
  if (!condition) throw new Error(message);
}

function requireSuccess(result, operation) {
  requireInvariant(
    result.exitCode === 0 && result.response?.ok === true,
    `${operation} failed: ${result.stderr || result.stdout}`,
  );
}

function successfulResult(result, operation) {
  requireSuccess(result, operation);
  requireInvariant(
    result.response.result && typeof result.response.result === "object",
    `${operation} returned no result object`,
  );
  return result.response.result;
}

function sessionScope(status, session) {
  const scope = status.sessionScope;
  requireInvariant(
    scope && typeof scope === "object",
    `${session} did not report sessionScope`,
  );
  return scope;
}

function parseToolContent(result, operation) {
  requireInvariant(
    typeof result.content === "string",
    `${operation} returned no content`,
  );
  let parsed;
  try {
    parsed = JSON.parse(result.content);
  } catch {
    throw new Error(`${operation} returned non-JSON tool content`);
  }
  requireInvariant(
    parsed && typeof parsed === "object",
    `${operation} content was not an object`,
  );
  return parsed;
}

function nonemptyLines(value) {
  return typeof value === "string"
    ? value.split("\n").filter((line) => line.trim().length > 0)
    : [];
}

async function runCli(args, runtimeDirectory, environment) {
  const childEnvironment = {
    ...process.env,
    BLOP_BROWSER_CONFIG_PATH: join(runtimeDirectory, "config.json"),
    BLOP_BROWSER_RUNTIME_DIR: runtimeDirectory,
    BLOP_BROWSER_HEADLESS: "1",
    BLOP_BROWSER_IDLE_TIMEOUT_MS: "60000",
    ...environment,
  };
  const result = await executeFile(process.execPath, [cliEntry, ...args], {
    cwd: repositoryRoot,
    env: childEnvironment,
    maxBuffer: outputLimit,
    timeout: 120_000,
  });
  const stdout = result.stdout.trim();
  let response;
  try {
    response = JSON.parse(stdout);
  } catch {
    throw new Error(`CLI returned invalid JSON: ${stdout.slice(0, 500)}`);
  }
  return { ...result, stdout, response };
}

function executeFile(file, args, options) {
  return new Promise((resolvePromise) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      const exitCode =
        typeof error?.code === "number" ? error.code : error ? 1 : 0;
      resolvePromise({
        exitCode,
        stdout: String(stdout),
        stderr: String(stderr).trim(),
      });
    });
  });
}

async function startLoopbackFixture() {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/workspace") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(workspaceHtml());
      return;
    }
    if (url.pathname === "/other") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        "<!doctype html><title>Other</title><main><h1>Other page</h1></main>",
      );
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  });
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolvePromise();
    });
  });
  const address = server.address();
  if (
    !address ||
    typeof address === "string" ||
    address.address !== "127.0.0.1"
  ) {
    await new Promise((resolvePromise) => server.close(() => resolvePromise()));
    throw new Error("fixture did not bind exclusively to IPv4 loopback");
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolvePromise) => {
        try {
          server.closeAllConnections();
        } catch {}
        server.close(() => resolvePromise());
      }),
  };
}

function workspaceHtml() {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Positioning proof</title></head>
  <body>
    <main>
      <h1>Local workspace</h1>
      <p id="owner"></p>
      <p id="count"></p>
      <button id="increment" type="button">Increment</button>
      <button id="secondary" type="button">Secondary action</button>
    </main>
    <script>
      const requestedOwner = new URLSearchParams(location.search).get("owner");
      if (requestedOwner) localStorage.setItem("owner", requestedOwner);
      const owner = localStorage.getItem("owner") || "empty";
      let count = Number(localStorage.getItem("count") || "0");
      const render = () => {
        document.querySelector("#owner").textContent = "Owner " + owner;
        document.querySelector("#count").textContent = "Count " + count;
      };
      document.querySelector("#increment").addEventListener("click", () => {
        count += 1;
        localStorage.setItem("count", String(count));
        render();
      });
      render();
    </script>
  </body>
</html>`;
}

async function pathExists(path) {
  if (typeof path !== "string") return false;
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function waitForMissing(paths) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if ((await Promise.all(paths.map(pathExists))).every((exists) => !exists))
      return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error(
    "disposable session directories were not removed after close",
  );
}
