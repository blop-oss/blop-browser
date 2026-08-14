import { afterAll } from "bun:test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createBrowserTools } from "../../src/create-tools.js";
import type { HarnessAction } from "../../src/types.js";
import type { BrowserSafetyPolicy } from "../../src/tools/types.js";
import type { TraceRecorder } from "../../src/trace-recorder.js";
import type { BrowserControlSession } from "../../src/session/control.js";
import type { SessionMetricsRecorder } from "../../src/session-metrics.js";
import { startFixtureServer, type FixtureRoute } from "../fixtures/server.js";

let sharedBrowser: Browser | undefined;

afterAll(async () => {
  await sharedBrowser?.close();
  sharedBrowser = undefined;
});

export async function setupToolPage(
  body: string,
  extraRoutes: FixtureRoute[] = [],
  options: {
    safety?: BrowserSafetyPolicy;
    control?: BrowserControlSession;
    traceRecorder?: TraceRecorder;
    sessionMetricsRecorder?: SessionMetricsRecorder;
    captureStepScreenshots?: boolean;
    liveFrame?: () => { data: Buffer; seq?: number; timestamp?: number } | null;
    configureContext?: (
      context: BrowserContext,
      page: Page,
      serverUrl: string,
    ) => void | Promise<void>;
  } = {},
) {
  const server = await startFixtureServer([
    { path: "/", body },
    { path: "/next", body: `<h1>Next page</h1>` },
    ...extraRoutes,
  ]);
  if (!sharedBrowser?.isConnected()) sharedBrowser = await chromium.launch({ headless: true });
  const browser = sharedBrowser;
  const context = await browser.newContext({ bypassCSP: true });
  const page = await context.newPage();
  await options.configureContext?.(context, page, server.url);
  const pages: Page[] = [page];
  context.on("page", (popup) => {
    pages.push(popup);
    popup.on("close", () => {
      const index = pages.indexOf(popup);
      if (index >= 0) pages.splice(index, 1);
    });
  });
  const actions: HarnessAction[] = [];
  const tools = await createBrowserTools({
    page,
    pages,
    testId: "test_browser_tools",
    screenshotDir: ".blop-test-screenshots",
    actions,
    screenshots: [],
    finishState: { status: null, reason: null },
    safety: options.safety,
    control: options.control,
    traceRecorder: options.traceRecorder,
    sessionMetricsRecorder: options.sessionMetricsRecorder,
    captureStepScreenshots: options.captureStepScreenshots,
    liveFrame: options.liveFrame,
  });
  await tool(tools, "browser_goto").execute({ url: server.url });

  return {
    page,
    actions,
    tools,
    serverUrl: server.url,
    cleanup: async () => {
      await context.close();
      await server.close();
    },
  };
}

export function tool(tools: Awaited<ReturnType<typeof createBrowserTools>>, name: string) {
  const found = tools.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Missing tool: ${name}`);
  return found;
}
