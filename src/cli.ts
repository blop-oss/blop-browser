#!/usr/bin/env node
import { closeSync, openSync, realpathSync } from "node:fs";
import { access, chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  daemonIsHealthy,
  errorResponse,
  ensureRuntimeDirectory,
  okResponse,
  pathsForSession,
  readEndpoint,
  removeEndpoint,
  requestDaemon,
  startRpcServer,
  validateSessionName,
  type DaemonEndpoint,
  type RpcMethod,
  type RpcResponse,
  type RpcServer,
} from "./cli/ipc.js";
import {
  createHarnessCliRuntime,
  resolveBrowserExecutable,
  resolveCamoufoxExecutable,
  type BrowserName,
  type HarnessCliRuntime,
} from "./cli/runtime.js";
import { readPersistedCliTrace } from "./cli/trace-store.js";
import { readPersistedCliMetrics } from "./cli/metrics-store.js";
import {
  listRetainedSessionData,
  preservedRetainedData,
} from "./cli/data-store.js";
import { getBrowserSessionScope, type BrowserProfileMode } from "./session/scope.js";
import {
  createTraceRecorder,
  formatTraceTimeline,
  type HarnessTraceExport,
} from "./trace-recorder.js";
import { emptySessionMetrics } from "./session-metrics.js";
import type { ToolContentBoundary } from "./types.js";
import { BrowserSafetyError, BrowserToolError } from "./tools/safety.js";
import {
  createCliSessionPrivacySummary,
  displayCdpEndpoint,
  identifyCdpEndpoint,
  type CliSessionPrivacySummary,
} from "./cli/privacy.js";
import { BrowserControlError } from "./session/control.js";
import {
  cacheIsFresh,
  createPackageUpdateReport,
  formatUpdateAvailableMessage,
  formatUpdatePrompt,
  harnessPackageVersion,
  packageUpdateCachePath,
  packageUpdateScriptPath,
  readPackageUpdateCache,
  shouldOfferUpdateCheck,
  shouldPromptForCachedUpdate,
  writePackageUpdateCache,
  type PackageUpdateReport,
} from "./cli/update.js";
import {
  installSkills,
  packageSkillPath,
  refreshInstalledSkills,
  SKILL_SCOPES,
  SKILL_TARGETS,
  type SkillScope,
  type SkillTarget,
} from "./cli/skill.js";

const HELP = `Blop Browser — browser infrastructure for coding agents

Package: @blopai/browser-harness

Usage:
  blop-browser [--session NAME] [--browser chromium|camoufox] open URL [--json]
  blop-browser [--session NAME] snapshot [--json]
  blop-browser [--session NAME] click REF_OR_TARGET [--json]
  blop-browser [--session NAME] type REF_OR_TARGET TEXT [--submit] [--json]
  blop-browser [--session NAME] expect-text TEXT [--json]
  blop-browser [--session NAME] screenshot [NAME] [--full-page] [--json]
  blop-browser [--session NAME] finish passed|failed REASON [--json]
  blop-browser [--session NAME] call TOOL --input JSON [--json]
  blop-browser [--session NAME] tools [--json]
  blop-browser [--session NAME] describe TOOL [--json]
  blop-browser [--session NAME] status [--json]
  blop-browser [--session NAME] takeover request challenge|sensitive-step|other [--message TEXT] [--json]
  blop-browser [--session NAME] takeover control REQUEST_ID [--json]
  blop-browser [--session NAME] takeover resume REQUEST_ID LEASE_ID [--outcome completed|cancelled] [--json]
  blop-browser [--session NAME] trace [--json]
  blop-browser [--session NAME] metrics [--json]
  blop-browser [--session NAME] close [--json]
  blop-browser [--session NAME] destroy [--json]
  blop-browser data list [--json]
  blop-browser data delete SESSION [--json]
  blop-browser skill show
  blop-browser skill install --target agents|claude|opencode|all [--scope project|user]
  blop-browser config [--mode MODE] [--anti-bot on|off] [--json]
  blop-browser install camoufox [--json]
  blop-browser update [--install] [--json]
  blop-browser doctor [--json]

Global options:
  --session NAME                 Select a named managed browser session
  --browser chromium|camoufox   Select the browser for a new session
  --cdp-endpoint URL            Connect to a running Chrome over CDP
  --attach-existing             Explicitly allow access to an existing CDP profile
  --profile persistent|disposable
                                 Keep managed state until destroy, or remove it on close
  --telemetry off               First-party harness telemetry is disabled
  --headless                    Run a new managed browser without a window
  --headed                      Run a new managed browser with a window
  --anti-bot [on|off]           Optional Camoufox fingerprinting; off by default
  --json                         Print a machine-readable response envelope

The first tool call starts a persistent local daemon. Later invocations with the
same session name reuse its Playwright browser and semantic element references.

Configuration modes:
  chromium-headless | chromium-headed | chrome-cdp
  camoufox-headless | camoufox-headed
`;

type ParsedArgs = {
  session: string;
  browser: BrowserName;
  cdpEndpoint?: string;
  attachExisting: boolean;
  profileMode: BrowserProfileMode;
  requestedProfileMode?: BrowserProfileMode;
  connection?: "launch" | "cdp";
  headless: boolean;
  json: boolean;
  telemetry: "off";
  antiBot: AntiBotMode;
  requestedAntiBot?: AntiBotMode;
  command: string;
  rest: string[];
};

const INSTALL_MODES = [
  "chromium-headless",
  "chromium-headed",
  "chrome-cdp",
  "camoufox-headless",
  "camoufox-headed",
] as const;

type InstallMode = typeof INSTALL_MODES[number];
type AntiBotMode = "off" | "on";

type BrowserConfig = {
  version: 1;
  mode: InstallMode;
  cdpEndpoint?: string;
  telemetry: "off";
  antiBot: AntiBotMode;
};

export async function main(argv = process.argv.slice(2)) {
  const configPath = browserConfigPath();
  let config = await readBrowserConfig(configPath);
  let parsed = parseArgs(argv, config);
  delete process.env.BLOP_BROWSER_DAEMON_CDP_ENDPOINT;
  if (shouldRunFirstConfig({
    argv,
    command: parsed.command,
    configured: Boolean(config),
    json: parsed.json,
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  })) {
    await runConfigCommand({ ...parsed, command: "config", rest: [] }, configPath, config);
    config = await readBrowserConfig(configPath);
    parsed = parseArgs(argv, config);
  }
  if (shouldOfferUpdateCheck({
    command: parsed.command,
    json: parsed.json,
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  })) {
    await maybePromptForPackageUpdate(configPath, parsed.json);
  }
  process.env.BLOP_BROWSER_HEADLESS = parsed.headless ? "1" : "0";
  if (parsed.command === "_daemon") {
    if (parsed.cdpEndpoint && !parsed.attachExisting) {
      throw new Error("Internal CDP startup requires --attach-existing.");
    }
    await runDaemon(parsed.session, parsed.browser, parsed.cdpEndpoint, parsed.profileMode);
    return;
  }
  if (!parsed.command || parsed.command === "help" || parsed.command === "--help" || parsed.command === "-h") {
    process.stdout.write(HELP);
    return;
  }

  if (parsed.command === "skill") {
    await runSkillCommand(parsed.rest, parsed.json);
    return;
  }

  if (parsed.command === "config") {
    await runConfigCommand(parsed, configPath, config);
    return;
  }

  if (parsed.command === "update") {
    await runUpdateCommand(parsed, configPath);
    return;
  }

  if (parsed.command === "install") {
    if (parsed.rest[0] !== "camoufox") throw new Error("Usage: blop-browser install camoufox");
    const executablePath = await installCamoufox();
    printResponse(okResponse("install", {
      browser: "camoufox",
      installed: true,
      executablePath,
    }), parsed.json);
    return;
  }

  if (parsed.command === "data") {
    const action = parsed.rest[0];
    if (action === "list") {
      if (parsed.rest.length !== 1) {
        throw new Error("Usage: blop-browser data list");
      }
      printResponse(okResponse("data-list", await listRetainedSessionData(
        pathsForSession(parsed.session).directory,
        configPath,
      )), parsed.json);
      return;
    }
    if (action === "delete") {
      const targetSession = parsed.rest[1];
      if (!targetSession || parsed.rest.length !== 2) {
        throw new Error("Usage: blop-browser data delete SESSION");
      }
      validateSessionName(targetSession);
      const response = await destroySessionState(targetSession);
      printResponse(response, parsed.json);
      if (!response.ok) process.exitCode = 1;
      return;
    }
    throw new Error("Usage: blop-browser data list | data delete SESSION");
  }

  if (parsed.command === "doctor") {
    const [chromiumPath, camoufoxPath] = await Promise.all([
      resolveBrowserExecutable(),
      resolveCamoufoxExecutable(),
    ]);
    const executablePath = parsed.browser === "camoufox" ? camoufoxPath : chromiumPath;
    const endpoint = await readEndpoint(parsed.session);
    const active = Boolean(endpoint && await daemonIsHealthy(endpoint));
    const sessionScope = getBrowserSessionScope(parsed.session, {
      runtimeDirectory: pathsForSession(parsed.session).directory,
      existingProfile: parsed.connection === "cdp",
      profileMode: parsed.profileMode,
    });
    printResponse(okResponse("doctor", {
      package: {
        name: "@blopai/browser-harness",
        version: harnessPackageVersion(),
        updateCommand: "blop-browser update",
      },
      browser: {
        name: parsed.browser,
        connection: parsed.connection ?? "launch",
        available: parsed.connection === "cdp" || Boolean(executablePath),
        executablePath: executablePath ?? null,
        headless: parsed.connection === "cdp" ? null : process.env.BLOP_BROWSER_HEADLESS !== "0",
        cdpEndpoint: parsed.cdpEndpoint ?? null,
        antiBot: parsed.antiBot,
      },
      browsers: {
        chromium: { available: Boolean(chromiumPath), executablePath: chromiumPath ?? null },
        camoufox: { available: Boolean(camoufoxPath), executablePath: camoufoxPath ?? null },
      },
      daemon: {
        session: parsed.session,
        active,
        pid: active ? endpoint?.pid : null,
      },
      configuration: {
        path: configPath,
        mode: config?.mode ?? null,
        telemetry: parsed.telemetry,
        antiBot: parsed.antiBot,
      },
      runtimeDirectory: pathsForSession(parsed.session).directory,
      sessionScope,
      privacy: createCliSessionPrivacySummary(
        parsed.session,
        sessionScope,
        parsed.cdpEndpoint,
      ),
    }), parsed.json);
    return;
  }

  let response: RpcResponse;
  if (parsed.command === "status") {
    response = await requestWithoutStarting(
      parsed.session,
      "status",
      parsed.profileMode,
      parsed.cdpEndpoint,
    );
  } else if (parsed.command === "trace") {
    response = await requestWithoutStarting(parsed.session, "export_trace", parsed.profileMode);
  } else if (parsed.command === "metrics") {
    response = await requestWithoutStarting(parsed.session, "export_metrics", parsed.profileMode);
  } else if (parsed.command === "close") {
    response = await closeSessionState(parsed.session);
  } else if (parsed.command === "destroy") {
    response = await destroySessionState(parsed.session);
  } else if (parsed.command === "takeover") {
    response = await runTakeoverCommand(parsed);
  } else if (parsed.command === "call") {
    const name = parsed.rest[0];
    if (!name) throw new Error("Usage: blop-browser call TOOL --input JSON");
    const rawInput = optionValue(parsed.rest.slice(1), "--input") ?? "{}";
    const input = parseObject(rawInput, "--input");
    const daemon = await ensureDaemon(parsed);
    response = await requestStartedDaemon(daemon, "call_tool", { name, input }, parsed.json);
  } else if (parsed.command === "tools") {
    const daemon = await ensureDaemon(parsed);
    response = await requestStartedDaemon(daemon, "list_tools", {}, parsed.json);
  } else if (parsed.command === "describe") {
    const name = parsed.rest[0];
    if (!name) throw new Error("Usage: blop-browser describe TOOL");
    const daemon = await ensureDaemon(parsed);
    response = await requestStartedDaemon(daemon, "describe_tool", { name }, parsed.json);
  } else {
    const shortcut = shortcutCall(parsed.command, parsed.rest);
    if (!shortcut) throw new Error(`Unknown command "${parsed.command}". Run blop-browser --help.`);
    const daemon = await ensureDaemon(parsed);
    response = await requestStartedDaemon(daemon, "call_tool", shortcut, parsed.json);
  }
  if (parsed.command === "trace" && !parsed.json) printTraceResponse(response);
  else printResponse(response, parsed.json);
  if (!response.ok) process.exitCode = 1;
}

async function runTakeoverCommand(parsed: ParsedArgs): Promise<RpcResponse> {
  const operation = parsed.rest[0];
  const endpoint = await activeDaemon(parsed.session);
  if (operation === "request") {
    const reason = parsed.rest[1];
    if (reason !== "challenge" && reason !== "sensitive-step" && reason !== "other") {
      throw new Error("Usage: blop-browser takeover request challenge|sensitive-step|other [--message TEXT]");
    }
    return await requestDaemon(endpoint, "request_takeover", {
      reason,
      ...(optionValue(parsed.rest.slice(2), "--message") !== undefined
        ? { message: optionValue(parsed.rest.slice(2), "--message") }
        : {}),
    });
  }
  if (operation === "control") {
    const requestId = parsed.rest[1];
    if (!requestId) throw new Error("Usage: blop-browser takeover control REQUEST_ID");
    return await requestDaemon(endpoint, "take_control", { requestId });
  }
  if (operation === "resume") {
    const requestId = parsed.rest[1];
    const leaseId = parsed.rest[2];
    if (!requestId || !leaseId) {
      throw new Error("Usage: blop-browser takeover resume REQUEST_ID LEASE_ID [--outcome completed|cancelled]");
    }
    const outcome = optionValue(parsed.rest.slice(3), "--outcome");
    if (outcome !== undefined && outcome !== "completed" && outcome !== "cancelled") {
      throw new Error("--outcome must be completed or cancelled.");
    }
    return await requestDaemon(endpoint, "resume_automation", {
      requestId,
      leaseId,
      ...(outcome ? { outcome } : {}),
    });
  }
  throw new Error("Usage: blop-browser takeover request|control|resume ...");
}

async function activeDaemon(session: string) {
  const endpoint = await readEndpoint(session);
  if (!endpoint || !await daemonIsHealthy(endpoint)) {
    if (endpoint) await removeEndpoint(session);
    throw new Error("Human takeover requires an active browser session. Start or attach the browser first.");
  }
  return endpoint;
}

function shortcutCall(command: string, args: string[]): { name: string; input: Record<string, unknown> } | null {
  if (command === "open") {
    if (!args[0]) throw new Error("Usage: blop-browser open URL");
    return { name: "browser_goto", input: { url: args[0] } };
  }
  if (command === "snapshot") {
    return { name: "browser_snapshot", input: parseOptionalInput(args) };
  }
  if (command === "click") {
    if (!args[0]) throw new Error("Usage: blop-browser click REF_OR_TARGET");
    return { name: "browser_click", input: { target: parseTarget(args[0]) } };
  }
  if (command === "type") {
    if (!args[0] || args[1] === undefined) throw new Error("Usage: blop-browser type REF_OR_TARGET TEXT [--submit]");
    return {
      name: "browser_type",
      input: { target: parseTarget(args[0]), text: args[1], ...(args.includes("--submit") ? { submit: true } : {}) },
    };
  }
  if (command === "expect-text") {
    if (!args[0]) throw new Error("Usage: blop-browser expect-text TEXT");
    return { name: "browser_expect_text", input: { text: args[0] } };
  }
  if (command === "screenshot") {
    const name = args.find((argument) => !argument.startsWith("--"));
    return {
      name: "browser_screenshot",
      input: { ...(name ? { name } : {}), ...(args.includes("--full-page") ? { fullPage: true } : {}) },
    };
  }
  if (command === "finish") {
    const status = args[0];
    const reason = args.slice(1).join(" ");
    if (!status || !reason) throw new Error("Usage: blop-browser finish passed|failed REASON");
    return { name: "finish_test", input: { status, reason } };
  }
  return null;
}

function parseOptionalInput(args: string[]) {
  const raw = optionValue(args, "--input");
  return raw === undefined ? {} : parseObject(raw, "--input");
}

function parseTarget(raw: string): string | Record<string, unknown> {
  if (raw.startsWith("{")) return parseObject(raw, "target");
  if (/^(?:f\d+)?e\d+$|^x\d+$/.test(raw)) return { ref: raw };
  return raw;
}

async function runSkillCommand(args: string[], json: boolean) {
  const action = args[0] ?? "show";
  const source = packageSkillPath();
  if (action === "show") {
    const skill = await readFile(source, "utf8");
    if (json) printResponse(okResponse("skill", { content: skill }), true);
    else process.stdout.write(skill);
    return;
  }
  if (action !== "install") throw new Error("Usage: blop-browser skill show|install");

  const target = optionValue(args, "--target") ?? "all";
  const scope = optionValue(args, "--scope") ?? "project";
  if (!(SKILL_TARGETS as readonly string[]).includes(target)) {
    throw new Error("--target must be agents, claude, opencode, or all.");
  }
  if (!(SKILL_SCOPES as readonly string[]).includes(scope)) throw new Error("--scope must be project or user.");
  const installed = await installSkills({
    target: target as SkillTarget,
    scope: scope as SkillScope,
    projectDirectory: resolve(optionValue(args, "--project-dir") ?? process.cwd()),
    force: args.includes("--force"),
    source,
  });
  printResponse(okResponse("skill", { installed }), json);
}

async function runUpdateCommand(parsed: ParsedArgs, configPath: string) {
  if (parsed.rest.some((argument) => argument !== "--install")) {
    throw new Error("Usage: blop-browser update [--install] [--json]");
  }
  const install = parsed.rest.includes("--install");
  const report = await checkPackageUpdate(configPath, { force: true, persist: true });
  if (!report) {
    throw new Error("Could not check npm for a newer @blopai/browser-harness version.");
  }
  if (!report.updateAvailable) {
    printResponse(okResponse("update", {
      ...report,
      installed: false,
      skillsUpdated: [],
    }), parsed.json);
    return;
  }
  if (install || await confirmPackageUpdate(report, parsed.json)) {
    await installPackageUpdate();
    const skillsUpdated = await refreshInstalledSkills();
    printResponse(okResponse("update", {
      ...report,
      installed: true,
      skillsUpdated,
    }), parsed.json);
    return;
  }
  await rememberDeclinedUpdate(configPath, report);
  if (parsed.json) {
    printResponse(okResponse("update", {
      ...report,
      installed: false,
      skillsUpdated: [],
    }), true);
    return;
  }
  process.stdout.write(`${formatUpdateAvailableMessage(report)}\n`);
}

async function maybePromptForPackageUpdate(configPath: string, json: boolean) {
  const cachePath = packageUpdateCachePath(configPath);
  const current = harnessPackageVersion();
  const cache = await readPackageUpdateCache(cachePath);
  const report = await checkPackageUpdate(configPath, { force: false, persist: true });
  if (!report?.updateAvailable || !shouldPromptForCachedUpdate(cache, report.latest)) return;
  if (!await confirmPackageUpdate(report, json)) {
    await rememberDeclinedUpdate(configPath, report, current);
    return;
  }
  await installPackageUpdate();
  await refreshInstalledSkills();
}

async function checkPackageUpdate(
  configPath: string,
  options: { force: boolean; persist: boolean },
): Promise<PackageUpdateReport | null> {
  const cachePath = packageUpdateCachePath(configPath);
  const current = harnessPackageVersion();
  const cache = await readPackageUpdateCache(cachePath);
  if (!options.force && cache && cacheIsFresh(cache, current)) {
    return createPackageUpdateReport({
      current: cache.current,
      latest: cache.latest,
    });
  }
  try {
    const report = await runPackageUpdateCheck(current);
    if (options.persist) {
      await writePackageUpdateCache(cachePath, {
        version: 1,
        checkedAt: new Date().toISOString(),
        current: report.current,
        latest: report.latest,
        ...(cache?.declinedLatest ? { declinedLatest: cache.declinedLatest } : {}),
      });
    }
    return report;
  } catch {
    return null;
  }
}

async function rememberDeclinedUpdate(
  configPath: string,
  report: PackageUpdateReport,
  current = report.current,
) {
  const cache = await readPackageUpdateCache(packageUpdateCachePath(configPath));
  await writePackageUpdateCache(packageUpdateCachePath(configPath), {
    version: 1,
    checkedAt: cache?.checkedAt ?? new Date().toISOString(),
    current,
    latest: report.latest,
    declinedLatest: report.latest,
  });
}

async function confirmPackageUpdate(report: PackageUpdateReport, json: boolean) {
  if (json || !process.stdin.isTTY || !process.stdout.isTTY) return false;
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const confirmation = (await prompt.question(formatUpdatePrompt(report))).trim();
    return /^y(?:es)?$/i.test(confirmation);
  } finally {
    prompt.close();
  }
}

async function installPackageUpdate() {
  const updateScript = process.env.BLOP_BROWSER_UPDATE_SCRIPT ?? packageUpdateScriptPath();
  const nodeExecutable = process.env.BLOP_BROWSER_NODE_PATH ?? (process.versions.bun ? "node" : process.execPath);
  const child = spawn(nodeExecutable, [
    updateScript,
    "install",
    ...(process.env.BLOP_BROWSER_NPM_PATH ? ["--npm", process.env.BLOP_BROWSER_NPM_PATH] : []),
  ], {
    env: process.env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (exitCode !== 0) {
    throw new Error(`Package update failed with exit code ${exitCode}.`);
  }
}

async function runPackageUpdateCheck(current: string): Promise<PackageUpdateReport> {
  const updateScript = process.env.BLOP_BROWSER_UPDATE_SCRIPT ?? packageUpdateScriptPath();
  const nodeExecutable = process.env.BLOP_BROWSER_NODE_PATH ?? (process.versions.bun ? "node" : process.execPath);
  const child = spawn(nodeExecutable, [
    updateScript,
    "check",
    "--current",
    current,
    ...(process.env.BLOP_BROWSER_NPM_REGISTRY
      ? ["--registry", process.env.BLOP_BROWSER_NPM_REGISTRY]
      : []),
  ], {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    output += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    output += chunk;
  });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  const payload = output.trim().split("\n").at(-1) ?? "";
  let parsed: { ok?: boolean; error?: { message?: string } };
  try {
    parsed = JSON.parse(payload) as { ok?: boolean; error?: { message?: string } };
  } catch {
    throw new Error(payload || `Package update check failed with exit code ${exitCode}.`);
  }
  if (exitCode !== 0 || parsed.ok !== true) {
    throw new Error(parsed.error?.message ?? `Package update check failed with exit code ${exitCode}.`);
  }
  return createPackageUpdateReport({
    current: String((parsed as PackageUpdateReport).current),
    latest: String((parsed as PackageUpdateReport).latest),
    registry: (parsed as PackageUpdateReport).registry,
  });
}

async function runConfigCommand(
  parsed: ParsedArgs,
  configPath: string,
  existing: BrowserConfig | null,
) {
  const requestedMode = optionValue(parsed.rest, "--mode");
  const selection = requestedMode
    ? { mode: parseInstallMode(requestedMode), cdpEndpoint: parsed.cdpEndpoint }
    : parsed.requestedAntiBot
    ? {
      mode: modeForAntiBot(existing?.mode ?? defaultModeForAntiBot(parsed.antiBot), parsed.antiBot),
      cdpEndpoint: parsed.cdpEndpoint ?? existing?.cdpEndpoint,
    }
    : await promptForInstallMode(parsed.json);
  const antiBot = parsed.requestedAntiBot
    ?? (selection.mode.startsWith("camoufox") ? "on" : "off");
  const mode = modeForAntiBot(selection.mode, antiBot);
  const settings = settingsForMode(mode);
  const cdpEndpoint = mode === "chrome-cdp"
    ? parseCdpEndpoint(selection.cdpEndpoint ?? "http://127.0.0.1:9222")
    : undefined;

  let executablePath: string | undefined;
  let downloaded = false;
  if (settings.connection === "launch" && settings.browser === "chromium") {
    executablePath = await resolveBrowserExecutable();
    if (!executablePath) {
      throw new Error("Chrome or Chromium was not found. Install Chrome or run `npx playwright install chromium`, then retry.");
    }
  } else if (settings.browser === "camoufox") {
    executablePath = await resolveCamoufoxExecutable();
    if (!executablePath) {
      executablePath = await installCamoufox();
      downloaded = true;
    }
  }

  const config: BrowserConfig = {
    version: 1,
    mode,
    telemetry: parsed.telemetry,
    antiBot,
    ...(cdpEndpoint ? { cdpEndpoint } : {}),
  };
  await writeBrowserConfig(configPath, config);
  printResponse(okResponse("config", {
    configured: true,
    configPath,
    mode,
    browser: settings.browser,
    headless: settings.headless,
    connection: settings.connection,
    telemetry: parsed.telemetry,
    antiBot,
    ...(cdpEndpoint ? { cdpEndpoint } : {}),
    ...(executablePath ? { executablePath, downloaded } : {}),
  }), parsed.json);
}

export function shouldRunFirstConfig(input: {
  argv: string[];
  command: string;
  configured: boolean;
  json: boolean;
  interactive: boolean;
}) {
  const { argv, command, configured, json, interactive } = input;
  if (configured || json || !interactive) return false;
  if (["", "help", "--help", "-h", "config", "install", "update", "skill", "data", "doctor", "status", "trace", "metrics", "takeover", "close", "destroy", "_daemon"]
    .includes(command)) return false;
  return !["--browser", "--cdp-endpoint", "--attach-existing", "--headless", "--headed", "--anti-bot"]
    .some((option) => argv.includes(option));
}

async function promptForInstallMode(json: boolean): Promise<{ mode: InstallMode; cdpEndpoint?: string }> {
  if (json || !process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      `Interactive configuration requires a terminal. Use --mode with one of: ${INSTALL_MODES.join(", ")}.`,
    );
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write(`Choose how Blop Browser should run by default:\n\n${[
      "1. Playwright Chromium, headless (recommended for agents and CI)",
      "2. Playwright Chromium, visible (local debugging)",
      "3. Existing Chrome over CDP (reuse its profile, cookies, and tabs)",
      "4. Camoufox, headless (optional anti-bot; downloads a third-party browser)",
      "5. Camoufox, visible (optional anti-bot; downloads a third-party browser)",
    ].join("\n")}\n\n`);
    const answer = (await prompt.question("Mode [1]: ")).trim() || "1";
    const mode = INSTALL_MODES[Number(answer) - 1];
    if (!mode) throw new Error("Choose a number from 1 to 5.");
    if (mode === "chrome-cdp") {
      const endpoint = (await prompt.question("Chrome CDP endpoint [http://127.0.0.1:9222]: ")).trim();
      return { mode, cdpEndpoint: endpoint || "http://127.0.0.1:9222" };
    }
    if (mode.startsWith("camoufox")) {
      const confirmation = (await prompt.question("Download Camoufox if it is not installed? [y/N]: ")).trim();
      if (!/^y(?:es)?$/i.test(confirmation)) throw new Error("Camoufox setup cancelled.");
    }
    return { mode };
  } finally {
    prompt.close();
  }
}

function parseArgs(argv: string[], config: BrowserConfig | null): ParsedArgs {
  const args = [...argv];
  const session = optionValue(args, "--session") ?? process.env.BLOP_BROWSER_SESSION ?? "default";
  removeOption(args, "--session");
  const configured = config ? settingsForMode(config.mode) : undefined;
  const cliBrowser = optionValue(args, "--browser");
  const cliCdpEndpoint = optionValue(args, "--cdp-endpoint");
  const attachExisting = removeFlag(args, "--attach-existing");
  const profileOverride = optionValue(args, "--profile") ?? process.env.BLOP_BROWSER_PROFILE;
  const requestedProfileMode = profileOverride ? parseProfileMode(profileOverride) : undefined;
  const profileMode = requestedProfileMode ?? "persistent";
  removeOption(args, "--profile");
  const telemetry = parseTelemetryMode(
    optionValue(args, "--telemetry")
      ?? process.env.BLOP_BROWSER_TELEMETRY
      ?? config?.telemetry
      ?? "off",
  );
  removeOption(args, "--telemetry");
  const cliAntiBot = takeOptionalEnum(args, "--anti-bot", ["on", "off"] as const, "on");
  const requestedAntiBot = cliAntiBot
    ?? (process.env.BLOP_BROWSER_ANTI_BOT
      ? parseAntiBotMode(process.env.BLOP_BROWSER_ANTI_BOT)
      : undefined);
  const antiBot = requestedAntiBot ?? config?.antiBot ?? "off";
  const headlessFlag = removeFlag(args, "--headless");
  const headedFlag = removeFlag(args, "--headed");
  if (headlessFlag && headedFlag) throw new Error("Use either --headless or --headed, not both.");
  const cliLaunchOverride = Boolean(cliBrowser || headlessFlag || headedFlag || cliAntiBot);
  const browserOverride = cliBrowser ?? (cliCdpEndpoint ? "chromium" : process.env.BLOP_BROWSER);
  const cdpOverride = cliCdpEndpoint
    ?? process.env.BLOP_BROWSER_DAEMON_CDP_ENDPOINT
    ?? (!cliLaunchOverride ? process.env.BLOP_BROWSER_CDP_ENDPOINT : undefined);
  const selectedBrowser = parseBrowserName(browserOverride ?? (cdpOverride ? "chromium" : configured?.browser) ?? "chromium");
  removeOption(args, "--browser");
  const environmentLaunchOverride = Boolean(
    process.env.BLOP_BROWSER
    || process.env.BLOP_BROWSER_HEADLESS !== undefined
    || process.env.BLOP_BROWSER_ANTI_BOT === "on",
  );
  const cdpEndpoint = parseCdpEndpoint(
    cdpOverride
      ?? (!cliLaunchOverride && !environmentLaunchOverride && config?.mode === "chrome-cdp"
        ? config.cdpEndpoint
        : undefined),
  );
  removeOption(args, "--cdp-endpoint");
  const configuredHeadless = configured?.headless ?? true;
  const headless = headlessFlag ? true
    : headedFlag ? false
    : process.env.BLOP_BROWSER_HEADLESS !== undefined
    ? process.env.BLOP_BROWSER_HEADLESS !== "0"
    : configuredHeadless;
  const json = removeFlag(args, "--json");
  validateSessionName(session);
  const command = args.shift() ?? "";
  const browser = command === "config"
    ? selectedBrowser
    : applyAntiBot({
      antiBot,
      requestedAntiBot,
      browser: selectedBrowser,
      cdpEndpoint,
      cliBrowser,
    });
  if (command !== "config" && cdpEndpoint && browser !== "chromium") {
    throw new Error("--cdp-endpoint only supports Chromium-based browsers.");
  }
  const connection = cdpEndpoint ? "cdp"
    : cliLaunchOverride || environmentLaunchOverride || (config && config.mode !== "chrome-cdp")
    ? "launch"
    : undefined;
  return {
    session,
    browser,
    cdpEndpoint,
    attachExisting,
    profileMode,
    requestedProfileMode,
    connection,
    headless,
    json,
    telemetry,
    antiBot,
    ...(requestedAntiBot ? { requestedAntiBot } : {}),
    command,
    rest: args,
  };
}

function parseProfileMode(value: string): BrowserProfileMode {
  if (value === "persistent" || value === "disposable") return value;
  throw new Error("--profile must be persistent or disposable.");
}

function parseInstallMode(value: string): InstallMode {
  if ((INSTALL_MODES as readonly string[]).includes(value)) return value as InstallMode;
  throw new Error(`--mode must be one of: ${INSTALL_MODES.join(", ")}.`);
}

function parseTelemetryMode(value: string): "off" {
  if (value === "off") return value;
  throw new Error(
    'First-party harness telemetry must be "off"; this package has no telemetry collection backend.',
  );
}

function parseAntiBotMode(value: string): AntiBotMode {
  if (value === "off" || value === "on") return value;
  throw new Error('--anti-bot must be "on" or "off".');
}

function defaultModeForAntiBot(antiBot: AntiBotMode): InstallMode {
  return antiBot === "on" ? "camoufox-headless" : "chromium-headless";
}

function modeForAntiBot(mode: InstallMode, antiBot: AntiBotMode): InstallMode {
  if (antiBot === "on") {
    if (mode === "chrome-cdp") {
      throw new Error("Anti-bot mode is not available with chrome-cdp.");
    }
    if (mode === "chromium-headless") return "camoufox-headless";
    if (mode === "chromium-headed") return "camoufox-headed";
    return mode;
  }
  if (mode === "camoufox-headless") return "chromium-headless";
  if (mode === "camoufox-headed") return "chromium-headed";
  return mode;
}

function applyAntiBot(input: {
  antiBot: AntiBotMode;
  requestedAntiBot?: AntiBotMode;
  browser: BrowserName;
  cdpEndpoint?: string;
  cliBrowser?: string;
}): BrowserName {
  if (input.antiBot === "on") {
    if (input.cdpEndpoint) {
      throw new Error("Anti-bot mode is not available with --cdp-endpoint.");
    }
    if (input.cliBrowser === "chromium") {
      throw new Error(
        "Anti-bot mode uses Camoufox. Omit --browser chromium or pass --browser camoufox.",
      );
    }
    return "camoufox";
  }
  if (input.requestedAntiBot === "off" && input.cliBrowser !== "camoufox") {
    return "chromium";
  }
  return input.browser;
}

function settingsForMode(mode: InstallMode): {
  browser: BrowserName;
  headless: boolean;
  connection: "launch" | "cdp";
} {
  return {
    browser: mode.startsWith("camoufox") ? "camoufox" : "chromium",
    headless: mode.endsWith("headless"),
    connection: mode === "chrome-cdp" ? "cdp" : "launch",
  };
}

function parseBrowserName(value: string): BrowserName {
  if (value === "chromium" || value === "camoufox") return value;
  throw new Error("--browser must be chromium or camoufox.");
}

function parseCdpEndpoint(value: string | undefined) {
  if (!value) return undefined;
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error("--cdp-endpoint must be a valid HTTP or WebSocket URL.");
  }
  if (!["http:", "https:", "ws:", "wss:"].includes(endpoint.protocol)) {
    throw new Error("--cdp-endpoint must use HTTP, HTTPS, WS, or WSS.");
  }
  return value;
}

function browserConfigPath() {
  if (process.env.BLOP_BROWSER_CONFIG_PATH) return resolve(process.env.BLOP_BROWSER_CONFIG_PATH);
  const root = process.platform === "win32"
    ? process.env.APPDATA ?? join(homedir(), "AppData", "Roaming")
    : process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(root, "blop-browser", "config.json");
}

async function readBrowserConfig(path: string): Promise<BrowserConfig | null> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch {
    return null;
  }
  let parsed: Partial<BrowserConfig>;
  try {
    parsed = JSON.parse(source) as Partial<BrowserConfig>;
  } catch {
    return null;
  }
  if (parsed.version !== 1 || typeof parsed.mode !== "string") return null;
  const mode = parseInstallMode(parsed.mode);
  const telemetry = parseTelemetryMode(parsed.telemetry ?? "off");
  const antiBot = parseAntiBotMode(parsed.antiBot ?? (mode.startsWith("camoufox") ? "on" : "off"));
  if (antiBot === "on" && mode === "chrome-cdp") return null;
  const cdpEndpoint = mode === "chrome-cdp" ? parseCdpEndpoint(parsed.cdpEndpoint) : undefined;
  if (mode === "chrome-cdp" && !cdpEndpoint) return null;
  return { version: 1, mode, telemetry, antiBot, ...(cdpEndpoint ? { cdpEndpoint } : {}) };
}

async function writeBrowserConfig(path: string, config: BrowserConfig) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600).catch(() => undefined);
}

function optionValue(args: string[], name: string) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined) throw new Error(`${name} requires a value.`);
  return value;
}

function removeOption(args: string[], name: string) {
  const index = args.indexOf(name);
  if (index >= 0) args.splice(index, 2);
}

function removeFlag(args: string[], name: string) {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

function takeOptionalEnum<T extends string>(
  args: string[],
  name: string,
  values: readonly T[],
  bareValue: T,
): T | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const next = args[index + 1];
  if (next !== undefined && (values as readonly string[]).includes(next)) {
    args.splice(index, 2);
    return next as T;
  }
  args.splice(index, 1);
  return bareValue;
}

function parseObject(raw: string, source: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${source} must be valid JSON.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${source} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

type EnsuredDaemon = {
  endpoint: DaemonEndpoint;
  started: boolean;
};

async function ensureDaemon(parsed: ParsedArgs): Promise<EnsuredDaemon> {
  const {
    session,
    browser,
    connection: requestedConnection,
    cdpEndpoint,
    attachExisting,
    profileMode,
    requestedProfileMode,
  } = parsed;
  if (attachExisting && !cdpEndpoint) {
    throw new Error("--attach-existing requires --cdp-endpoint or a saved chrome-cdp configuration.");
  }
  if (cdpEndpoint && requestedProfileMode) {
    throw new Error("--profile controls managed browser storage and cannot be combined with existing-profile attachment.");
  }
  const existing = await readEndpoint(session);
  if (existing && await daemonIsHealthy(existing)) {
    const status = await requestDaemon(existing, "status");
    const activeBrowser = status.ok
      ? String((status.result as Record<string, unknown> | undefined)?.browser ?? "chromium")
      : "chromium";
    const activeConnection = status.ok
      ? String((status.result as Record<string, unknown> | undefined)?.connection ?? "launch")
      : "launch";
    const activeCdpEndpointIdentity = status.ok
      ? String((status.result as Record<string, unknown> | undefined)?.cdpEndpointIdentity ?? "")
      : "";
    const activeProfileMode = status.ok
      ? String((status.result as { sessionScope?: { mode?: unknown } } | undefined)?.sessionScope?.mode ?? "persistent")
      : "persistent";
    const connectionMatches = !requestedConnection || activeConnection === requestedConnection;
    const endpointMatches = !cdpEndpoint
      || activeCdpEndpointIdentity === identifyCdpEndpoint(cdpEndpoint);
    const profileMatches = !requestedProfileMode || activeConnection === "cdp" || activeProfileMode === requestedProfileMode;
    if (activeBrowser === browser && connectionMatches && endpointMatches && profileMatches) {
      return { endpoint: existing, started: false };
    }
    if (activeBrowser === browser && connectionMatches && endpointMatches && !profileMatches) {
      throw new Error(
        `Session "${session}" already uses a ${activeProfileMode} profile. Close it first or use a different --session before switching to ${requestedProfileMode}.`,
      );
    }
    const requestedDescription = requestedConnection ?? "the current connection";
    throw new Error(
      `Session "${session}" already uses ${activeBrowser} via ${activeConnection}. Close it first or use a different --session before switching to ${browser} via ${requestedDescription}.`,
    );
  }
  if (existing) await removeEndpoint(session);
  if (cdpEndpoint && !attachExisting) {
    throw new Error(
      "Attaching to an existing browser profile requires --attach-existing. Review the profile scope before granting access.",
    );
  }

  const paths = pathsForSession(session);
  await ensureRuntimeDirectory(paths.directory);
  let startupDescriptor: number;
  try {
    startupDescriptor = openSync(paths.startup, "wx", 0o600);
    closeSync(startupDescriptor);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return { endpoint: await waitForDaemon(session, paths.log), started: false };
  }

  try {
    const descriptor = openSync(paths.log, "a", 0o600);
    const { executable, entry } = await daemonEntrypoint(browser);
    if (profileMode === "disposable") {
      await Promise.all([
        rm(paths.profile, { recursive: true, force: true }),
        rm(paths.downloads, { recursive: true, force: true }),
      ]);
    }
    const daemonArgs = [entry, "--session", session, "--browser", browser, "--profile", profileMode];
    if (cdpEndpoint) daemonArgs.push("--attach-existing");
    daemonArgs.push("_daemon");
    const child = spawn(executable, daemonArgs, {
      detached: true,
      env: {
        ...process.env,
        ...(cdpEndpoint
          ? { BLOP_BROWSER_DAEMON_CDP_ENDPOINT: cdpEndpoint }
          : {}),
      },
      stdio: ["ignore", descriptor, descriptor],
    });
    child.unref();
    closeSync(descriptor);
    return { endpoint: await waitForDaemon(session, paths.log, child), started: true };
  } finally {
    await rm(paths.startup, { force: true });
  }
}

async function requestStartedDaemon(
  daemon: EnsuredDaemon,
  method: RpcMethod,
  params: Record<string, unknown> = {},
  json = false,
): Promise<RpcResponse> {
  if (!daemon.started) return await requestDaemon(daemon.endpoint, method, params);
  const status = await requestDaemon(daemon.endpoint, "status");
  if (!status.ok) return status;
  const privacy = (status.result as { privacy?: CliSessionPrivacySummary } | undefined)?.privacy;
  if (!privacy) {
    return errorResponse(
      status.id,
      "privacy_unavailable",
      "The new browser daemon did not provide its privacy summary; the requested command was not dispatched.",
    );
  }
  if (!json) process.stderr.write(`${formatPrivacySummary(privacy)}\n`);
  const response = await requestDaemon(daemon.endpoint, method, params);
  return { ...response, privacy };
}

async function daemonEntrypoint(browser: BrowserName) {
  const currentEntry = fileURLToPath(import.meta.url);
  if (browser !== "camoufox" || !process.versions.bun) {
    return { executable: process.execPath, entry: currentEntry };
  }
  const executable = process.env.BLOP_BROWSER_NODE_PATH ?? "node";
  const entry = currentEntry.endsWith(".ts")
    ? resolve(dirname(currentEntry), "../dist/cli.js")
    : currentEntry;
  try {
    await access(entry);
  } catch {
    throw new Error(
      "Camoufox needs the Node.js CLI build when blop-browser is invoked through Bun. Run `bun run build`, then retry.",
    );
  }
  return { executable, entry };
}

async function waitForDaemon(
  session: string,
  logPath: string,
  child?: ReturnType<typeof spawn>,
): Promise<DaemonEndpoint> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const endpoint = await readEndpoint(session);
    if (endpoint && await daemonIsHealthy(endpoint)) return endpoint;
    if (child?.exitCode !== null && child?.exitCode !== undefined) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const log = await readFile(logPath, "utf8").catch(() => "");
  throw new Error(`Browser daemon did not start.${log.trim() ? `\n${log.trim().slice(-2000)}` : ""}`);
}

async function destroySessionState(session: string): Promise<RpcResponse> {
  const paths = pathsForSession(session);
  await ensureRuntimeDirectory(paths.directory);
  let startupDescriptor: number;
  try {
    startupDescriptor = openSync(paths.startup, "wx", 0o600);
    closeSync(startupDescriptor);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Session "${session}" is starting. Wait for startup to finish before destroying its state.`);
    }
    throw error;
  }

  let scope = getBrowserSessionScope(session, { runtimeDirectory: paths.directory });
  let wasActive = false;
  let traceEvent: unknown;
  try {
    const endpoint = await readEndpoint(session);
    if (endpoint && await daemonIsHealthy(endpoint)) {
      wasActive = true;
      const status = await requestDaemon(endpoint, "status");
      const activeScope = (status.result as { sessionScope?: typeof scope } | undefined)?.sessionScope;
      if (activeScope) scope = activeScope;
      const shutdown = await requestDaemon(endpoint, "shutdown", { reason: "destroy" });
      if (!shutdown.ok) return shutdown;
      traceEvent = (shutdown.result as { traceEvent?: unknown } | undefined)?.traceEvent;
      const shutdownTimeout = sessionCleanupTimeout();
      if (!await waitForDaemonToStop(endpoint, shutdownTimeout)) {
        return errorResponse(
          shutdown.id,
          "cleanup_timeout",
          `Session "${session}" did not stop within ${shutdownTimeout}ms; its managed data and daemon log were preserved for diagnosis.`,
        );
      }
    } else if (endpoint) {
      await removeEndpoint(session);
    }

    await Promise.all([
      rm(paths.profile, { recursive: true, force: true }),
      rm(paths.downloads, { recursive: true, force: true }),
      rm(paths.artifacts, { recursive: true, force: true }),
      rm(paths.endpoint, { force: true }),
      rm(paths.log, { force: true }),
    ]);
    const externalProfilePreserved = scope.mode === "existing-profile";
    return okResponse("destroy", {
      session,
      destroyed: true,
      wasActive,
      profileDestroyed: !externalProfilePreserved,
      externalProfilePreserved,
      sessionScope: scope,
      preserved: preservedRetainedData(browserConfigPath()),
      deletionBoundary: "filesystem removal completed; secure erasure and external copies are not verified",
      ...(traceEvent ? { traceEvent } : {}),
    });
  } finally {
    await rm(paths.startup, { force: true });
  }
}

async function closeSessionState(session: string): Promise<RpcResponse> {
  const endpoint = await readEndpoint(session);
  if (!endpoint || !await daemonIsHealthy(endpoint)) {
    return await requestWithoutStarting(session, "shutdown");
  }
  const status = await requestDaemon(endpoint, "status");
  const profileMode = String(
    (status.result as { sessionScope?: { mode?: unknown } } | undefined)
      ?.sessionScope?.mode ?? "persistent",
  );
  const response = await requestDaemon(endpoint, "shutdown");
  if (profileMode === "disposable" && response.ok) {
    const shutdownTimeout = sessionCleanupTimeout();
    if (!await waitForDaemonToStop(endpoint, shutdownTimeout)) {
      return errorResponse(
        response.id,
        "cleanup_timeout",
        `Disposable session "${session}" did not stop within ${shutdownTimeout}ms; its daemon log was preserved for diagnosis.`,
      );
    }
    await rm(pathsForSession(session).log, { force: true });
  }
  return response;
}

function sessionCleanupTimeout() {
  return numericEnvironment(
    "BLOP_BROWSER_CLEANUP_TIMEOUT_MS",
    5_000,
    25,
    5_000,
  );
}

async function waitForDaemonToStop(
  endpoint: DaemonEndpoint,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && await daemonIsHealthy(endpoint)) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !await daemonIsHealthy(endpoint);
}

async function requestWithoutStarting(
  session: string,
  method: RpcMethod,
  profileMode: BrowserProfileMode = "persistent",
  cdpEndpoint?: string,
): Promise<RpcResponse> {
  const endpoint = await readEndpoint(session);
  if (!endpoint || !await daemonIsHealthy(endpoint)) {
    if (endpoint) await removeEndpoint(session);
    const sessionScope = getBrowserSessionScope(session, {
      runtimeDirectory: pathsForSession(session).directory,
      existingProfile: Boolean(cdpEndpoint),
      profileMode,
    });
    return okResponse("offline", method === "status"
      ? {
        session,
        active: false,
        sessionScope,
        privacy: createCliSessionPrivacySummary(session, sessionScope, cdpEndpoint),
      }
      : method === "export_trace"
      ? await readPersistedCliTrace(pathsForSession(session).artifacts)
        ?? createTraceRecorder({ identity: { sessionId: session } }).snapshot()
      : method === "export_metrics"
      ? await readPersistedCliMetrics(pathsForSession(session).artifacts)
        ?? emptySessionMetrics()
      : { session, closed: false, active: false });
  }
  return await requestDaemon(endpoint, method);
}

async function runDaemon(
  session: string,
  browser: BrowserName,
  cdpEndpoint: string | undefined,
  profileMode: BrowserProfileMode,
) {
  const paths = pathsForSession(session);
  const runtime = await createHarnessCliRuntime(session, paths.artifacts, browser, cdpEndpoint, profileMode);
  let rpc: RpcServer | undefined;
  let closing = false;
  const close = async (reason: "close" | "destroy" | "idle" = "close") => {
    if (closing) return;
    closing = true;
    await runtime.close(reason);
    await rpc?.close();
    if (profileMode === "disposable") {
      await rm(paths.log, { force: true }).catch(() => undefined);
    }
  };
  rpc = await startRpcServer(session, async (request) => handleDaemonRequest(request.id, request.method, request.params, runtime, close));

  const idleTimeout = numericEnvironment("BLOP_BROWSER_IDLE_TIMEOUT_MS", 30 * 60_000, 1_000);
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const armIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    runtime.setExpiresAt(profileMode === "disposable" && !cdpEndpoint
      ? new Date(Date.now() + idleTimeout).toISOString()
      : null);
    idleTimer = setTimeout(() => void close("idle"), idleTimeout);
    idleTimer.unref();
  };
  rpc.server.on("connection", armIdleTimer);
  armIdleTimer();
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
  await new Promise<void>((resolve) => rpc!.server.once("close", resolve));
  if (idleTimer) clearTimeout(idleTimer);
}

async function installCamoufox() {
  const cliPath = process.env.BLOP_BROWSER_CAMOUFOX_CLI_PATH
    ?? fileURLToPath(new URL("./__main__.js", import.meta.resolve("camoufox-js")));
  const nodeExecutable = process.env.BLOP_BROWSER_NODE_PATH ?? (process.versions.bun ? "node" : process.execPath);
  const child = spawn(nodeExecutable, [cliPath, "fetch"], {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const forward = (chunk: Buffer) => {
    output = `${output}${chunk}`.slice(-8_000);
    process.stderr.write(chunk);
  };
  child.stdout?.on("data", forward);
  child.stderr?.on("data", forward);
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (exitCode !== 0) {
    throw new Error(`Camoufox installation failed with exit code ${exitCode}.${output.trim() ? `\n${output.trim()}` : ""}`);
  }
  const executablePath = await resolveCamoufoxExecutable();
  if (!executablePath) throw new Error("Camoufox installation finished, but its browser executable was not found.");
  return executablePath;
}

async function handleDaemonRequest(
  id: string,
  method: RpcMethod,
  params: Record<string, unknown> | undefined,
  runtime: HarnessCliRuntime,
  close: () => Promise<void>,
): Promise<RpcResponse> {
  if (method === "ping") return okResponse(id, { pid: process.pid });
  if (method === "status") return okResponse(id, { active: true, ...await runtime.status() });
  if (method === "export_trace") return okResponse(id, runtime.trace());
  if (method === "export_metrics") return okResponse(id, runtime.metrics());
  if (method === "list_tools") return okResponse(id, runtime.listTools());
  if (method === "describe_tool") {
    try {
      return okResponse(id, runtime.describeTool(String(params?.name ?? "")));
    } catch (error) {
      return errorResponse(id, "unknown_tool", messageOf(error));
    }
  }
  if (method === "call_tool") {
    try {
      const name = String(params?.name ?? "");
      const input = params?.input;
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        return errorResponse(id, "invalid_input", "Tool input must be a JSON object.");
      }
      return okResponse(id, await runtime.call(name, input as Record<string, unknown>));
    } catch (error) {
      return errorResponse(
        id,
        error instanceof BrowserControlError ? error.code : "tool_error",
        messageOf(error),
        error instanceof BrowserToolError ? error.contentBoundary : undefined,
        error instanceof BrowserSafetyError ? {
          code: error.code,
          toolName: error.toolName,
          category: error.category,
          decision: error.decision,
          ...(error.phase ? { phase: error.phase } : {}),
          ...(error.origin ? { origin: error.origin } : {}),
        } : undefined,
        error instanceof BrowserControlError ? controlRpcError(error) : undefined,
      );
    }
  }
  if (method === "request_takeover") {
    try {
      const reason = params?.reason;
      if (reason !== "challenge" && reason !== "sensitive-step" && reason !== "other") {
        return errorResponse(id, "invalid_input", "Takeover reason must be challenge, sensitive-step, or other.");
      }
      const message = params?.message;
      if (message !== undefined && typeof message !== "string") {
        return errorResponse(id, "invalid_input", "Takeover message must be a string.");
      }
      return okResponse(id, await runtime.requestTakeover({ reason, ...(message ? { message } : {}) }));
    } catch (error) {
      return controlErrorResponse(id, error);
    }
  }
  if (method === "take_control") {
    try {
      return okResponse(id, await runtime.takeControl(String(params?.requestId ?? "")));
    } catch (error) {
      return controlErrorResponse(id, error);
    }
  }
  if (method === "resume_automation") {
    try {
      const outcome = params?.outcome;
      if (outcome !== undefined && outcome !== "completed" && outcome !== "cancelled") {
        return errorResponse(id, "invalid_input", "Takeover outcome must be completed or cancelled.");
      }
      return okResponse(id, await runtime.resumeAutomation({
        requestId: String(params?.requestId ?? ""),
        leaseId: String(params?.leaseId ?? ""),
        ...(outcome ? { outcome } : {}),
      }));
    } catch (error) {
      return controlErrorResponse(id, error);
    }
  }
  if (method === "shutdown") {
    const status: Record<string, unknown> = await runtime.status().catch(() => ({}));
    const reason = params?.reason === "destroy" ? "destroy" : "close";
    const traceEvent = await runtime.close(reason);
    setTimeout(() => void close(), 10).unref();
    return okResponse(id, {
      session: typeof status.session === "string" ? status.session : undefined,
      closed: true,
      ...(traceEvent ? { traceEvent } : {}),
    });
  }
  return errorResponse(id, "unknown_method", `Unknown daemon method "${method}".`);
}

function controlErrorResponse(id: string, error: unknown) {
  return errorResponse(
    id,
    error instanceof BrowserControlError ? error.code : "control_error",
    messageOf(error),
    error instanceof BrowserToolError ? error.contentBoundary : undefined,
    undefined,
    error instanceof BrowserControlError ? controlRpcError(error) : undefined,
  );
}

function controlRpcError(error: BrowserControlError) {
  return {
    code: error.code,
    state: error.state,
    command: error.command,
    ...(error.requestId ? { requestId: error.requestId } : {}),
  } as const;
}

function numericEnvironment(
  name: string,
  fallback: number,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.floor(value)))
    : fallback;
}

function printResponse(response: RpcResponse, json: boolean) {
  response = publicRpcResponse(response);
  if (json) {
    const { id: _internalRequestId, ...publicResponse } = response;
    process.stdout.write(`${JSON.stringify(publicResponse)}\n`);
    return;
  }
  if (!response.ok) {
    const boundary = response.error?.contentBoundary
      ? `${formatContentBoundary(response.error.contentBoundary)}\n`
      : "";
    process.stderr.write(`${boundary}${response.error?.message ?? "Unknown CLI error"}\n`);
    return;
  }
  const result = response.result as { content?: unknown; contentBoundary?: ToolContentBoundary } | undefined;
  if (typeof result?.content === "string") {
    const boundary = result.contentBoundary ? `${formatContentBoundary(result.contentBoundary)}\n` : "";
    process.stdout.write(`${boundary}${result.content}\n`);
  }
  else process.stdout.write(`${JSON.stringify(response.result, null, 2)}\n`);
}

function publicRpcResponse(response: RpcResponse): RpcResponse {
  if (!response.result || typeof response.result !== "object" || Array.isArray(response.result)) {
    return response;
  }
  const result = { ...(response.result as Record<string, unknown>) };
  delete result.cdpEndpointIdentity;
  if (typeof result.cdpEndpoint === "string") {
    result.cdpEndpoint = displayCdpEndpoint(result.cdpEndpoint);
  }
  if (result.browser && typeof result.browser === "object" && !Array.isArray(result.browser)) {
    const browser = { ...(result.browser as Record<string, unknown>) };
    if (typeof browser.cdpEndpoint === "string") {
      browser.cdpEndpoint = displayCdpEndpoint(browser.cdpEndpoint);
    }
    result.browser = browser;
  }
  return { ...response, result };
}

function printTraceResponse(response: RpcResponse) {
  if (!response.ok) {
    process.stderr.write(`${response.error?.message ?? "Unknown CLI error"}\n`);
    return;
  }
  process.stdout.write(`${formatTraceTimeline(response.result as HarnessTraceExport)}\n`);
}

function formatContentBoundary(boundary: ToolContentBoundary) {
  if (boundary.source === "browser") {
    return "[content-boundary source=browser trust=untrusted]";
  }
  if (boundary.source === "mixed") {
    return "[content-boundary source=mixed trust=untrusted]";
  }
  if (boundary.source === "caller") {
    return "[content-boundary source=caller trust=untrusted]";
  }
  return "[content-boundary source=harness trust=trusted]";
}

function formatPrivacySummary(privacy: CliSessionPrivacySummary) {
  return `Privacy: mode=${privacy.mode} telemetry=${privacy.telemetry.firstPartyHarness} recording=trace+metrics; screenshots=${privacy.recording.screenshots} profile=${privacy.locations.profileDirectory ?? "external"} local-retention=${privacy.retention.localArtifacts} browser-storage=${privacy.retention.managedBrowserStorage}`;
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

const entryArgument = process.argv[1];
if (entryArgument && isEntrypoint(entryArgument)) {
  main().catch((error) => {
    const json = process.argv.includes("--json");
    const message = messageOf(error);
    if (json) process.stdout.write(`${JSON.stringify({ ok: false, error: { code: "cli_error", message } })}\n`);
    else process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}

function isEntrypoint(entry: string) {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
  } catch {
    return import.meta.url === pathToFileURL(entry).href;
  }
}
