import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import {
  createBrowserTools,
  createSessionMetricsRecorder,
  type HarnessSessionMetrics,
  type FinishState,
  type HarnessAction,
  type NativeToolBridge,
} from "../../src/index.js";

export type Mind2WebTask = {
  id: string | null;
  split: string;
  website: string;
  domain?: string | null;
  subdomain?: string | null;
  task: string;
  start_url: string;
  num_actions?: number;
  action_reprs?: string[];
};

export type Mind2WebFilters = {
  id?: string;
  split?: string;
  website?: string;
  limit?: number;
};

export type Mind2WebAgentInput = {
  task: Mind2WebTask;
  prompt: string;
  page: Page;
  tools: NativeToolBridge[];
};

export type Mind2WebAgentAdapter = {
  name: string;
  run(input: Mind2WebAgentInput): Promise<void>;
};

export type Mind2WebTaskResult = {
  task: Mind2WebTask;
  agent: string;
  status: FinishState["status"];
  reason: string | null;
  actions: HarnessAction[];
  durationMs: number;
  sessionMetrics: HarnessSessionMetrics;
};

export function loadMind2WebTasks(
  tasksPath: string,
  filters: Mind2WebFilters = {},
): Mind2WebTask[] {
  const all = JSON.parse(readFileSync(resolve(tasksPath), "utf8")) as Mind2WebTask[];
  const website = filters.website?.trim().toLowerCase();
  let tasks = all.filter((task) => task.task && task.start_url);

  if (filters.id) tasks = tasks.filter((task) => task.id === filters.id);
  if (filters.split) tasks = tasks.filter((task) => task.split === filters.split);
  if (website) {
    tasks = tasks.filter((task) => task.website.toLowerCase().includes(website));
  }
  if (filters.limit && Number.isFinite(filters.limit)) {
    tasks = tasks.slice(0, filters.limit);
  }
  return tasks;
}

export function buildMind2WebPrompt(task: Mind2WebTask): string {
  return (
    `On ${task.start_url}, complete this task the way a real user would:\n\n` +
    `${task.task}\n\n` +
    "Work step by step using the live page. Tool errors invalidate the run: " +
    "copy exact URLs, titles, and visible phrases already reported by the tools; " +
    "do not invent connective text. After navigation, never reuse a ref from the " +
    "previous page—take a fresh snapshot or omit an optional target. Immediately before " +
    "finishing, take one final browser_snapshot after the last state-changing action; " +
    "the automated evaluator uses that observation as final-page evidence. When the task is complete, call " +
    "finish_test with passed status. If the site is unreachable or the task is " +
    "blocked by a login, paywall, or captcha, call finish_test with failed status " +
    "and a short reason."
  );
}

export function resolveMind2WebAntiBot(value?: string): "off" | "on" {
  const raw = value
    ?? process.env.BLOP_BROWSER_ANTI_BOT
    ?? process.env.MIND2WEB_ANTI_BOT
    ?? "on";
  if (raw === "off" || raw === "on") return raw;
  throw new Error('Mind2Web anti-bot must be "on" or "off".');
}

export async function runMind2WebTask(options: {
  task: Mind2WebTask;
  agent: Mind2WebAgentAdapter;
  browser?: Browser;
  antiBot?: "off" | "on";
  screenshotDir?: string;
}): Promise<Mind2WebTaskResult> {
  const startedAt = Date.now();
  const antiBot = options.antiBot ?? resolveMind2WebAntiBot();
  let ownedBrowser: Browser | undefined;
  let context: BrowserContext | undefined;
  const sessionMetricsRecorder = createSessionMetricsRecorder();

  try {
    if (options.browser) {
      context = await options.browser.newContext({ bypassCSP: true });
    } else if (antiBot === "on") {
      context = await launchMind2WebCamoufox();
    } else {
      ownedBrowser = await chromium.launch({ headless: true });
      context = await ownedBrowser.newContext({ bypassCSP: true });
    }
    const page = context.pages().at(-1) ?? await context.newPage();
    const actions: HarnessAction[] = [];
    const finishState: FinishState = { status: null, reason: null };
    const tools = await createBrowserTools({
      page,
      testId: options.task.id ?? "mind2web-task",
      screenshotDir: options.screenshotDir ?? ".mind2web/screenshots",
      actions,
      screenshots: [],
      finishState,
      sessionMetricsRecorder,
    });

    await options.agent.run({
      task: options.task,
      prompt: buildMind2WebPrompt(options.task),
      page,
      tools,
    });

    return {
      task: options.task,
      agent: options.agent.name,
      status: finishState.status,
      reason: finishState.reason,
      actions,
      durationMs: Date.now() - startedAt,
      sessionMetrics: sessionMetricsRecorder.snapshot(),
    };
  } finally {
    await context?.close();
    await ownedBrowser?.close();
  }
}

async function launchMind2WebCamoufox(): Promise<BrowserContext> {
  const { Camoufox } = await import("camoufox-js");
  const executablePath = process.env.BLOP_BROWSER_CAMOUFOX_EXECUTABLE_PATH;
  const context = await Camoufox({
    headless: process.env.BLOP_BROWSER_HEADLESS !== "0",
    bypassCSP: true,
    viewport: null,
    ...(executablePath ? { executable_path: executablePath } : {}),
  });
  return context as BrowserContext;
}
