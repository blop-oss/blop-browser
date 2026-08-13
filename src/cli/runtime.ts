import "../session/bun-ws-compat.js";
import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from "playwright";
import { createBrowserTools } from "../create-tools.js";
import type { HarnessAction, HarnessBrowserLog } from "../types.js";
import type { FinishState, NativeToolBridge } from "../tools/types.js";

export type BrowserName = "chromium" | "camoufox";

type LaunchedBrowser = {
  browser: Browser;
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
  close: () => Promise<void>;
};

export async function createHarnessCliRuntime(
  session: string,
  artifactDirectory: string,
  browserName: BrowserName = "chromium",
  cdpEndpoint?: string,
): Promise<HarnessCliRuntime> {
  await mkdir(artifactDirectory, { recursive: true });
  const headless = process.env.BLOP_BROWSER_HEADLESS !== "0";
  let launched: LaunchedBrowser;
  if (cdpEndpoint) launched = await connectChromeOverCdp(cdpEndpoint);
  else if (browserName === "camoufox") launched = await launchCamoufox(headless);
  else launched = await launchChromium(headless);
  const browser = launched.browser;
  const contextOptions: BrowserContextOptions = { bypassCSP: true };
  if (browserName === "camoufox") contextOptions.viewport = null;
  const context = launched.context ?? await browser.newContext(contextOptions);
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
  );
}

async function launchChromium(headless: boolean): Promise<LaunchedBrowser> {
  const executablePath = await resolveBrowserExecutable();
  return { browser: await chromium.launch({ headless, ...(executablePath ? { executablePath } : {}) }) };
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

async function launchCamoufox(headless: boolean): Promise<LaunchedBrowser> {
  if (process.versions.bun) {
    throw new Error("Camoufox must run under Node.js. Start it through the blop-browser CLI.");
  }
  const { Camoufox } = await import("camoufox-js");
  const executablePath = process.env.BLOP_BROWSER_CAMOUFOX_EXECUTABLE_PATH;
  try {
    return {
      browser: await Camoufox({
        headless,
        ...(executablePath ? { executable_path: executablePath } : {}),
      }) as Browser,
    };
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
  browser: Browser,
  context: BrowserContext,
  page: Page,
  initialPages: Page[],
  ownsContext: boolean,
  connection: "launch" | "cdp",
  cdpEndpoint?: string,
  closeLauncher?: () => Promise<void>,
): Promise<HarnessCliRuntime> {
  const actions: HarnessAction[] = [];
  const browserLogs: HarnessBrowserLog[] = [];
  const finishState: FinishState = { status: null, reason: null };
  const pages: Page[] = [];
  let closed = false;
  const safetyMode = process.env.BLOP_BROWSER_READ_ONLY === "1" ? "read-only" : "read-write";

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
  });
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  return {
    call: async (name, input) => {
      const tool = byName.get(name);
      if (!tool) throw new Error(`Unknown browser tool "${name}". Run blop-browser tools to list available tools.`);
      return await tool.execute(input);
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
    status: async () => ({
      session,
      browser: browserName,
      connection,
      cdpEndpoint: cdpEndpoint ?? null,
      pid: process.pid,
      url: page.url(),
      title: await page.title().catch(() => ""),
      pages: pages.length,
      actions: actions.length,
      finishState,
      artifactDirectory,
      safetyMode,
    }),
    close: async () => {
      if (closed) return;
      closed = true;
      if (ownsContext) await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
      await closeLauncher?.().catch(() => undefined);
    },
  };
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
