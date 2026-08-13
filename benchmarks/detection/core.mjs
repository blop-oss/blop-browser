import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const defaultProtocolPath = fileURLToPath(
  new URL("protocol.json", import.meta.url),
);
const resultDirectory = fileURLToPath(new URL(".results", import.meta.url));
const allowedBackendIds = new Set(["chromium-headless", "camoufox-headless"]);
const maxReportBytes = 256 * 1024;
const maxFailureReasonLength = 1_000;
const protocolName = "Blop Browser local backend signal protocol";
const protocolPurpose =
  "Record bounded browser-observable signals from fresh Chromium and Camoufox sessions against a controlled loopback fixture.";
const expectedBackendConfigurations = {
  "chromium-headless": {
    headless: true,
    browser_channel: "playwright-bundled",
    viewport: { width: 1280, height: 720 },
    locale: "en-US",
    timezone_id: "UTC",
    color_scheme: "light",
    reduced_motion: "reduce",
    accept_downloads: true,
    bypass_csp: false,
    profile: "fresh-temporary-per-attempt",
  },
  "camoufox-headless": {
    headless: true,
    binary_source: "installed-camoufox-package-cache",
    browser_binary_version: "record-actual-installed",
    os: "linux",
    locale: ["en-US"],
    window: [1280, 720],
    humanize: false,
    enable_cache: false,
    accept_downloads: true,
    bypass_csp: false,
    viewport: null,
    profile: "fresh-temporary-per-attempt",
    fingerprint_generation: "camoufox-default-unseeded-per-attempt",
  },
};
const expectedLimitations = [
  "The loopback fixture records browser-observable signals; it does not reproduce a third-party site's detection logic, network reputation, TLS fingerprint, account history, or risk model.",
  "The pinned camoufox-js launch API does not expose a seed. Its generated fingerprint can vary even when the recorded constraints and actual versions are identical.",
  "A collected result means the fixture loaded and returned valid bounded evidence. It is not a pass against bot detection.",
  "A local result cannot establish anonymity, non-detectability, or permission to automate any site.",
];
const expectedProhibitedInterpretations = [
  "detection score",
  "undetectable browser",
  "bot-protection bypass",
  "site authorization",
];
const expectedSignalKeys = [
  "webdriver",
  "user_agent",
  "user_agent_contains_headless",
  "browser_family",
  "platform",
  "language",
  "languages",
  "timezone",
  "hardware_concurrency",
  "device_memory",
  "plugin_count",
  "mime_type_count",
  "screen",
  "window",
  "webgl",
];

export async function loadDetectionProtocol(
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
  if (
    stableJson(Object.keys(protocol).sort()) !==
    stableJson(
      [
        "backends",
        "limitations",
        "name",
        "prohibited_interpretations",
        "protocol_version",
        "purpose",
        "repetitions",
        "signal_contract",
        "target",
      ].sort(),
    )
  ) {
    throw new Error("Protocol fields don't match version 1.0.0.");
  }
  if (protocol.protocol_version !== "1.0.0") {
    throw new Error('Protocol version must be "1.0.0".');
  }
  if (protocol.name !== protocolName || protocol.purpose !== protocolPurpose) {
    throw new Error("Protocol identity must match version 1.0.0.");
  }
  if (protocol.repetitions !== 3) {
    throw new Error("Protocol version 1.0.0 must require three repetitions.");
  }
  if (
    stableJson(protocol.target) !==
    stableJson({
      kind: "loopback-fixture",
      host: "127.0.0.1",
      path: "/signals",
    })
  ) {
    throw new Error(
      "Protocol target must be the built-in 127.0.0.1 /signals fixture.",
    );
  }
  if (!Array.isArray(protocol.backends) || protocol.backends.length !== 2) {
    throw new Error("Protocol must define the two supported backend modes.");
  }
  const backendIds = protocol.backends.map((backend) => backend?.id);
  if (
    backendIds.some((id) => !allowedBackendIds.has(id)) ||
    new Set(backendIds).size !== allowedBackendIds.size
  ) {
    throw new Error("Protocol backend IDs are invalid or incomplete.");
  }
  for (const backend of protocol.backends) {
    const expectedIdentity =
      backend.id === "chromium-headless"
        ? { engine: "chromium", launcher: "playwright.chromium" }
        : { engine: "firefox", launcher: "camoufox-js.Camoufox" };
    if (
      stableJson(Object.keys(backend).sort()) !==
        stableJson(["configuration", "engine", "id", "launcher"]) ||
      backend.engine !== expectedIdentity.engine ||
      backend.launcher !== expectedIdentity.launcher
    ) {
      throw new Error(`Protocol identity for ${backend.id} is invalid.`);
    }
    if (
      stableJson(backend.configuration) !==
      stableJson(expectedBackendConfigurations[backend.id])
    ) {
      throw new Error(
        `Protocol configuration for ${backend.id} doesn't match version 1.0.0.`,
      );
    }
  }
  if (
    JSON.stringify(protocol.signal_contract) !==
    JSON.stringify(expectedSignalKeys)
  ) {
    throw new Error(
      "Protocol signal contract doesn't match the bounded fixture.",
    );
  }
  if (stableJson(protocol.limitations) !== stableJson(expectedLimitations)) {
    throw new Error("Protocol must publish every version 1.0.0 limitation.");
  }
  if (
    stableJson(protocol.prohibited_interpretations) !==
    stableJson(expectedProhibitedInterpretations)
  ) {
    throw new Error(
      "Protocol must retain its prohibited result interpretations.",
    );
  }
  return protocol;
}

export function assertLoopbackFixtureUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.pathname !== "/signals" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "The backend signal protocol can load only its 127.0.0.1 /signals fixture.",
    );
  }
  return url.href;
}

export async function startSignalFixture() {
  const server = createServer((request, response) => {
    const host = request.headers.host ?? "";
    if (!/^127\.0\.0\.1:\d+$/.test(host)) {
      response.writeHead(421, { "content-type": "text/plain; charset=utf-8" });
      response.end("Loopback host required.");
      return;
    }
    if (request.method !== "GET" || request.url !== "/signals") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found.");
      return;
    }
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
      "content-type": "text/html; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    });
    response.end(signalFixtureHtml());
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
  const url = assertLoopbackFixtureUrl(
    `http://127.0.0.1:${address.port}/signals`,
  );
  return {
    url,
    close: () =>
      new Promise((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      }),
  };
}

export async function collectFixtureSignals(page, fixtureUrl, backendId) {
  const url = assertLoopbackFixtureUrl(fixtureUrl);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
  const evidence = page.locator("#evidence");
  await evidence.waitFor({ state: "attached", timeout: 5_000 });
  const raw = await evidence.textContent();
  if (!raw) throw new Error("The local fixture returned no signal evidence.");
  let signals;
  try {
    signals = JSON.parse(raw);
  } catch {
    throw new Error("The local fixture returned invalid signal evidence.");
  }
  validateSignals(signals, backendId);
  return signals;
}

export function validateSignals(signals, backendId) {
  if (!isObject(signals)) throw new Error("Signals must be an object.");
  const keys = Object.keys(signals);
  if (JSON.stringify(keys) !== JSON.stringify(expectedSignalKeys)) {
    throw new Error("Signals don't match the bounded protocol contract.");
  }
  requireNullableBoolean(signals.webdriver, "webdriver");
  requireString(signals.user_agent, "user_agent", 512);
  requireNullableBoolean(
    signals.user_agent_contains_headless,
    "user_agent_contains_headless",
  );
  requireString(signals.browser_family, "browser_family", 32);
  requireString(signals.platform, "platform", 128);
  requireString(signals.language, "language", 64);
  if (
    !Array.isArray(signals.languages) ||
    signals.languages.length > 8 ||
    signals.languages.some(
      (language) => typeof language !== "string" || language.length > 64,
    )
  ) {
    throw new Error(
      "Signal languages must contain at most eight short strings.",
    );
  }
  requireString(signals.timezone, "timezone", 128);
  for (const field of [
    "hardware_concurrency",
    "device_memory",
    "plugin_count",
    "mime_type_count",
  ]) {
    requireNullableNumber(signals[field], field, 0, 1_000_000);
  }
  requireNumberObject(signals.screen, "screen", [
    "width",
    "height",
    "avail_width",
    "avail_height",
    "color_depth",
    "pixel_depth",
  ]);
  requireNumberObject(signals.window, "window", [
    "inner_width",
    "inner_height",
    "outer_width",
    "outer_height",
    "device_pixel_ratio",
  ]);
  if (!isObject(signals.webgl))
    throw new Error("Signal webgl must be an object.");
  if (typeof signals.webgl.available !== "boolean") {
    throw new Error("Signal webgl.available must be boolean.");
  }
  for (const field of ["vendor", "renderer"]) {
    if (signals.webgl[field] !== null) {
      requireString(signals.webgl[field], `webgl.${field}`, 256);
    }
  }
  const expectedFamily =
    backendId === "camoufox-headless" ? "firefox" : "chromium";
  if (signals.browser_family !== expectedFamily) {
    throw new Error(
      `Expected ${expectedFamily} signals for ${backendId}, received ${signals.browser_family}.`,
    );
  }
  return signals;
}

export async function runLocalSignalProtocol(options = {}) {
  const { protocol, sha256 } = await loadDetectionProtocol(
    options.protocolPath,
  );
  const selectedBackendIds =
    options.backendIds ?? protocol.backends.map((backend) => backend.id);
  validateSelectedBackends(selectedBackendIds);
  const selectedBackends = selectedBackendIds.map((id) =>
    protocol.backends.find((backend) => backend.id === id),
  );
  const launchers = options.launchers ?? createDefaultLaunchers();
  const collector = options.collector ?? collectFixtureSignals;
  const fixture = options.fixture ?? (await startSignalFixture());
  const temporaryRoot = await mkdtemp(join(tmpdir(), "blop-detection-"));
  const attempts = [];

  try {
    for (const backend of selectedBackends) {
      const launcher = launchers[backend.id];
      if (typeof launcher !== "function") {
        throw new Error(`No launcher is configured for ${backend.id}.`);
      }
      for (
        let repetition = 1;
        repetition <= protocol.repetitions;
        repetition += 1
      ) {
        const attemptRoot = join(temporaryRoot, `${backend.id}-${repetition}`);
        const profileDirectory = join(attemptRoot, "profile");
        const downloadsDirectory = join(attemptRoot, "downloads");
        await Promise.all([
          mkdir(profileDirectory, { recursive: true, mode: 0o700 }),
          mkdir(downloadsDirectory, { recursive: true, mode: 0o700 }),
        ]);
        const startedAt = (options.now ?? (() => new Date()))();
        const startedMonotonic = performance.now();
        let session;
        let signals = null;
        let failure = null;

        try {
          session = await launcher({
            backend,
            profileDirectory,
            downloadsDirectory,
          });
          signals = await collector(session.page, fixture.url, backend.id);
        } catch (error) {
          failure = classifyFailure(error, temporaryRoot);
        } finally {
          if (session) {
            try {
              await session.close();
            } catch (error) {
              failure ??= classifyFailure(error, temporaryRoot);
            }
          }
        }

        attempts.push({
          backend_id: backend.id,
          repetition,
          started_at: startedAt.toISOString(),
          duration_ms: Math.max(
            0,
            Math.round(performance.now() - startedMonotonic),
          ),
          outcome: failure
            ? {
                status: "failed",
                failure_class: failure.failureClass,
                reason: failure.reason,
              }
            : {
                status: "collected",
                failure_class: null,
                reason: "The loopback fixture returned valid bounded signals.",
              },
          browser: session
            ? {
                name: session.browserName,
                version: session.browserVersion,
                executable_source: session.executableSource,
              }
            : null,
          configuration: structuredClone(backend.configuration),
          signals,
        });
      }
    }
  } finally {
    if (!options.fixture) await fixture.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }

  const packageVersions = packageSnapshot();
  const report = {
    schema_version: "1.0.0",
    generated_at: (options.now ?? (() => new Date()))().toISOString(),
    source: {
      ...sourceSnapshot(),
      protocol_sha256: sha256,
      ...packageVersions,
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
        "This run loaded only the protocol's controlled 127.0.0.1 fixture.",
    },
    protocol: {
      protocol_version: protocol.protocol_version,
      name: protocol.name,
      repetitions: protocol.repetitions,
      target: structuredClone(protocol.target),
      selected_backends: selectedBackendIds,
    },
    attempts,
    summary: summarizeAttempts(attempts, selectedBackendIds),
    limitations: [...protocol.limitations],
  };
  validateReport(report);
  return report;
}

export async function writeSignalReport(report, outputPath) {
  validateReport(report);
  const resolved = assertIgnoredResultPath(outputPath);
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

export function summarizeAttempts(attempts, backendIds) {
  const backends = backendIds.map((backendId) => {
    const selected = attempts.filter(
      (attempt) => attempt.backend_id === backendId,
    );
    const failures = selected
      .filter((attempt) => attempt.outcome.status === "failed")
      .map((attempt) => ({
        repetition: attempt.repetition,
        failure_class: attempt.outcome.failure_class,
        reason: attempt.outcome.reason,
      }));
    const collectedSignals = selected
      .filter((attempt) => attempt.outcome.status === "collected")
      .map((attempt) => attempt.signals);
    return {
      backend_id: backendId,
      requested: selected.length,
      collected: selected.length - failures.length,
      failed: failures.length,
      failures,
      varying_signal_paths: varyingSignalPaths(collectedSignals),
    };
  });
  return {
    requested: attempts.length,
    collected: attempts.filter(
      (attempt) => attempt.outcome.status === "collected",
    ).length,
    failed: attempts.filter((attempt) => attempt.outcome.status === "failed")
      .length,
    backends,
  };
}

export function validateReport(report) {
  assertReportSize(JSON.stringify(report));
  if (!isObject(report) || report.schema_version !== "1.0.0") {
    throw new Error("Signal report schema version must be 1.0.0.");
  }
  if (
    !validIsoDate(report.generated_at) ||
    (report.source?.repository_commit !== null &&
      !/^[a-f0-9]{40}$/.test(report.source?.repository_commit ?? "")) ||
    ![true, false, null].includes(report.source?.working_tree_dirty) ||
    !shortString(report.source?.harness_version, 64) ||
    !shortString(report.source?.playwright_version, 64) ||
    !shortString(report.source?.camoufox_js_version, 64) ||
    !shortString(report.environment?.node_version, 64) ||
    !shortString(report.environment?.platform, 64) ||
    !shortString(report.environment?.architecture, 64) ||
    report.environment?.hostname !== "redacted"
  ) {
    throw new Error(
      "Signal report source and environment metadata are invalid.",
    );
  }
  if (
    report.authorization?.target_scope !== "loopback-only" ||
    report.authorization?.third_party_sites !== false ||
    report.authorization?.statement !==
      "This run loaded only the protocol's controlled 127.0.0.1 fixture."
  ) {
    throw new Error(
      "Signal report must retain the loopback-only authorization scope.",
    );
  }
  if (!/^[a-f0-9]{64}$/.test(report.source?.protocol_sha256 ?? "")) {
    throw new Error("Signal report must contain the protocol SHA-256.");
  }
  if (!Array.isArray(report.attempts)) {
    throw new Error("Signal report attempts must be an array.");
  }
  if (
    report.protocol?.protocol_version !== "1.0.0" ||
    report.protocol?.name !== protocolName ||
    report.protocol?.repetitions !== 3 ||
    stableJson(report.protocol?.target) !==
      stableJson({
        kind: "loopback-fixture",
        host: "127.0.0.1",
        path: "/signals",
      })
  ) {
    throw new Error("Signal report must retain protocol version 1.0.0.");
  }
  validateSelectedBackends(report.protocol.selected_backends);
  const expectedAttempts =
    report.protocol?.repetitions * report.protocol?.selected_backends?.length;
  if (
    !Number.isInteger(expectedAttempts) ||
    expectedAttempts < 3 ||
    report.attempts.length !== expectedAttempts
  ) {
    throw new Error("Signal report must retain every requested attempt.");
  }
  for (const attempt of report.attempts) {
    if (!allowedBackendIds.has(attempt.backend_id)) {
      throw new Error("Signal report contains an unknown backend.");
    }
    if (
      stableJson(attempt.configuration) !==
      stableJson(expectedBackendConfigurations[attempt.backend_id])
    ) {
      throw new Error(
        `Signal report configuration for ${attempt.backend_id} doesn't match the protocol.`,
      );
    }
    if (
      !Number.isInteger(attempt.repetition) ||
      attempt.repetition < 1 ||
      attempt.repetition > report.protocol.repetitions ||
      !Number.isInteger(attempt.duration_ms) ||
      attempt.duration_ms < 0 ||
      attempt.duration_ms > 600_000 ||
      !validIsoDate(attempt.started_at)
    ) {
      throw new Error("Signal report attempt metadata must remain bounded.");
    }
    if (
      typeof attempt.outcome?.reason !== "string" ||
      attempt.outcome.reason.length < 1 ||
      attempt.outcome.reason.length > maxFailureReasonLength
    ) {
      throw new Error("Signal report outcome reasons must be bounded strings.");
    }
    if (attempt.outcome?.status === "collected") {
      if (
        attempt.outcome.failure_class !== null ||
        attempt.browser === null ||
        attempt.signals === null
      ) {
        throw new Error(
          "Collected attempts require browser evidence, signals, and no failure class.",
        );
      }
    } else if (
      attempt.outcome?.status !== "failed" ||
      !["environment", "harness"].includes(attempt.outcome?.failure_class)
    ) {
      throw new Error("Failed attempts must retain an allowed failure class.");
    }
    if (attempt.browser !== null) {
      validateBrowserEvidence(attempt.browser, attempt.backend_id);
    }
    if (attempt.signals !== null) {
      validateSignals(attempt.signals, attempt.backend_id);
    }
  }
  for (const backendId of report.protocol.selected_backends) {
    const repetitions = report.attempts
      .filter((attempt) => attempt.backend_id === backendId)
      .map((attempt) => attempt.repetition)
      .sort((left, right) => left - right);
    if (stableJson(repetitions) !== stableJson([1, 2, 3])) {
      throw new Error(
        `Signal report must retain repetitions 1, 2, and 3 for ${backendId}.`,
      );
    }
  }
  if (
    report.summary?.requested !== report.attempts.length ||
    report.summary?.collected + report.summary?.failed !==
      report.attempts.length
  ) {
    throw new Error("Signal report summary doesn't cover every attempt.");
  }
  if (stableJson(report.limitations) !== stableJson(expectedLimitations)) {
    throw new Error("Signal report must retain material limitations.");
  }
  if (
    !Array.isArray(report.summary?.backends) ||
    report.summary.backends.length !== report.protocol.selected_backends.length
  ) {
    throw new Error("Signal report must summarize every selected backend.");
  }
  for (const backend of report.summary.backends) {
    if (
      !allowedBackendIds.has(backend.backend_id) ||
      backend.requested !== report.protocol.repetitions ||
      backend.failures?.length !== backend.failed ||
      backend.failures?.length > report.protocol.repetitions ||
      backend.varying_signal_paths?.length > 64
    ) {
      throw new Error(
        "Signal report backend summaries must remain bounded and complete.",
      );
    }
    for (const failure of backend.failures) {
      if (
        !Number.isInteger(failure.repetition) ||
        failure.repetition < 1 ||
        failure.repetition > report.protocol.repetitions ||
        !["environment", "harness"].includes(failure.failure_class) ||
        typeof failure.reason !== "string" ||
        failure.reason.length < 1 ||
        failure.reason.length > maxFailureReasonLength
      ) {
        throw new Error("Signal report summary failures must remain bounded.");
      }
    }
  }
  if (
    stableJson(report.summary) !==
    stableJson(
      summarizeAttempts(report.attempts, report.protocol.selected_backends),
    )
  ) {
    throw new Error("Signal report summary must match the retained attempts.");
  }
  return report;
}

export function assertIgnoredResultPath(value) {
  const resolved = resolve(value);
  const pathFromResultDirectory = relative(resultDirectory, resolved);
  if (
    !pathFromResultDirectory ||
    pathFromResultDirectory.startsWith("..") ||
    resolve(resultDirectory, pathFromResultDirectory) !== resolved ||
    !resolved.endsWith(".json")
  ) {
    throw new Error(
      "Detection reports must use a .json path inside benchmarks/detection/.results/.",
    );
  }
  return resolved;
}

function createDefaultLaunchers() {
  return {
    "chromium-headless": launchChromium,
    "camoufox-headless": launchCamoufox,
  };
}

async function launchChromium({
  backend,
  profileDirectory,
  downloadsDirectory,
}) {
  const executablePath = chromium.executablePath();
  await access(executablePath);
  const config = backend.configuration;
  const context = await chromium.launchPersistentContext(profileDirectory, {
    executablePath,
    headless: config.headless,
    viewport: config.viewport,
    locale: config.locale,
    timezoneId: config.timezone_id,
    colorScheme: config.color_scheme,
    reducedMotion: config.reduced_motion,
    acceptDownloads: config.accept_downloads,
    downloadsPath: downloadsDirectory,
    bypassCSP: config.bypass_csp,
  });
  const page = context.pages().at(-1) ?? (await context.newPage());
  return {
    page,
    browserName: "Playwright Chromium",
    browserVersion: context.browser()?.version() ?? null,
    executableSource: "playwright-bundled",
    close: () => context.close(),
  };
}

async function launchCamoufox({
  backend,
  profileDirectory,
  downloadsDirectory,
}) {
  if (process.platform !== "linux") {
    throw new Error("This pinned Camoufox protocol requires a Linux host.");
  }
  const [{ Camoufox }, packageManager] = await Promise.all([
    import("camoufox-js"),
    import("camoufox-js/dist/pkgman.js"),
  ]);
  const installDirectory = packageManager.camoufoxPath(false).toString();
  const executablePath = join(installDirectory, "camoufox-bin");
  await access(executablePath);
  const config = backend.configuration;
  const context = await Camoufox({
    executable_path: executablePath,
    headless: config.headless,
    os: config.os,
    locale: config.locale,
    window: config.window,
    humanize: config.humanize,
    enable_cache: config.enable_cache,
    user_data_dir: profileDirectory,
    downloadsPath: downloadsDirectory,
    acceptDownloads: config.accept_downloads,
    bypassCSP: config.bypass_csp,
    viewport: config.viewport,
  });
  const page = context.pages().at(-1) ?? (await context.newPage());
  return {
    page,
    browserName: "Camoufox",
    browserVersion:
      context.browser()?.version() ?? packageManager.installedVerStr(),
    executableSource: "installed-camoufox-package-cache",
    close: () => context.close(),
  };
}

function validateSelectedBackends(backendIds) {
  if (
    !Array.isArray(backendIds) ||
    backendIds.length < 1 ||
    new Set(backendIds).size !== backendIds.length ||
    backendIds.some((id) => !allowedBackendIds.has(id))
  ) {
    throw new Error(
      "Selected backends must be unique chromium-headless or camoufox-headless IDs.",
    );
  }
}

function packageSnapshot() {
  const harnessPackage = require("../../package.json");
  const playwrightPackage = require("playwright/package.json");
  const camoufoxPackage = require("camoufox-js/package.json");
  return {
    harness_version: harnessPackage.version,
    playwright_version: playwrightPackage.version,
    camoufox_js_version: camoufoxPackage.version,
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

function classifyFailure(error, temporaryRoot) {
  const reason = sanitizeError(error, temporaryRoot);
  return {
    failureClass:
      /executable|not (?:found|installed)|requires a Linux host|ENOENT/i.test(
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
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint < 32 || codePoint === 127 ? " " : character;
      })
      .join("")
      .replaceAll(temporaryRoot, "<temporary>")
      .replaceAll(repositoryRoot, "<repository>")
      .replaceAll(homedir(), "<home>")
      .slice(0, maxFailureReasonLength) || "Unknown backend failure."
  );
}

function varyingSignalPaths(signals) {
  if (signals.length < 2) return [];
  const flattened = signals.map((entry) => flatten(entry));
  const paths = new Set(flattened.flatMap((entry) => Object.keys(entry)));
  return [...paths]
    .filter((path) => {
      const values = flattened.map((entry) => JSON.stringify(entry[path]));
      return new Set(values).size > 1;
    })
    .sort()
    .slice(0, 64);
}

function flatten(value, prefix = "", output = {}) {
  if (Array.isArray(value) || value === null || typeof value !== "object") {
    output[prefix] = value;
    return output;
  }
  for (const [key, child] of Object.entries(value)) {
    flatten(child, prefix ? `${prefix}.${key}` : key, output);
  }
  return output;
}

function signalFixtureHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Local backend signal fixture</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem; max-width: 50rem; }
      pre { white-space: pre-wrap; overflow-wrap: anywhere; }
    </style>
  </head>
  <body>
    <main>
      <h1>Local backend signal fixture</h1>
      <p>This controlled page records bounded browser-observable evidence.</p>
      <pre id="evidence" aria-live="polite"></pre>
    </main>
    <script>
      (() => {
        const numberOrNull = (value) => Number.isFinite(value) ? value : null;
        const text = (value, limit) => String(value ?? "").slice(0, limit);
        const userAgent = text(navigator.userAgent, 512);
        const browserFamily = /Firefox\\//i.test(userAgent)
          ? "firefox"
          : /(?:Chrome|Chromium)\\//i.test(userAgent)
            ? "chromium"
            : "unknown";
        let webgl = { available: false, vendor: null, renderer: null };
        try {
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
          if (context) {
            webgl = {
              available: true,
              vendor: text(context.getParameter(context.VENDOR), 256),
              renderer: text(context.getParameter(context.RENDERER), 256),
            };
          }
        } catch {}
        const signals = {
          webdriver: typeof navigator.webdriver === "boolean" ? navigator.webdriver : null,
          user_agent: userAgent,
          user_agent_contains_headless: /Headless/i.test(userAgent),
          browser_family: browserFamily,
          platform: text(navigator.platform, 128),
          language: text(navigator.language, 64),
          languages: Array.from(navigator.languages ?? []).slice(0, 8).map((value) => text(value, 64)),
          timezone: text(Intl.DateTimeFormat().resolvedOptions().timeZone, 128),
          hardware_concurrency: numberOrNull(navigator.hardwareConcurrency),
          device_memory: numberOrNull(navigator.deviceMemory),
          plugin_count: numberOrNull(navigator.plugins?.length),
          mime_type_count: numberOrNull(navigator.mimeTypes?.length),
          screen: {
            width: numberOrNull(screen.width),
            height: numberOrNull(screen.height),
            avail_width: numberOrNull(screen.availWidth),
            avail_height: numberOrNull(screen.availHeight),
            color_depth: numberOrNull(screen.colorDepth),
            pixel_depth: numberOrNull(screen.pixelDepth),
          },
          window: {
            inner_width: numberOrNull(innerWidth),
            inner_height: numberOrNull(innerHeight),
            outer_width: numberOrNull(outerWidth),
            outer_height: numberOrNull(outerHeight),
            device_pixel_ratio: numberOrNull(devicePixelRatio),
          },
          webgl,
        };
        document.querySelector("#evidence").textContent = JSON.stringify(signals);
      })();
    </script>
  </body>
</html>`;
}

function requireNumberObject(value, name, keys) {
  if (
    !isObject(value) ||
    JSON.stringify(Object.keys(value)) !== JSON.stringify(keys)
  ) {
    throw new Error(`Signal ${name} doesn't match the bounded contract.`);
  }
  for (const key of keys) {
    requireNullableNumber(value[key], `${name}.${key}`, 0, 1_000_000);
  }
}

function requireNullableNumber(value, name, minimum, maximum) {
  if (
    value !== null &&
    (typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < minimum ||
      value > maximum)
  ) {
    throw new Error(`Signal ${name} must be a bounded number or null.`);
  }
}

function requireNullableBoolean(value, name) {
  if (value !== null && typeof value !== "boolean") {
    throw new Error(`Signal ${name} must be boolean or null.`);
  }
}

function requireString(value, name, maximumLength) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength
  ) {
    throw new Error(`Signal ${name} must be a bounded non-empty string.`);
  }
}

function validateBrowserEvidence(browser, backendId) {
  if (!isObject(browser)) {
    throw new Error("Collected attempts must record browser evidence.");
  }
  const expected =
    backendId === "camoufox-headless"
      ? {
          name: "Camoufox",
          executableSource: "installed-camoufox-package-cache",
        }
      : {
          name: "Playwright Chromium",
          executableSource: "playwright-bundled",
        };
  if (
    stableJson(Object.keys(browser).sort()) !==
      stableJson(["executable_source", "name", "version"]) ||
    browser.name !== expected.name ||
    browser.executable_source !== expected.executableSource
  ) {
    throw new Error(`Browser evidence for ${backendId} is invalid.`);
  }
  requireString(browser.version, "browser.version", 128);
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

function assertReportSize(serialized) {
  if (Buffer.byteLength(serialized, "utf8") > maxReportBytes) {
    throw new Error(`Signal report exceeds the ${maxReportBytes}-byte limit.`);
  }
}
