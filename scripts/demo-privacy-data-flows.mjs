#!/usr/bin/env node

import { execFile } from "node:child_process";
import { access, lstat, mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliEntry = join(repositoryRoot, "dist", "cli.js");
const session = "privacy-proof";
const maxOutputBytes = 1_048_576;
const maxFailureOutputBytes = 2_048;

main().catch((error) => {
  process.stderr.write(publicFailureOutput(error));
  process.exitCode = 1;
});

async function main() {
  if (process.argv.length > 2) {
    throw new Error(
      "This proof takes no arguments and uses only its loopback fixture.",
    );
  }
  await access(cliEntry).catch(() => {
    throw new Error(
      "dist/cli.js is missing. Run `bun run build` before the proof.",
    );
  });

  const runtimeDirectory = await mkdtemp(join(tmpdir(), "blop-privacy-proof-"));
  const environment = {
    BLOP_BROWSER_CONFIG_PATH: join(runtimeDirectory, "global-config.json"),
    BLOP_BROWSER_HEADLESS: "1",
    BLOP_BROWSER_IDLE_TIMEOUT_MS: "60000",
    BLOP_BROWSER_RUNTIME_DIR: runtimeDirectory,
  };
  let fixture;
  let deleted = false;
  const failures = [];
  try {
    fixture = await startFixture();
    const run = async (args) => await invokeCli(args, environment);

    const opened = await run([
      "--session",
      session,
      "open",
      `${fixture.origin}/fixture`,
      "--json",
    ]);
    requireSuccess(opened, "open");
    await requireSuccess(
      await run(["--session", session, "snapshot", "--json"]),
      "snapshot",
    );
    await requireSuccess(
      await run([
        "--session",
        session,
        "screenshot",
        "privacy-proof",
        "--json",
      ]),
      "screenshot",
    );
    const status = requireSuccess(
      await run(["--session", session, "status", "--json"]),
      "status",
    );
    await requireSuccess(
      await run(["--session", session, "trace", "--json"]),
      "trace",
    );
    await requireSuccess(
      await run(["--session", session, "metrics", "--json"]),
      "metrics",
    );
    const before = requireSuccess(
      await run(["data", "list", "--json"]),
      "data list before delete",
    );
    const beforeEntries = await boundedTopLevelEntries(runtimeDirectory);

    const deletion = requireSuccess(
      await run(["data", "delete", session, "--json"]),
      "data delete",
    );
    deleted = deletion.destroyed === true;
    const after = requireSuccess(
      await run(["data", "list", "--json"]),
      "data list after delete",
    );
    const afterEntries = await boundedTopLevelEntries(runtimeDirectory);

    const privacy = opened.response.privacy;
    check(
      failures,
      privacy?.mode === "local-managed",
      "startup mode was not local-managed",
    );
    check(
      failures,
      privacy?.telemetry?.firstPartyHarness === "off",
      "startup telemetry was not off",
    );
    check(
      failures,
      privacy?.recording?.actionTrace === "on",
      "trace recording was not reported on",
    );
    check(
      failures,
      privacy?.recording?.sessionMetrics === "on",
      "metrics recording was not reported on",
    );
    check(
      failures,
      status.privacy?.locations?.profileDirectory ===
        join(runtimeDirectory, `${session}-profile`),
      "status profile path was inaccurate",
    );
    const retainedSession = before.sessions?.find(
      (item) => item.session === session,
    );
    check(
      failures,
      Boolean(retainedSession),
      "inventory omitted the retained session",
    );
    check(
      failures,
      retainedSession?.entries?.some((entry) => entry.kind === "artifacts"),
      "inventory omitted artifacts",
    );
    check(failures, deleted, "data delete did not complete");
    check(
      failures,
      !after.sessions?.some((item) => item.session === session),
      "deleted session remained in inventory",
    );
    const managedPaths = [
      `${session}-profile`,
      `${session}-downloads`,
      `${session}-artifacts`,
      `${session}.json`,
      `${session}.starting`,
      `${session}.log`,
    ];
    check(
      failures,
      managedPaths.every((name) => !afterEntries.includes(name)),
      "a fixed managed path remained after delete",
    );
    check(
      failures,
      fixture.requests.length > 0 &&
        fixture.requests.every(
          (request) => request.path === "/fixture" && request.remoteLoopback,
        ),
      `fixture observed an unexpected request: ${JSON.stringify(fixture.requests).slice(0, 1_000)}`,
    );

    const summary = {
      version: 1,
      protocol: "bounded-loopback-privacy-lifecycle",
      scope:
        "CLI declarations, loopback fixture requests, and top-level managed filesystem metadata",
      startup: {
        mode: privacy?.mode,
        telemetry: privacy?.telemetry,
        recording: privacy?.recording,
        retention: privacy?.retention,
      },
      beforeDelete: {
        listedKinds:
          retainedSession?.entries?.map((entry) => entry.kind).sort() ?? [],
        topLevelEntryCount: beforeEntries.length,
      },
      afterDelete: {
        sessionListed:
          after.sessions?.some((item) => item.session === session) ?? false,
        fixedManagedPathsAbsent: managedPaths.every(
          (name) => !afterEntries.includes(name),
        ),
        topLevelEntryCount: afterEntries.length,
      },
      fixture: {
        loopbackOnly: fixture.requests.every(
          (request) => request.remoteLoopback,
        ),
        requests: fixture.requests.map((request) => request.path),
      },
      failures,
      limitations: [
        "This proof does not capture packets or establish that no other network request occurred.",
        "Filesystem absence is not verified secure erasure or deletion of backups, remote copies, website data, caches, Docker resources, or provider records.",
        "The fixture does not exercise a remote CDP endpoint, third-party installer, container registry, benchmark, or model provider.",
      ],
    };
    if (failures.length > 0) throw new Error(failures.join("; "));
    const output = `${JSON.stringify(summary, null, 2)}\n`;
    if (Buffer.byteLength(output) > 32_768)
      throw new Error("Summary exceeded 32 KiB.");
    process.stdout.write(output);
  } finally {
    if (!deleted) await bestEffortDelete(environment);
    if (fixture) await fixture.close();
    await rm(runtimeDirectory, { recursive: true, force: true });
  }
}

async function bestEffortDelete(environment) {
  await execFileAsync(
    process.execPath,
    [cliEntry, "data", "delete", session, "--json"],
    {
      cwd: repositoryRoot,
      env: { ...process.env, ...environment },
      maxBuffer: maxOutputBytes,
      timeout: 30_000,
    },
  ).catch(() => undefined);
}

async function invokeCli(args, environment) {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [cliEntry, ...args],
    {
      cwd: repositoryRoot,
      env: { ...process.env, ...environment },
      maxBuffer: maxOutputBytes,
      timeout: 30_000,
    },
  ).catch((error) => ({
    stdout: error.stdout ?? "",
    stderr: error.stderr ?? error.message,
  }));
  let response;
  try {
    response = JSON.parse(stdout);
  } catch {
    throw new Error(
      `CLI returned invalid JSON: ${String(stderr).slice(0, 500)}`,
    );
  }
  return { response, stderr: String(stderr) };
}

function requireSuccess(result, label) {
  if (!result.response?.ok) {
    throw new Error(
      `${label} failed: ${result.response?.error?.message ?? result.stderr}`,
    );
  }
  return result.response.result;
}

function check(failures, condition, message) {
  if (!condition) failures.push(message);
}

function publicFailureOutput(error) {
  const prefix = "Privacy lifecycle proof failed: ";
  const suffix = "\n";
  const raw = (error instanceof Error ? error.message : String(error)).slice(
    0,
    8_192,
  );
  const sanitized = stripControlCharacters(
    raw
      .replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi, (value) => safeUrl(value))
      .replaceAll(repositoryRoot, "[repository]")
      .replace(
        /\/(?:home|tmp|var\/tmp|private\/tmp|Users)\/[^\s"'`]+/g,
        "[path]",
      )
      .replace(/\b[A-Za-z]:\\[^\s"'`]+/g, "[path]"),
  )
    .replace(/\s+/g, " ")
    .trim();
  const messageBudget =
    maxFailureOutputBytes -
    Buffer.byteLength(prefix) -
    Buffer.byteLength(suffix);
  return `${prefix}${boundedUtf8(sanitized || "unknown error", messageBudget)}${suffix}`;
}

function stripControlCharacters(value) {
  return [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint < 32 || codePoint === 127)
        ? " "
        : character;
    })
    .join("");
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    const port =
      url.port || (["http:", "ws:"].includes(url.protocol) ? "80" : "443");
    return `${url.protocol}//${url.hostname}:${port}`;
  } catch {
    return "[url]";
  }
}

function boundedUtf8(value, maxBytes) {
  if (Buffer.byteLength(value) <= maxBytes) return value;
  const suffix = "...";
  const contentBudget = maxBytes - Buffer.byteLength(suffix);
  let output = "";
  let bytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character);
    if (bytes + characterBytes > contentBudget) break;
    output += character;
    bytes += characterBytes;
  }
  return `${output}${suffix}`;
}

async function boundedTopLevelEntries(directory) {
  const entries = (await readdir(directory)).sort();
  if (entries.length > 64)
    throw new Error("Runtime directory exceeded the 64-entry proof limit.");
  for (const name of entries) {
    await lstat(join(directory, name));
  }
  return entries;
}

async function startFixture() {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({
      path: request.url,
      remoteLoopback: ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
        request.socket.remoteAddress,
      ),
    });
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(
      '<!doctype html><link rel="icon" href="data:,index"><title>Privacy proof</title><main><h1>Local privacy fixture</h1></main>',
    );
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Fixture did not bind a TCP port.");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => await new Promise((resolve) => server.close(resolve)),
  };
}
