import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const chromiumExecutable = require("playwright").chromium.executablePath();
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const defaultProtocolPath = fileURLToPath(
  new URL("protocol.json", import.meta.url),
);
const resultDirectory = fileURLToPath(new URL(".results", import.meta.url));
const cliEntry = join(repositoryRoot, "dist", "cli.js");
const maxReportBytes = 256 * 1024;
const maxProcessOutputBytes = 2 * 1024 * 1024;
const maxFailureReasonLength = 1_000;
const maxRunnableBuildFiles = 512;
const maxRunnableBuildFileBytes = 4 * 1024 * 1024;
const maxRunnableBuildBytes = 64 * 1024 * 1024;
const maxRunnableBuildPathBytes = 512;
const maxRunnableBuildEntries = 2_048;
const maxRunnableBuildDepth = 32;
const fixtureMarker = "blop-session-metrics-fixture-v1";
const protocolName = "Blop Browser local session metrics protocol";
const protocolPurpose =
  "Measure cold-start and warm-resume latency plus exact harness-observable session metrics with an identical built CLI workflow against a loopback fixture.";
const expectedConfiguration = {
  interface: "built-node-cli",
  entry: "dist/cli.js",
  build_hash: "complete-dist-js-tree-v1",
  browser: "chromium",
  executable_source: "playwright-bundled",
  headless: true,
  profile: "persistent-fresh-per-repetition",
  commands: ["open", "snapshot"],
};
const expectedPhases = {
  cold_start: {
    precondition:
      "No healthy daemon, profile, downloads, or artifacts exist for the fresh session.",
    timer_start:
      "Immediately before the parent process spawns the open command.",
    workflow: ["open-loopback-fixture", "snapshot-loopback-fixture"],
    timer_end:
      "After the parent process parses the snapshot response and validates its exact loopback URL and fixture marker.",
  },
  warm_resume: {
    precondition:
      "The same session daemon is healthy and ready, verified by status outside the timer.",
    timer_start:
      "Immediately before the parent process spawns the same open command.",
    workflow: ["open-loopback-fixture", "snapshot-loopback-fixture"],
    timer_end:
      "After the parent process parses the snapshot response and validates its exact loopback URL and fixture marker.",
  },
};
const expectedMeasurementScope = {
  latency_clock: "parent-process performance.now monotonic clock",
  payload_characters: "Unicode code points",
  payload_bytes: "UTF-8 bytes",
  tokens:
    "null unless exact provider-reported or tokenizer-specific counts are supplied by a host",
  outside_timers: ["readiness checks", "metrics export", "teardown"],
};
const expectedLimitations = [
  "The loopback workflow measures this built CLI, browser, machine, and run configuration; it does not predict another host, browser interface, website, or machine.",
  "Cold-start duration includes parent process spawn, daemon startup, browser launch, navigation, a second CLI process, and snapshot validation. Warm-resume duration includes the same two CLI commands and validation but reuses the verified-ready daemon and browser.",
  "Session command durations cover elapsed harness dispatch, including time inside Playwright calls. Retry counts exclude Playwright-internal polling. Payload volumes cover serialized tool inputs and returned tool content; they exclude parent CLI envelope bytes and provider context outside tool calls.",
  "The harness reports exact Unicode code points and UTF-8 bytes. It does not convert them into tokens or claim provider token usage.",
  "Three local repetitions are bounded evidence, not a universal performance guarantee or a comparison with another interface.",
];

export async function loadSessionMetricsProtocol(
  protocolPath = defaultProtocolPath,
) {
  const raw = await readFile(protocolPath, "utf8");
  const protocol = JSON.parse(raw);
  validateProtocol(protocol);
  return {
    protocol,
    sha256: createHash("sha256").update(raw).digest("hex"),
  };
}

export function validateProtocol(protocol) {
  if (!isObject(protocol)) throw new Error("Protocol must be a JSON object.");
  exactKeys(protocol, [
    "protocol_version",
    "name",
    "purpose",
    "repetitions",
    "target",
    "configuration",
    "phases",
    "measurement_scope",
    "limitations",
  ]);
  if (
    protocol.protocol_version !== "1.0.0" ||
    protocol.name !== protocolName ||
    protocol.purpose !== protocolPurpose ||
    protocol.repetitions !== 3
  ) {
    throw new Error("Protocol identity must match version 1.0.0.");
  }
  if (
    stableJson(protocol.target) !==
      stableJson({
        kind: "loopback-fixture",
        host: "127.0.0.1",
        path: "/session-metrics",
      }) ||
    stableJson(protocol.configuration) !== stableJson(expectedConfiguration) ||
    stableJson(protocol.phases) !== stableJson(expectedPhases) ||
    stableJson(protocol.measurement_scope) !==
      stableJson(expectedMeasurementScope) ||
    stableJson(protocol.limitations) !== stableJson(expectedLimitations)
  ) {
    throw new Error("Protocol configuration doesn't match version 1.0.0.");
  }
  return protocol;
}

export function assertLoopbackSessionUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.pathname !== "/session-metrics" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "The session metrics protocol can load only its 127.0.0.1 /session-metrics fixture.",
    );
  }
  return url.href;
}

/** Hash every runnable JavaScript file in a built dist tree. */
export async function hashRunnableDistJavaScript(directory) {
  const root = resolve(directory);
  const files = [];
  await collectRunnableJavaScript(root, root, files, { entries: 0 }, 0);
  files.sort((left, right) =>
    left.relativePath < right.relativePath
      ? -1
      : left.relativePath > right.relativePath
        ? 1
        : 0,
  );
  if (files.length === 0) {
    throw new Error("Runnable build contains no JavaScript files.");
  }

  const hash = createHash("sha256");
  hash.update("blop-browser-complete-dist-js-tree-v1\0");
  let totalBytes = 0;
  for (const file of files) {
    const pathBytes = Buffer.from(file.relativePath, "utf8");
    totalBytes += file.bytes;
    if (totalBytes > maxRunnableBuildBytes) {
      throw new Error("Runnable build exceeds its evidence byte bound.");
    }
    const content = await readFile(file.path);
    if (content.byteLength !== file.bytes) {
      throw new Error("Runnable build changed while it was being hashed.");
    }
    const lengths = Buffer.alloc(8);
    lengths.writeUInt32BE(pathBytes.byteLength, 0);
    lengths.writeUInt32BE(content.byteLength, 4);
    hash.update(lengths);
    hash.update(pathBytes);
    hash.update(content);
  }
  return {
    sha256: hash.digest("hex"),
    files: files.length,
    bytes: totalBytes,
  };
}

export async function startSessionMetricsFixture() {
  const server = createServer((request, response) => {
    const host = request.headers.host ?? "";
    if (!/^127\.0\.0\.1:\d+$/.test(host)) {
      response.writeHead(421, { "content-type": "text/plain; charset=utf-8" });
      response.end("Loopback host required.");
      return;
    }
    if (request.method !== "GET" || request.url !== "/session-metrics") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found.");
      return;
    }
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'",
      "content-type": "text/html; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    });
    response.end(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Local session metrics fixture</title></head><body><main><h1>Local session metrics fixture</h1><p>${fixtureMarker}</p></main></body></html>`,
    );
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not resolve the loopback fixture port.");
  }
  return {
    url: assertLoopbackSessionUrl(
      `http://127.0.0.1:${address.port}/session-metrics`,
    ),
    close: () =>
      new Promise((resolveClose) => {
        try {
          server.closeAllConnections();
        } catch {}
        server.close(() => resolveClose());
      }),
  };
}

export async function runSessionMetricsProtocol(options = {}) {
  const { protocol, sha256 } = await loadSessionMetricsProtocol(
    options.protocolPath,
  );
  const entry = options.cliEntry ?? cliEntry;
  if (!entry.endsWith(".js")) {
    throw new Error("The session metrics CLI entry must be a JavaScript file.");
  }
  const runnableBuild = await hashRunnableDistJavaScript(dirname(entry));
  const fixture = options.fixture ?? (await startSessionMetricsFixture());
  const temporaryRoot = await mkdtemp(join(tmpdir(), "blop-session-metrics-"));
  const attempts = [];

  try {
    for (
      let repetition = 1;
      repetition <= protocol.repetitions;
      repetition += 1
    ) {
      const runtimeDirectory = join(temporaryRoot, `runtime-${repetition}`);
      const session = `metrics-${repetition}`;
      const paths = sessionPaths(runtimeDirectory, session);
      const environment = {
        ...process.env,
        BLOP_BROWSER_CONFIG_PATH: join(
          temporaryRoot,
          `config-${repetition}.json`,
        ),
        BLOP_BROWSER_RUNTIME_DIR: runtimeDirectory,
        BLOP_BROWSER_HEADLESS: "1",
        BLOP_BROWSER_EXECUTABLE_PATH: chromiumExecutable,
        BLOP_BROWSER_IDLE_TIMEOUT_MS: "60000",
        BLOP_BROWSER_NODE_PATH: process.execPath,
        BLOP_BROWSER_PROFILE: "persistent",
      };
      const attempt = {
        repetition,
        session,
        precondition: {
          status: "verified",
          reason:
            "Fresh session daemon, profile, downloads, and artifacts were absent before the cold timer.",
        },
        browser: null,
        cold_start: emptyPhase("cold_start"),
        readiness: emptyAuxiliary("readiness"),
        warm_resume: emptyPhase("warm_resume"),
        teardown: emptyAuxiliary("teardown"),
        final_session_metrics: null,
      };
      attempts.push(attempt);

      try {
        await assertFreshSession(paths);
        attempt.cold_start = await runTimedWorkflow({
          phase: "cold_start",
          entry,
          session,
          environment,
          fixtureUrl: fixture.url,
          runCli: options.runCli ?? runBuiltCli,
          temporaryRoot,
        });

        if (attempt.cold_start.status === "collected") {
          try {
            const coldMetricsResponse = await (options.runCli ?? runBuiltCli)({
              entry,
              session,
              args: ["metrics", "--json"],
              environment,
            });
            const coldMetrics = validateMetricsEnvelope(coldMetricsResponse);
            attempt.cold_start.metrics = compactMetrics(coldMetrics);
          } catch (error) {
            failPhase(attempt.cold_start, error, temporaryRoot);
          }
        }

        if (attempt.cold_start.status === "collected") {
          try {
            const statusResponse = await (options.runCli ?? runBuiltCli)({
              entry,
              session,
              args: ["status", "--json"],
              environment,
            });
            const ready = validateReadyStatus(statusResponse, fixture.url);
            attempt.browser = {
              name: ready.browser,
              version: ready.browserVersion,
              headless: true,
            };
            attempt.readiness = {
              phase: "readiness",
              status: "verified",
              failure_class: null,
              reason:
                "The same daemon reported active with the loopback fixture as its current page before the warm timer.",
            };
          } catch (error) {
            attempt.readiness = failedAuxiliary(
              "readiness",
              error,
              temporaryRoot,
            );
          }
        }

        if (attempt.readiness.status === "verified") {
          attempt.warm_resume = await runTimedWorkflow({
            phase: "warm_resume",
            entry,
            session,
            environment,
            fixtureUrl: fixture.url,
            runCli: options.runCli ?? runBuiltCli,
            temporaryRoot,
          });
          if (attempt.warm_resume.status === "collected") {
            try {
              const finalResponse = await (options.runCli ?? runBuiltCli)({
                entry,
                session,
                args: ["metrics", "--json"],
                environment,
              });
              const finalMetrics = validateMetricsEnvelope(finalResponse);
              attempt.final_session_metrics = compactMetrics(finalMetrics);
              attempt.warm_resume.metrics = subtractMetrics(
                attempt.final_session_metrics,
                attempt.cold_start.metrics,
              );
            } catch (error) {
              failPhase(attempt.warm_resume, error, temporaryRoot);
            }
          }
        }
      } catch (error) {
        attempt.precondition = {
          status: "failed",
          reason: sanitizeError(error, temporaryRoot),
        };
        if (attempt.cold_start.status === "not_run") {
          attempt.cold_start.reason =
            "Cold start was not run because its fresh-session precondition failed.";
        }
      } finally {
        try {
          const destroy = await (options.runCli ?? runBuiltCli)({
            entry,
            session,
            args: ["destroy", "--json"],
            environment,
          });
          attempt.teardown =
            destroy.exitCode !== 0 || destroy.response?.ok !== true
              ? failedAuxiliary(
                  "teardown",
                  new Error(
                    destroy.response?.error?.message ??
                      `Destroy exited with code ${destroy.exitCode}.`,
                  ),
                  temporaryRoot,
                )
              : {
                  phase: "teardown",
                  status: "verified",
                  failure_class: null,
                  reason:
                    "Session state was destroyed outside both latency timers.",
                };
        } catch (error) {
          attempt.teardown = failedAuxiliary("teardown", error, temporaryRoot);
        }
      }
    }
  } finally {
    if (!options.fixture) await fixture.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }

  const report = {
    schema_version: "1.0.0",
    generated_at: (options.now ?? (() => new Date()))().toISOString(),
    source: {
      ...sourceSnapshot(),
      protocol_sha256: sha256,
      runnable_dist_js_sha256: runnableBuild.sha256,
      runnable_dist_js_files: runnableBuild.files,
      runnable_dist_js_bytes: runnableBuild.bytes,
      ...packageSnapshot(),
    },
    environment: {
      node_version: process.version,
      platform: process.platform,
      architecture: process.arch,
      hostname: "redacted",
    },
    authorization: {
      target_scope: "loopback-only",
      third_party_sites: false,
      statement:
        "Every timed workflow loaded only the protocol's controlled 127.0.0.1 fixture.",
    },
    protocol: {
      protocol_version: protocol.protocol_version,
      name: protocol.name,
      repetitions: protocol.repetitions,
      target: structuredClone(protocol.target),
      configuration: structuredClone(protocol.configuration),
      phases: structuredClone(protocol.phases),
      measurement_scope: structuredClone(protocol.measurement_scope),
    },
    attempts,
    summary: summarizeAttempts(attempts),
    limitations: [...protocol.limitations],
  };
  validateReport(report);
  return report;
}

export async function writeSessionMetricsReport(report, outputPath) {
  validateReport(report);
  const resolved = assertIgnoredSessionMetricsPath(outputPath);
  await mkdir(dirname(resolved), { recursive: true });
  const output = `${JSON.stringify(report, null, 2)}\n`;
  assertReportSize(output);
  await writeFile(resolved, output, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return resolved;
}

async function collectRunnableJavaScript(root, current, files, state, depth) {
  if (depth > maxRunnableBuildDepth) {
    throw new Error("Runnable build exceeds its evidence depth bound.");
  }
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
  for (const entry of entries) {
    state.entries += 1;
    if (state.entries > maxRunnableBuildEntries) {
      throw new Error("Runnable build exceeds its evidence entry-count bound.");
    }
    const path = join(current, entry.name);
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) {
      throw new Error("Runnable build tree must not contain symbolic links.");
    }
    if (metadata.isDirectory()) {
      await collectRunnableJavaScript(root, path, files, state, depth + 1);
      continue;
    }
    if (!metadata.isFile()) {
      throw new Error("Runnable build tree contains an unsupported file type.");
    }
    if (!entry.name.endsWith(".js")) continue;
    if (files.length >= maxRunnableBuildFiles) {
      throw new Error("Runnable build exceeds its evidence file-count bound.");
    }
    const relativePath = relative(root, path).split("\\").join("/");
    const pathBytes = Buffer.byteLength(relativePath, "utf8");
    if (
      pathBytes === 0 ||
      pathBytes > maxRunnableBuildPathBytes ||
      metadata.size > maxRunnableBuildFileBytes
    ) {
      throw new Error("Runnable build file exceeds its evidence bound.");
    }
    files.push({ path, relativePath, bytes: metadata.size });
  }
}

export function assertIgnoredSessionMetricsPath(value) {
  const resolved = resolve(value);
  const child = relative(resultDirectory, resolved);
  if (
    !child ||
    child.startsWith("..") ||
    resolve(resultDirectory, child) !== resolved ||
    !resolved.endsWith(".json")
  ) {
    throw new Error(
      "Session metrics reports must use a .json path inside benchmarks/session-metrics/.results/.",
    );
  }
  return resolved;
}

export function summarizeAttempts(attempts) {
  const completed = attempts.filter((attempt) => pairCompleted(attempt));
  const failures = [];
  for (const attempt of attempts) {
    if (attempt.precondition.status === "failed") {
      failures.push({
        repetition: attempt.repetition,
        phase: "precondition",
        failure_class: "environment",
        reason: attempt.precondition.reason,
      });
    }
    for (const phase of [
      attempt.cold_start,
      attempt.readiness,
      attempt.warm_resume,
      attempt.teardown,
    ]) {
      if (phase.status === "failed") {
        failures.push({
          repetition: attempt.repetition,
          phase: phase.phase,
          failure_class: phase.failure_class,
          reason: phase.reason,
        });
      }
    }
  }
  return {
    requested_repetitions: attempts.length,
    completed_pairs: completed.length,
    failed_pairs: attempts.length - completed.length,
    cold_start_ms: durationSummary(
      completed.map((attempt) => attempt.cold_start.duration_ms),
    ),
    warm_resume_ms: durationSummary(
      completed.map((attempt) => attempt.warm_resume.duration_ms),
    ),
    failures,
  };
}

export function validateReport(report) {
  assertReportSize(JSON.stringify(report));
  if (!isObject(report)) {
    throw new Error("Session metrics report must be an object.");
  }
  exactKeys(report, [
    "schema_version",
    "generated_at",
    "source",
    "environment",
    "authorization",
    "protocol",
    "attempts",
    "summary",
    "limitations",
  ]);
  for (const [value, keys] of [
    [
      report.source,
      [
        "repository_commit",
        "working_tree_dirty",
        "protocol_sha256",
        "runnable_dist_js_sha256",
        "runnable_dist_js_files",
        "runnable_dist_js_bytes",
        "harness_version",
        "playwright_version",
      ],
    ],
    [
      report.environment,
      ["node_version", "platform", "architecture", "hostname"],
    ],
    [report.authorization, ["target_scope", "third_party_sites", "statement"]],
    [
      report.protocol,
      [
        "protocol_version",
        "name",
        "repetitions",
        "target",
        "configuration",
        "phases",
        "measurement_scope",
      ],
    ],
  ]) {
    if (!isObject(value)) {
      throw new Error("Session metrics report metadata is invalid.");
    }
    exactKeys(value, keys);
  }
  if (
    report.schema_version !== "1.0.0" ||
    !validIsoDate(report.generated_at) ||
    !/^[a-f0-9]{64}$/.test(report.source?.protocol_sha256 ?? "") ||
    !/^[a-f0-9]{64}$/.test(report.source?.runnable_dist_js_sha256 ?? "") ||
    !Number.isSafeInteger(report.source?.runnable_dist_js_files) ||
    report.source.runnable_dist_js_files < 1 ||
    report.source.runnable_dist_js_files > maxRunnableBuildFiles ||
    !Number.isSafeInteger(report.source?.runnable_dist_js_bytes) ||
    report.source.runnable_dist_js_bytes < 1 ||
    report.source.runnable_dist_js_bytes > maxRunnableBuildBytes ||
    !shortString(report.source?.harness_version, 64) ||
    !shortString(report.source?.playwright_version, 64) ||
    !shortString(report.environment?.node_version, 64) ||
    !shortString(report.environment?.platform, 64) ||
    !shortString(report.environment?.architecture, 64) ||
    report.environment?.hostname !== "redacted"
  ) {
    throw new Error("Session metrics report metadata is invalid.");
  }
  if (
    report.source.repository_commit !== null &&
    !/^[a-f0-9]{40}$/.test(report.source.repository_commit)
  ) {
    throw new Error("Session metrics report commit is invalid.");
  }
  if (![true, false, null].includes(report.source.working_tree_dirty)) {
    throw new Error("Session metrics report dirty state is invalid.");
  }
  if (
    report.authorization?.target_scope !== "loopback-only" ||
    report.authorization?.third_party_sites !== false ||
    report.authorization?.statement !==
      "Every timed workflow loaded only the protocol's controlled 127.0.0.1 fixture."
  ) {
    throw new Error("Session metrics report authorization scope is invalid.");
  }
  if (
    report.protocol?.protocol_version !== "1.0.0" ||
    report.protocol?.name !== protocolName ||
    report.protocol?.repetitions !== 3 ||
    stableJson(report.protocol?.target) !==
      stableJson({
        kind: "loopback-fixture",
        host: "127.0.0.1",
        path: "/session-metrics",
      }) ||
    stableJson(report.protocol?.configuration) !==
      stableJson(expectedConfiguration) ||
    stableJson(report.protocol?.phases) !== stableJson(expectedPhases) ||
    stableJson(report.protocol?.measurement_scope) !==
      stableJson(expectedMeasurementScope)
  ) {
    throw new Error("Session metrics report protocol is invalid.");
  }
  if (!Array.isArray(report.attempts) || report.attempts.length !== 3) {
    throw new Error("Session metrics report must retain three repetitions.");
  }
  for (let index = 0; index < report.attempts.length; index += 1) {
    validateAttempt(report.attempts[index], index + 1);
  }
  validateSummary(report.summary);
  if (
    stableJson(report.summary) !==
    stableJson(summarizeAttempts(report.attempts))
  ) {
    throw new Error("Session metrics summary must match retained attempts.");
  }
  if (stableJson(report.limitations) !== stableJson(expectedLimitations)) {
    throw new Error("Session metrics report must retain every limitation.");
  }
  return report;
}

async function runTimedWorkflow(options) {
  const phase = emptyPhase(options.phase);
  phase.started_at = new Date().toISOString();
  const started = performance.now();
  try {
    const open = await options.runCli({
      entry: options.entry,
      session: options.session,
      args: ["open", options.fixtureUrl, "--json"],
      environment: options.environment,
    });
    validateOpenEnvelope(open);
    const snapshot = await options.runCli({
      entry: options.entry,
      session: options.session,
      args: ["snapshot", "--json"],
      environment: options.environment,
    });
    validateSnapshotEnvelope(snapshot, options.fixtureUrl);
    phase.duration_ms = elapsed(started);
    phase.status = "collected";
    phase.failure_class = null;
    phase.reason =
      "The identical open and snapshot commands returned a validated loopback fixture observation.";
  } catch (error) {
    phase.duration_ms = elapsed(started);
    failPhase(phase, error, options.temporaryRoot);
  }
  return phase;
}

async function runBuiltCli({ entry, session, args, environment }) {
  return await new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      process.execPath,
      [
        entry,
        "--session",
        session,
        "--browser",
        "chromium",
        "--profile",
        "persistent",
        "--headless",
        ...args,
      ],
      {
        cwd: repositoryRoot,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;
    let timer;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectRun(error);
      else resolveRun(result);
    };
    const append = (current, chunk) => {
      const next = Buffer.concat([current, Buffer.from(chunk)]);
      if (next.byteLength > maxProcessOutputBytes) {
        child.kill("SIGKILL");
        finish(new Error("CLI process output exceeded the 2 MiB limit."));
      }
      return next;
    };
    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.once("error", (error) => finish(error));
    child.once("exit", (exitCode) => {
      const stdoutText = stdout.toString("utf8").trim();
      let response = null;
      try {
        response = stdoutText ? JSON.parse(stdoutText) : null;
      } catch {}
      finish(undefined, {
        exitCode: exitCode ?? -1,
        response,
        stdoutUtf8Bytes: stdout.byteLength,
        stderr: stderr.toString("utf8"),
      });
    });
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("CLI process timed out after 30 seconds."));
    }, 30_000);
  });
}

function validateOpenEnvelope(result) {
  if (
    result.exitCode !== 0 ||
    result.response?.ok !== true ||
    typeof result.response?.result?.content !== "string" ||
    !result.response.result.content.includes("Navigated to")
  ) {
    throw new Error(
      result.response?.error?.message ??
        `Open command exited with code ${result.exitCode}.`,
    );
  }
}

function validateSnapshotEnvelope(result, fixtureUrl) {
  if (
    result.exitCode !== 0 ||
    result.response?.ok !== true ||
    typeof result.response?.result?.content !== "string"
  ) {
    throw new Error(
      result.response?.error?.message ??
        `Snapshot command exited with code ${result.exitCode}.`,
    );
  }
  let snapshot;
  try {
    snapshot = JSON.parse(result.response.result.content);
  } catch {
    throw new Error("Snapshot command returned malformed tool content.");
  }
  if (
    snapshot.url !== fixtureUrl ||
    typeof snapshot.text !== "string" ||
    !snapshot.text.includes(fixtureMarker)
  ) {
    throw new Error(
      "Snapshot did not contain the exact loopback fixture evidence.",
    );
  }
}

function validateReadyStatus(result, fixtureUrl) {
  const status = result.response?.result;
  if (
    result.exitCode !== 0 ||
    result.response?.ok !== true ||
    status?.active !== true ||
    status?.connection !== "launch" ||
    status?.browser !== "chromium" ||
    status?.url !== fixtureUrl ||
    !Number.isInteger(status?.pid) ||
    !shortString(status?.browserVersion, 128)
  ) {
    throw new Error("Warm readiness status did not match the active session.");
  }
  return status;
}

function validateMetricsEnvelope(result) {
  if (
    result.exitCode !== 0 ||
    result.response?.ok !== true ||
    !isObject(result.response?.result)
  ) {
    throw new Error(
      result.response?.error?.message ??
        `Metrics command exited with code ${result.exitCode}.`,
    );
  }
  const metrics = result.response.result;
  if (
    metrics.version !== 1 ||
    metrics.tokenUsage?.inputTokens !== null ||
    metrics.tokenUsage?.outputTokens !== null ||
    metrics.tokenUsage?.totalTokens !== null ||
    metrics.tokenUsage?.availability !== "unavailable" ||
    metrics.tokenUsage?.source !== null ||
    metrics.tokenUsage?.tokenizer !== null
  ) {
    throw new Error(
      "Metrics command returned an invalid or fabricated token contract.",
    );
  }
  return metrics;
}

function compactMetrics(metrics) {
  const compact = {
    saturated: metrics.saturated,
    commands: {
      total: metrics.commands.total,
      succeeded: metrics.commands.succeeded,
      failed: metrics.commands.failed,
      snapshots: metrics.commands.snapshots,
      unclassified_actions: metrics.commands.unclassifiedActions,
      unclassified_retries: metrics.commands.unclassifiedRetries,
      retries: metrics.commands.retries.observed,
      approvals: structuredClone(metrics.commands.approvals),
      duration_ms: metrics.commands.duration.totalMs,
    },
    payloads: {
      tool_input_characters: metrics.payloads.toolInput.characters,
      tool_input_utf8_bytes: metrics.payloads.toolInput.utf8Bytes,
      tool_input_unmeasured: metrics.payloads.toolInput.unmeasured,
      tool_output_characters: metrics.payloads.toolOutput.characters,
      tool_output_utf8_bytes: metrics.payloads.toolOutput.utf8Bytes,
      tool_output_unmeasured: metrics.payloads.toolOutput.unmeasured,
      snapshot_output_characters: metrics.payloads.snapshotOutput.characters,
      snapshot_output_utf8_bytes: metrics.payloads.snapshotOutput.utf8Bytes,
      snapshot_output_unmeasured: metrics.payloads.snapshotOutput.unmeasured,
      model_images: metrics.payloads.modelImages.count,
      model_image_data_url_characters:
        metrics.payloads.modelImages.dataUrlCharacters,
      model_image_data_url_utf8_bytes:
        metrics.payloads.modelImages.dataUrlUtf8Bytes,
      model_images_unmeasured: metrics.payloads.modelImages.unmeasured,
    },
    tokens: {
      input: null,
      output: null,
      total: null,
      availability: "unavailable",
      source: null,
      tokenizer: null,
    },
  };
  validateCompactMetrics(compact);
  return compact;
}

function subtractMetrics(after, before) {
  if (!after || !before) {
    throw new Error("Both phase metric snapshots are required for a delta.");
  }
  const delta = structuredClone(after);
  delta.saturated = after.saturated || before.saturated;
  for (const field of [
    "total",
    "succeeded",
    "failed",
    "snapshots",
    "unclassified_actions",
    "unclassified_retries",
    "retries",
    "duration_ms",
  ]) {
    delta.commands[field] = subtractCounter(
      after.commands[field],
      before.commands[field],
      field,
    );
  }
  for (const field of ["requested", "approved", "denied"]) {
    delta.commands.approvals[field] = subtractCounter(
      after.commands.approvals[field],
      before.commands.approvals[field],
      `approvals.${field}`,
    );
  }
  for (const field of Object.keys(delta.payloads)) {
    delta.payloads[field] = subtractCounter(
      after.payloads[field],
      before.payloads[field],
      `payloads.${field}`,
    );
  }
  validateCompactMetrics(delta);
  return delta;
}

function subtractCounter(after, before, name) {
  const value = Number((after - before).toFixed(1));
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Session metrics delta ${name} is invalid.`);
  }
  return value;
}

function validateCompactMetrics(metrics) {
  if (
    !isObject(metrics) ||
    !isObject(metrics.commands) ||
    !isObject(metrics.commands.approvals) ||
    !isObject(metrics.payloads) ||
    !isObject(metrics.tokens)
  ) {
    throw new Error("Compact session metrics are invalid.");
  }
  exactKeys(metrics, ["saturated", "commands", "payloads", "tokens"]);
  exactKeys(metrics.commands, [
    "total",
    "succeeded",
    "failed",
    "snapshots",
    "unclassified_actions",
    "unclassified_retries",
    "retries",
    "approvals",
    "duration_ms",
  ]);
  exactKeys(metrics.commands.approvals, ["requested", "approved", "denied"]);
  exactKeys(metrics.payloads, [
    "tool_input_characters",
    "tool_input_utf8_bytes",
    "tool_input_unmeasured",
    "tool_output_characters",
    "tool_output_utf8_bytes",
    "tool_output_unmeasured",
    "snapshot_output_characters",
    "snapshot_output_utf8_bytes",
    "snapshot_output_unmeasured",
    "model_images",
    "model_image_data_url_characters",
    "model_image_data_url_utf8_bytes",
    "model_images_unmeasured",
  ]);
  exactKeys(metrics.tokens, [
    "input",
    "output",
    "total",
    "availability",
    "source",
    "tokenizer",
  ]);
  if (typeof metrics.saturated !== "boolean") {
    throw new Error("Compact session metrics saturation flag is invalid.");
  }
  for (const value of [
    metrics.commands.total,
    metrics.commands.succeeded,
    metrics.commands.failed,
    metrics.commands.snapshots,
    metrics.commands.retries,
    metrics.commands.unclassified_actions,
    metrics.commands.unclassified_retries,
    metrics.commands.approvals?.requested,
    metrics.commands.approvals?.approved,
    metrics.commands.approvals?.denied,
    ...Object.values(metrics.payloads),
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(
        "Compact session metric counters must be bounded integers.",
      );
    }
  }
  if (
    typeof metrics.commands.duration_ms !== "number" ||
    !Number.isFinite(metrics.commands.duration_ms) ||
    metrics.commands.duration_ms < 0 ||
    metrics.commands.duration_ms > Number.MAX_SAFE_INTEGER
  ) {
    throw new Error("Compact session metric duration is invalid.");
  }
  if (
    metrics.commands.succeeded + metrics.commands.failed !==
      metrics.commands.total ||
    metrics.commands.snapshots > metrics.commands.total ||
    metrics.commands.unclassified_actions > metrics.commands.total ||
    metrics.commands.approvals.approved + metrics.commands.approvals.denied !==
      metrics.commands.approvals.requested ||
    metrics.commands.approvals.requested > metrics.commands.total ||
    metrics.payloads.tool_input_utf8_bytes <
      metrics.payloads.tool_input_characters ||
    metrics.payloads.tool_output_utf8_bytes <
      metrics.payloads.tool_output_characters ||
    metrics.payloads.snapshot_output_characters >
      metrics.payloads.tool_output_characters ||
    metrics.payloads.snapshot_output_utf8_bytes >
      metrics.payloads.tool_output_utf8_bytes ||
    metrics.payloads.model_image_data_url_utf8_bytes <
      metrics.payloads.model_image_data_url_characters ||
    stableJson(metrics.tokens) !==
      stableJson({
        input: null,
        output: null,
        total: null,
        availability: "unavailable",
        source: null,
        tokenizer: null,
      })
  ) {
    throw new Error("Compact session metric totals are inconsistent.");
  }
}

function validateAttempt(attempt, repetition) {
  if (
    !isObject(attempt) ||
    attempt.repetition !== repetition ||
    attempt.session !== `metrics-${repetition}` ||
    !["verified", "failed"].includes(attempt.precondition?.status)
  ) {
    throw new Error("Session metrics attempt identity is invalid.");
  }
  exactKeys(attempt, [
    "repetition",
    "session",
    "precondition",
    "browser",
    "cold_start",
    "readiness",
    "warm_resume",
    "teardown",
    "final_session_metrics",
  ]);
  if (!isObject(attempt.precondition)) {
    throw new Error("Session metrics precondition is invalid.");
  }
  exactKeys(attempt.precondition, ["status", "reason"]);
  if (!shortString(attempt.precondition.reason, maxFailureReasonLength)) {
    throw new Error("Session metrics precondition reason is invalid.");
  }
  validatePhase(attempt.cold_start, "cold_start");
  validateAuxiliary(attempt.readiness, "readiness");
  validatePhase(attempt.warm_resume, "warm_resume");
  validateAuxiliary(attempt.teardown, "teardown");
  if (attempt.browser !== null) {
    exactKeys(attempt.browser, ["name", "version", "headless"]);
    if (
      attempt.browser.name !== "chromium" ||
      !shortString(attempt.browser.version, 128) ||
      attempt.browser.headless !== true
    ) {
      throw new Error("Session metrics browser evidence is invalid.");
    }
  }
  if (attempt.final_session_metrics !== null) {
    validateCompactMetrics(attempt.final_session_metrics);
  }
}

function validatePhase(phase, name) {
  if (
    !isObject(phase) ||
    phase.phase !== name ||
    !["collected", "failed", "not_run"].includes(phase.status) ||
    !shortString(phase.reason, maxFailureReasonLength) ||
    (phase.duration_ms !== null &&
      (!Number.isFinite(phase.duration_ms) ||
        phase.duration_ms < 0 ||
        phase.duration_ms > 600_000))
  ) {
    throw new Error(`Session metrics ${name} phase is invalid.`);
  }
  exactKeys(phase, [
    "phase",
    "status",
    "started_at",
    "duration_ms",
    "failure_class",
    "reason",
    "metrics",
  ]);
  if (phase.started_at !== null && !validIsoDate(phase.started_at)) {
    throw new Error(`Session metrics ${name} timestamp is invalid.`);
  }
  if (phase.status === "collected") {
    if (
      phase.failure_class !== null ||
      phase.duration_ms === null ||
      phase.metrics === null
    ) {
      throw new Error(`Collected ${name} phase must retain metrics.`);
    }
    validateCompactMetrics(phase.metrics);
    if (
      phase.metrics.commands.total !== 2 ||
      phase.metrics.commands.snapshots !== 1 ||
      phase.metrics.commands.unclassified_actions !== 0 ||
      phase.metrics.commands.unclassified_retries !== 0
    ) {
      throw new Error(
        `${name} must retain the identical two-command workflow.`,
      );
    }
  } else if (
    phase.status === "failed" &&
    !["environment", "harness"].includes(phase.failure_class)
  ) {
    throw new Error(`Failed ${name} phase needs a failure class.`);
  } else if (phase.status === "not_run" && phase.failure_class !== null) {
    throw new Error(`Unrun ${name} phase cannot have a failure class.`);
  }
}

function validateAuxiliary(phase, name) {
  if (
    !isObject(phase) ||
    phase.phase !== name ||
    !["verified", "failed", "not_run"].includes(phase.status) ||
    !shortString(phase.reason, maxFailureReasonLength)
  ) {
    throw new Error(`Session metrics ${name} evidence is invalid.`);
  }
  exactKeys(phase, ["phase", "status", "failure_class", "reason"]);
  if (
    phase.status === "failed" &&
    !["environment", "harness"].includes(phase.failure_class)
  ) {
    throw new Error(`Failed ${name} evidence needs a failure class.`);
  }
  if (phase.status !== "failed" && phase.failure_class !== null) {
    throw new Error(`${name} failure class is inconsistent.`);
  }
}

function validateSummary(summary) {
  if (!isObject(summary)) {
    throw new Error("Session metrics summary is invalid.");
  }
  exactKeys(summary, [
    "requested_repetitions",
    "completed_pairs",
    "failed_pairs",
    "cold_start_ms",
    "warm_resume_ms",
    "failures",
  ]);
  if (
    summary.requested_repetitions !== 3 ||
    !Number.isSafeInteger(summary.completed_pairs) ||
    summary.completed_pairs < 0 ||
    summary.completed_pairs > 3 ||
    !Number.isSafeInteger(summary.failed_pairs) ||
    summary.failed_pairs !== 3 - summary.completed_pairs ||
    !Array.isArray(summary.failures) ||
    summary.failures.length > 15
  ) {
    throw new Error("Session metrics summary counts are invalid.");
  }
  validateDurationSummary(summary.cold_start_ms, "cold_start_ms");
  validateDurationSummary(summary.warm_resume_ms, "warm_resume_ms");
  for (const failure of summary.failures) {
    if (!isObject(failure)) {
      throw new Error("Session metrics failure evidence is invalid.");
    }
    exactKeys(failure, ["repetition", "phase", "failure_class", "reason"]);
    if (
      !Number.isSafeInteger(failure.repetition) ||
      failure.repetition < 1 ||
      failure.repetition > 3 ||
      ![
        "precondition",
        "cold_start",
        "readiness",
        "warm_resume",
        "teardown",
      ].includes(failure.phase) ||
      !["environment", "harness"].includes(failure.failure_class) ||
      !shortString(failure.reason, maxFailureReasonLength)
    ) {
      throw new Error("Session metrics failure evidence is invalid.");
    }
  }
}

function validateDurationSummary(summary, name) {
  if (!isObject(summary)) {
    throw new Error(`Session metrics ${name} summary is invalid.`);
  }
  exactKeys(summary, ["values", "median", "minimum", "maximum"]);
  if (
    !Array.isArray(summary.values) ||
    summary.values.length > 3 ||
    summary.values.some(
      (value) =>
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > 600_000,
    ) ||
    summary.values.some(
      (value, index) => index > 0 && value < summary.values[index - 1],
    )
  ) {
    throw new Error(`Session metrics ${name} values are invalid.`);
  }
  const expected = durationSummary(summary.values);
  if (stableJson(summary) !== stableJson(expected)) {
    throw new Error(`Session metrics ${name} summary is inconsistent.`);
  }
}

async function assertFreshSession(paths) {
  for (const path of Object.values(paths)) {
    try {
      await access(path);
      throw new Error(`Fresh-session path already exists: ${path}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

function sessionPaths(runtimeDirectory, session) {
  return {
    endpoint: join(runtimeDirectory, `${session}.json`),
    profile: join(runtimeDirectory, `${session}-profile`),
    downloads: join(runtimeDirectory, `${session}-downloads`),
    artifacts: join(runtimeDirectory, `${session}-artifacts`),
  };
}

function emptyPhase(phase) {
  return {
    phase,
    status: "not_run",
    started_at: null,
    duration_ms: null,
    failure_class: null,
    reason:
      "Phase was not run because a required earlier phase did not complete.",
    metrics: null,
  };
}

function emptyAuxiliary(phase) {
  return {
    phase,
    status: "not_run",
    failure_class: null,
    reason:
      "Check was not run because a required earlier phase did not complete.",
  };
}

function failedAuxiliary(phase, error, temporaryRoot) {
  const failure = classifyFailure(error, temporaryRoot);
  return {
    phase,
    status: "failed",
    failure_class: failure.failureClass,
    reason: failure.reason,
  };
}

function failPhase(phase, error, temporaryRoot) {
  const failure = classifyFailure(error, temporaryRoot);
  phase.status = "failed";
  phase.failure_class = failure.failureClass;
  phase.reason = failure.reason;
  phase.metrics = null;
}

function classifyFailure(error, temporaryRoot) {
  const reason = sanitizeError(error, temporaryRoot);
  return {
    failureClass:
      /ENOENT|executable|not found|fresh-session path|browser.*unavailable/i.test(
        reason,
      )
        ? "environment"
        : "harness",
    reason,
  };
}

function sanitizeError(error, temporaryRoot) {
  const value = error instanceof Error ? error.message : String(error);
  return (
    [...value]
      .map((character) => {
        const point = character.codePointAt(0) ?? 0;
        return point < 32 || point === 127 ? " " : character;
      })
      .join("")
      .replaceAll(temporaryRoot || "<no-temporary-root>", "<temporary>")
      .replaceAll(repositoryRoot, "<repository>")
      .replaceAll(homedir(), "<home>")
      .slice(0, maxFailureReasonLength) || "Unknown session metrics failure."
  );
}

function durationSummary(values) {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (sorted.length === 0) {
    return { values: [], median: null, minimum: null, maximum: null };
  }
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2
      ? sorted[middle]
      : Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(1));
  return {
    values: sorted,
    median,
    minimum: sorted[0],
    maximum: sorted.at(-1),
  };
}

function pairCompleted(attempt) {
  return (
    attempt.precondition.status === "verified" &&
    attempt.cold_start.status === "collected" &&
    attempt.readiness.status === "verified" &&
    attempt.warm_resume.status === "collected" &&
    attempt.teardown.status === "verified" &&
    attempt.final_session_metrics !== null
  );
}

function packageSnapshot() {
  return {
    harness_version: require("../../package.json").version,
    playwright_version: require("playwright/package.json").version,
  };
}

function sourceSnapshot() {
  try {
    const repositoryCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const status = execFileSync(
      "git",
      ["status", "--porcelain", "--untracked-files=normal"],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    return {
      repository_commit: repositoryCommit || null,
      working_tree_dirty: Boolean(status),
    };
  } catch {
    return { repository_commit: null, working_tree_dirty: null };
  }
}

function elapsed(started) {
  return Math.max(0, Number((performance.now() - started).toFixed(1)));
}

function exactKeys(value, expected) {
  if (
    stableJson(Object.keys(value).sort()) !== stableJson([...expected].sort())
  ) {
    throw new Error("Protocol fields don't match version 1.0.0.");
  }
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function validIsoDate(value) {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    Number.isFinite(Date.parse(value))
  );
}

function shortString(value, maximumLength) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength
  );
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function assertReportSize(serialized) {
  if (Buffer.byteLength(serialized, "utf8") > maxReportBytes) {
    throw new Error(
      `Session metrics report exceeds the ${maxReportBytes}-byte limit.`,
    );
  }
}
