import "../session/bun-ws-compat.js";
import { access, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { chromium, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from "playwright";
import { createBrowserTools } from "../create-tools.js";
import {
  cliTracePaths,
  persistCliTrace,
  readPersistedCliTrace,
} from "./trace-store.js";
import {
  cliMetricsPath,
  persistCliMetrics,
  readPersistedCliMetrics,
} from "./metrics-store.js";
import {
  createSessionMetricsRecorder,
  type HarnessSessionMetrics,
} from "../session-metrics.js";
import {
  createTraceRecorder,
  type HarnessTraceEvent,
  type HarnessTraceExport,
} from "../trace-recorder.js";
import {
  getBrowserSessionScope,
  type BrowserProfileMode,
  type BrowserSessionScope,
} from "../session/scope.js";
import type { HarnessAction, HarnessBrowserLog } from "../types.js";
import type { FinishState, NativeToolBridge } from "../tools/types.js";
import {
  createCliSessionPrivacySummary,
  displayCdpEndpoint,
  identifyCdpEndpoint,
} from "./privacy.js";
import {
  BrowserControlError,
  createBrowserControlSession,
  type BrowserControlStatus,
  type BrowserHumanControlLease,
  type BrowserTakeoverOutcome,
  type BrowserTakeoverReason,
} from "../session/control.js";

export type BrowserName = "chromium" | "camoufox";

type LaunchedBrowser = {
  browser?: Browser;
  context?: BrowserContext;
  page?: Page;
  pages?: Page[];
  ownsContext?: boolean;
  closeLauncher?: () => Promise<void>;
};

export type HarnessCliRuntime = {
  call: (name: string, input: Record<string, unknown>) => Promise<Awaited<ReturnType<NativeToolBridge["execute"]>>>;
  listTools: () => Array<{ name: string; description: string }>;
  describeTool: (name: string) => Omit<NativeToolBridge, "execute">;
  status: () => Promise<Record<string, unknown>>;
  trace: () => HarnessTraceExport;
  metrics: () => HarnessSessionMetrics;
  requestTakeover: (input: {
    reason: BrowserTakeoverReason;
    message?: string;
  }) => Promise<{ control: BrowserControlStatus; access: CliHumanAccess }>;
  takeControl: (requestId: string) => Promise<{
    control: BrowserControlStatus;
    access: CliHumanAccess;
    lease: BrowserHumanControlLease;
  }>;
  resumeAutomation: (input: {
    requestId: string;
    leaseId: string;
    outcome?: BrowserTakeoverOutcome;
  }) => Promise<{ control: BrowserControlStatus; pageAvailable: boolean }>;
  setExpiresAt: (expiresAt: string | null) => void;
  close: (reason?: "close" | "destroy" | "idle") => Promise<HarnessTraceEvent | undefined>;
};

type CliHumanAccess =
  | Readonly<{ kind: "managed-window"; instruction: string }>
  | Readonly<{ kind: "attached-browser"; instruction: string }>
  | Readonly<{ kind: "unavailable"; instruction: string }>;

export async function createHarnessCliRuntime(
  session: string,
  artifactDirectory: string,
  browserName: BrowserName = "chromium",
  cdpEndpoint?: string,
  profileMode: BrowserProfileMode = "persistent",
): Promise<HarnessCliRuntime> {
  const sessionScope = getBrowserSessionScope(session, {
    runtimeDirectory: dirname(artifactDirectory),
    existingProfile: Boolean(cdpEndpoint),
    profileMode,
  });
  await mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
  const initialTrace = profileMode === "disposable"
    ? null
    : await readPersistedCliTrace(artifactDirectory);
  const initialMetrics = profileMode === "disposable"
    ? null
    : await readPersistedCliMetrics(artifactDirectory);
  const headless = process.env.BLOP_BROWSER_HEADLESS !== "0";
  let launched: LaunchedBrowser;
  if (cdpEndpoint) launched = await connectChromeOverCdp(cdpEndpoint);
  else {
    await Promise.all([
      mkdir(sessionScope.profileDirectory!, { recursive: true, mode: 0o700 }),
      mkdir(sessionScope.downloadsDirectory!, { recursive: true, mode: 0o700 }),
    ]);
    if (browserName === "camoufox") launched = await launchCamoufox(headless, sessionScope);
    else launched = await launchChromium(headless, sessionScope);
  }
  const browser = launched.browser;
  const contextOptions: BrowserContextOptions = { bypassCSP: true };
  if (browserName === "camoufox") contextOptions.viewport = null;
  let context = launched.context;
  if (!context) {
    if (!browser) throw new Error("Browser launch did not provide a context or browser.");
    context = await browser.newContext(contextOptions);
  }
  const page = launched.page ?? await context.newPage();
  const humanAccess: CliHumanAccess = cdpEndpoint
    ? Object.freeze({
      kind: "attached-browser",
      instruction: "Use the configured attached browser. The CLI cannot verify that it is visible or reachable by the intended person.",
    })
    : headless
    ? Object.freeze({
      kind: "unavailable",
      instruction: "Restart with a headed managed browser or attach an external browser before requesting takeover.",
    })
    : Object.freeze({
      kind: "managed-window",
      instruction: "Use the visible managed browser window.",
    });
  return createRuntimeFromBrowser(
    session,
    artifactDirectory,
    browserName,
    browser,
    context,
    page,
    launched.pages ?? [page],
    launched.ownsContext ?? true,
    cdpEndpoint ? "cdp" : "launch",
    cdpEndpoint,
    launched.closeLauncher,
    sessionScope,
    initialTrace,
    initialMetrics,
    humanAccess,
  );
}

async function launchChromium(headless: boolean, scope: BrowserSessionScope): Promise<LaunchedBrowser> {
  const executablePath = await resolveBrowserExecutable();
  const context = await chromium.launchPersistentContext(scope.profileDirectory!, {
    headless,
    bypassCSP: true,
    acceptDownloads: true,
    downloadsPath: scope.downloadsDirectory!,
    ...(executablePath ? { executablePath } : {}),
  });
  const pages = context.pages();
  const page = pages.at(-1) ?? await context.newPage();
  return { browser: context.browser() ?? undefined, context, page, pages: pages.length > 0 ? pages : [page] };
}

async function connectChromeOverCdp(endpoint: string): Promise<LaunchedBrowser> {
  try {
    const browser = await chromium.connectOverCDP(endpoint);
    const existingContext = browser.contexts()[0];
    const context = existingContext ?? await browser.newContext({ bypassCSP: true });
    const existingPages = context.pages();
    const page = existingPages.at(-1) ?? await context.newPage();
    return {
      browser,
      context,
      page,
      pages: existingPages.length > 0 ? existingPages : [page],
      ownsContext: !existingContext,
    };
  } catch (error) {
    const errorClass = error instanceof Error && /^[A-Za-z][A-Za-z0-9]*$/.test(error.name)
      ? error.name
      : "Error";
    throw new Error(
      `Could not connect to Chrome over CDP at ${displayCdpEndpoint(endpoint)} (${errorClass}).`,
    );
  }
}

async function launchCamoufox(headless: boolean, scope: BrowserSessionScope): Promise<LaunchedBrowser> {
  if (process.versions.bun) {
    throw new Error("Camoufox must run under Node.js. Start it through the blop-browser CLI.");
  }
  const { Camoufox } = await import("camoufox-js");
  const executablePath = process.env.BLOP_BROWSER_CAMOUFOX_EXECUTABLE_PATH;
  try {
    const context = await Camoufox({
      headless,
      user_data_dir: scope.profileDirectory!,
      downloadsPath: scope.downloadsDirectory!,
      acceptDownloads: true,
      bypassCSP: true,
      viewport: null,
      ...(executablePath ? { executable_path: executablePath } : {}),
    });
    const pages = context.pages();
    const page = pages.at(-1) ?? await context.newPage();
    return { browser: context.browser() ?? undefined, context, page, pages: pages.length > 0 ? pages : [page] };
  } catch (error) {
    if (messageOf(error).match(/not (?:installed|found)|fetch|download/i)) {
      throw new Error(
        "Camoufox is not installed. Ask the user before downloading it, then run `blop-browser install camoufox`.",
      );
    }
    throw error;
  }
}

export async function resolveBrowserExecutable() {
  const configured = process.env.BLOP_BROWSER_EXECUTABLE_PATH;
  if (configured) {
    await access(configured);
    return configured;
  }
  const candidates = [
    chromium.executablePath(),
    ...(process.platform === "linux" ? [
      "/usr/bin/google-chrome-stable",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    ] : []),
    ...(process.platform === "darwin" ? [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ] : []),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }
  return undefined;
}

export async function resolveCamoufoxExecutable() {
  const configured = process.env.BLOP_BROWSER_CAMOUFOX_EXECUTABLE_PATH;
  if (configured) {
    try {
      await access(configured);
      return configured;
    } catch {
      return undefined;
    }
  }
  try {
    const mod = await import("camoufox-js/dist/pkgman.js");
    const dir = mod.camoufoxPath(false) as string;
    const file = mod.OS_NAME === "win" ? "camoufox.exe"
      : mod.OS_NAME === "mac" ? "camoufox"
      : "camoufox-bin";
    const executablePath = join(dir.toString(), file);
    await access(executablePath);
    return executablePath;
  } catch {
    return undefined;
  }
}

async function createRuntimeFromBrowser(
  session: string,
  artifactDirectory: string,
  browserName: BrowserName,
  browser: Browser | undefined,
  context: BrowserContext,
  page: Page,
  initialPages: Page[],
  ownsContext: boolean,
  connection: "launch" | "cdp",
  cdpEndpoint?: string,
  closeLauncher?: () => Promise<void>,
  sessionScope?: BrowserSessionScope,
  initialTrace?: HarnessTraceExport | null,
  initialMetrics?: HarnessSessionMetrics | null,
  humanAccess: CliHumanAccess = Object.freeze({
    kind: "unavailable",
    instruction: "A human access path was not configured for this browser session.",
  }),
): Promise<HarnessCliRuntime> {
  const actions: HarnessAction[] = [];
  const browserLogs: HarnessBrowserLog[] = [];
  const finishState: FinishState = { status: null, reason: null };
  const pages: Page[] = [];
  let currentSessionScope = sessionScope;
  let closed = false;
  let activePage = page;
  let cachedPageStatus = {
    url: pageUrl(page),
    title: await page.title().catch(() => ""),
  };
  const browserVersion = resolvedBrowserVersion(browser, context);
  const safetyMode = process.env.BLOP_BROWSER_READ_ONLY === "1" ? "read-only" : "read-write";
  const control = createBrowserControlSession();
  const traceRecorder = createTraceRecorder({
    identity: {
      sessionId: session,
      ...(process.env.BLOP_BROWSER_AGENT_ID ? { agentId: process.env.BLOP_BROWSER_AGENT_ID } : {}),
    },
    ...(initialTrace ? { initialTrace } : {}),
  });
  const sessionMetricsRecorder = createSessionMetricsRecorder(
    initialMetrics ? { initialMetrics } : {},
  );
  let tracePersistence = Promise.resolve();
  let tracePersistenceFailures = 0;
  let lastTracePersistenceError: string | undefined;
  let metricsPersistence = Promise.resolve();
  let metricsPersistenceFailures = 0;
  let lastMetricsPersistenceError: string | undefined;
  let metricsExportFailures = 0;
  let lastMetricsExportError: string | undefined;
  const persistTrace = async () => {
    const json = traceRecorder.json(true);
    const timeline = traceRecorder.timeline();
    tracePersistence = tracePersistence
      .catch(() => undefined)
      .then(() => persistCliTrace(artifactDirectory, json, timeline));
    try {
      await tracePersistence;
    } catch (error) {
      tracePersistenceFailures += 1;
      lastTracePersistenceError = safeEvidenceError("Trace persistence", error);
    }
  };
  const persistMetrics = async () => {
    let json: string;
    try {
      json = sessionMetricsRecorder.json(true);
    } catch (error) {
      metricsExportFailures += 1;
      lastMetricsExportError = safeEvidenceError("Metrics export", error);
      const latestAction = actions.at(-1);
      if (latestAction) {
        latestAction.metadata = {
          ...latestAction.metadata,
          metricsExportError: lastMetricsExportError,
        };
      }
      return;
    }
    metricsPersistence = metricsPersistence
      .catch(() => undefined)
      .then(() => persistCliMetrics(artifactDirectory, json));
    try {
      await metricsPersistence;
    } catch (error) {
      metricsPersistenceFailures += 1;
      lastMetricsPersistenceError = safeEvidenceError(
        "Metrics persistence",
        error,
      );
    }
  };
  const persistEvidence = async () => {
    await Promise.all([persistTrace(), persistMetrics()]);
  };

  const attachPage = (candidate: Page) => {
    if (pages.includes(candidate)) return;
    pages.push(candidate);
    candidate.on("console", (message) => browserLogs.push({
      type: "console",
      level: message.type(),
      message: message.text(),
      timestamp: new Date().toISOString(),
    }));
    candidate.on("pageerror", (error) => browserLogs.push({
      type: "pageerror",
      message: error.message,
      timestamp: new Date().toISOString(),
    }));
    candidate.on("requestfailed", (request) => browserLogs.push({
      type: "requestfailed",
      message: request.failure()?.errorText ?? "Request failed",
      url: request.url(),
      timestamp: new Date().toISOString(),
    }));
    candidate.on("close", () => {
      const index = pages.indexOf(candidate);
      if (index >= 0) pages.splice(index, 1);
    });
  };
  for (const candidate of initialPages) attachPage(candidate);
  context.on("page", attachPage);

  const tools = await createBrowserTools({
    page,
    pages,
    testId: session,
    screenshotDir: artifactDirectory,
    actions,
    screenshots: [],
    finishState,
    browserLogs,
    safety: { mode: safetyMode },
    control,
    traceRecorder,
    sessionMetricsRecorder,
    setActivePage: (next) => {
      activePage = next;
      cachedPageStatus = { ...cachedPageStatus, url: pageUrl(next) || cachedPageStatus.url };
    },
    onAction: (action) => {
      // A rejected automation command must not indirectly touch Playwright
      // through the live progress hook while human control owns the session.
      const url = action.metadata?.controlBlocked === true ? "" : pageUrl(activePage);
      cachedPageStatus = {
        url: url || cachedPageStatus.url,
        title: typeof action.metadata?.title === "string"
          ? action.metadata.title
          : cachedPageStatus.title,
      };
    },
  });
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  recordSessionEvent(traceRecorder, "browser_session_start", cachedPageStatus.url, {
    browser: browserName,
    connection,
    profileMode: currentSessionScope?.mode ?? "unknown",
    existingProfile: connection === "cdp",
  }, "Browser session started.");
  await persistEvidence();

  return {
    call: async (name, input) => {
      const tool = byName.get(name);
      if (!tool) throw new Error(`Unknown browser tool "${name}". Run blop-browser tools to list available tools.`);
      try {
        return await tool.execute(input);
      } finally {
        await persistEvidence();
      }
    },
    listTools: () => tools.map(({ name, description }) => ({ name, description })),
    describeTool: (name) => {
      const tool = byName.get(name);
      if (!tool) throw new Error(`Unknown browser tool "${name}".`);
      return {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        promptSnippet: tool.promptSnippet,
      };
    },
    status: async () => {
      let livePageStatus: typeof cachedPageStatus | undefined;
      try {
        livePageStatus = await control.runAutomation("browser-status", async () => ({
          url: pageUrl(activePage) || cachedPageStatus.url,
          title: await activePage.title().catch(() => cachedPageStatus.title),
        }));
        cachedPageStatus = livePageStatus;
      } catch (error) {
        if (!(error instanceof BrowserControlError)) throw error;
      }
      const trace = traceRecorder.snapshot();
      return {
        session,
        browser: browserName,
        browserVersion,
        connection,
        cdpEndpoint: cdpEndpoint ? displayCdpEndpoint(cdpEndpoint) : null,
        cdpEndpointIdentity: cdpEndpoint ? identifyCdpEndpoint(cdpEndpoint) : null,
        pid: process.pid,
        url: cachedPageStatus.url,
        title: cachedPageStatus.title,
        pageState: livePageStatus ? "live" : "cached",
        pages: pages.length,
        actions: actions.length,
        traceEvents: trace.events.length,
        traceOmittedEvents: trace.omittedEvents,
        traceRecordingErrors: actions.filter((action) => action.metadata?.traceRecordingError).length,
        metricsRecordingErrors: actions.filter((action) => action.metadata?.metricsRecordingError).length,
        metricsExportFailures,
        tracePersistenceFailures,
        metricsPersistenceFailures,
        lastTracePersistenceError: lastTracePersistenceError ?? null,
        lastMetricsPersistenceError: lastMetricsPersistenceError ?? null,
        lastMetricsExportError: lastMetricsExportError ?? null,
        traceFiles: cliTracePaths(artifactDirectory),
        metricsFile: cliMetricsPath(artifactDirectory),
        finishState,
        artifactDirectory,
        sessionScope: currentSessionScope ? { ...currentSessionScope } : undefined,
        privacy: currentSessionScope
          ? createCliSessionPrivacySummary(session, currentSessionScope, cdpEndpoint)
          : undefined,
        safetyMode,
        control: control.status(),
        humanAccess,
      };
    },
    trace: () => traceRecorder.snapshot(),
    metrics: () => sessionMetricsRecorder.snapshot(),
    requestTakeover: async (input) => {
      if (humanAccess.kind === "unavailable") {
        throw new BrowserControlError({
          code: "takeover_unavailable",
          state: control.status().state,
          command: "request-takeover",
          message: "Human takeover requires a headed managed browser or attached external browser. Restart headed or attach a configured browser.",
        });
      }
      const takeoverStatus = await control.requestTakeover(input);
      await persistEvidence();
      return { control: takeoverStatus, access: humanAccess };
    },
    takeControl: async (requestId) => {
      const lease = control.takeControl({ requestId });
      await persistEvidence();
      return { control: control.status(), access: humanAccess, lease };
    },
    resumeAutomation: async (input) => {
      const resumed = control.resumeAutomation(input);
      const pageAvailable = pages.some((candidate) =>
        typeof candidate.isClosed !== "function" || !candidate.isClosed());
      await persistEvidence();
      return { control: resumed, pageAvailable };
    },
    setExpiresAt: (expiresAt) => {
      if (currentSessionScope) currentSessionScope = { ...currentSessionScope, expiresAt };
    },
    close: async (reason = "close") => {
      if (closed) return undefined;
      closed = true;
      control.close();
      const traceEvent = recordSessionEvent(
        traceRecorder,
        reason === "destroy" ? "browser_session_destroy" : "browser_session_close",
        cachedPageStatus.url,
        { reason, profileMode: currentSessionScope?.mode ?? "unknown" },
        reason === "destroy" ? "Browser session state destroyed." : "Browser session closed.",
      );
      await persistEvidence();
      if (ownsContext) await context.close().catch(() => undefined);
      await browser?.close().catch(() => undefined);
      await closeLauncher?.().catch(() => undefined);
      if (currentSessionScope?.mode === "disposable") {
        await Promise.all([
          rm(currentSessionScope.profileDirectory!, { recursive: true, force: true }),
          rm(currentSessionScope.downloadsDirectory!, { recursive: true, force: true }),
          rm(currentSessionScope.artifactDirectory, { recursive: true, force: true }),
        ]);
      }
      return traceEvent;
    },
  };
}

function recordSessionEvent(
  recorder: ReturnType<typeof createTraceRecorder>,
  name: "browser_session_start" | "browser_session_close" | "browser_session_destroy",
  url: string,
  input: Record<string, unknown>,
  output: string,
) {
  const timestamp = new Date().toISOString();
  return recorder.record({
    name,
    input,
    output,
    outputBoundary: { source: "harness", trust: "trusted" },
    timestamp,
    durationMs: 0,
  }, {
    startedAt: timestamp,
    completedAt: timestamp,
    urlBefore: url,
    urlAfter: url,
    stateChanging: true,
  });
}

function pageUrl(page: Page) {
  try {
    return page.url();
  } catch {
    return "";
  }
}

function safeEvidenceError(operation: string, error: unknown) {
  const name = error instanceof Error ? error.name : typeof error;
  const safeName = String(name).replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) || "unknown";
  return `${operation} failed (${safeName}).`;
}

function resolvedBrowserVersion(
  browser: Browser | undefined,
  context: BrowserContext,
) {
  try {
    return browser?.version() ?? context.browser()?.version() ?? null;
  } catch {
    return null;
  }
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
