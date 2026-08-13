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
  setExpiresAt: (expiresAt: string | null) => void;
  close: (reason?: "close" | "destroy" | "idle") => Promise<HarnessTraceEvent | undefined>;
};

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
): Promise<HarnessCliRuntime> {
  const actions: HarnessAction[] = [];
  const browserLogs: HarnessBrowserLog[] = [];
  const finishState: FinishState = { status: null, reason: null };
  const pages: Page[] = [];
  let currentSessionScope = sessionScope;
  let closed = false;
  const safetyMode = process.env.BLOP_BROWSER_READ_ONLY === "1" ? "read-only" : "read-write";
  const traceRecorder = createTraceRecorder({
    identity: {
      sessionId: session,
      ...(process.env.BLOP_BROWSER_AGENT_ID ? { agentId: process.env.BLOP_BROWSER_AGENT_ID } : {}),
    },
    ...(initialTrace ? { initialTrace } : {}),
  });
  let tracePersistence = Promise.resolve();
  let tracePersistenceFailures = 0;
  let lastTracePersistenceError: string | undefined;
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
      lastTracePersistenceError = safePersistenceError(error);
    }
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
    traceRecorder,
  });
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  recordSessionEvent(traceRecorder, "browser_session_start", page, {
    browser: browserName,
    connection,
    profileMode: currentSessionScope?.mode ?? "unknown",
    existingProfile: connection === "cdp",
  }, "Browser session started.");
  await persistTrace();

  return {
    call: async (name, input) => {
      const tool = byName.get(name);
      if (!tool) throw new Error(`Unknown browser tool "${name}". Run blop-browser tools to list available tools.`);
      try {
        return await tool.execute(input);
      } finally {
        await persistTrace();
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
      const trace = traceRecorder.snapshot();
      return {
        session,
        browser: browserName,
        connection,
        cdpEndpoint: cdpEndpoint ?? null,
        pid: process.pid,
        url: page.url(),
        title: await page.title().catch(() => ""),
        pages: pages.length,
        actions: actions.length,
        traceEvents: trace.events.length,
        traceOmittedEvents: trace.omittedEvents,
        traceRecordingErrors: actions.filter((action) => action.metadata?.traceRecordingError).length,
        tracePersistenceFailures,
        lastTracePersistenceError: lastTracePersistenceError ?? null,
        traceFiles: cliTracePaths(artifactDirectory),
        finishState,
        artifactDirectory,
        sessionScope: currentSessionScope ? { ...currentSessionScope } : undefined,
        safetyMode,
      };
    },
    trace: () => traceRecorder.snapshot(),
    setExpiresAt: (expiresAt) => {
      if (currentSessionScope) currentSessionScope = { ...currentSessionScope, expiresAt };
    },
    close: async (reason = "close") => {
      if (closed) return undefined;
      closed = true;
      const traceEvent = recordSessionEvent(
        traceRecorder,
        reason === "destroy" ? "browser_session_destroy" : "browser_session_close",
        page,
        { reason, profileMode: currentSessionScope?.mode ?? "unknown" },
        reason === "destroy" ? "Browser session state destroyed." : "Browser session closed.",
      );
      await persistTrace();
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
  page: Page,
  input: Record<string, unknown>,
  output: string,
) {
  const timestamp = new Date().toISOString();
  const url = pageUrl(page);
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

function safePersistenceError(error: unknown) {
  const name = error instanceof Error ? error.name : typeof error;
  const safeName = String(name).replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) || "unknown";
  return `Trace persistence failed (${safeName}).`;
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
