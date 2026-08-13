import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page, Request } from "playwright";
import { createAssertionTools } from "./tools/assertions.js";
import { createBatchTool } from "./tools/batch.js";
import { createExtractTools } from "./tools/extract.js";
import { createFormTools } from "./tools/forms.js";
import { createKeyboardTools } from "./tools/keyboard.js";
import { createLifecycleTools } from "./tools/lifecycle.js";
import { createLogTools } from "./tools/logs.js";
import { createMouseTools } from "./tools/mouse.js";
import { createNavigationTools } from "./tools/navigation.js";
import { createPageTools } from "./tools/page.js";
import { createTabTools } from "./tools/tabs.js";
import type { HarnessAction } from "./types.js";
import type { BrowserToolContext, NativeToolBridge, NativeToolResult, NetworkActivity } from "./tools/types.js";
import { captureActionState, describeActionOutcome } from "./tools/action-outcome.js";
import {
  BROWSER_TOOL_CONTENT_KINDS,
  BrowserSafetyError,
  browserModelImages,
  browserToolError,
  defaultToolContentBoundary,
  enforceBrowserSafety,
  mixedContentBoundary,
} from "./tools/safety.js";

const OUTCOME_TOOLS = new Set([
  "browser_goto", "browser_go_back", "browser_go_forward", "browser_reload",
  "browser_click", "browser_double_click", "browser_right_click", "browser_drag_and_drop",
  "browser_click_at",
  "browser_type", "browser_press", "browser_clear", "browser_check", "browser_uncheck",
  "browser_select_option", "browser_upload_file",
]);

export type { FinishState, NativeToolBridge } from "./tools/types.js";

export async function createBrowserTools(
  options: Omit<BrowserToolContext, "record" | "screenshotArtifacts" | "criticalPoints" | "setActivePage" | "getActivePage" | "getNetworkActivity"> & Partial<Pick<BrowserToolContext, "screenshotArtifacts" | "criticalPoints" | "setActivePage" | "getActivePage">>,
): Promise<NativeToolBridge[]> {
  await mkdir(options.screenshotDir, { recursive: true });

  // The active page tools operate on. Held in a mutable ref so the host (or
  // the browser_select_page tool) can swap it without rebuilding the tools:
  // every tool reads `context.page` at execute time, so mutating `ref.page`
  // propagates to all of them on the next call.
  const ref: { page: Page } = { page: options.page };
  const networkActivity = new WeakMap<Page, NetworkActivity>();
  const activityFor = (page: Page) => {
    let activity = networkActivity.get(page);
    if (activity) return activity;
    activity = { inflight: new Map(), lastActivity: Date.now() };
    networkActivity.set(page, activity);
    if (typeof page.on !== "function") return activity;
    page.on("request", (request) => {
      activity!.inflight.set(request, request.url());
      activity!.lastActivity = Date.now();
    });
    const complete = (request: Request) => {
      activity!.inflight.delete(request);
      activity!.lastActivity = Date.now();
    };
    page.on("requestfinished", complete);
    page.on("requestfailed", complete);
    return activity;
  };
  activityFor(ref.page);

  const context: BrowserToolContext = {
    ...options,
    get page() {
      return ref.page;
    },
    set page(next: Page) {
      ref.page = next;
      activityFor(next);
    },
    screenshotArtifacts: options.screenshotArtifacts ?? [],
    criticalPoints: options.criticalPoints ?? [],
    setActivePage: (next: Page) => {
      ref.page = next;
      activityFor(next);
      options.setActivePage?.(next);
    },
    getActivePage: () => ref.page,
    getNetworkActivity: () => activityFor(ref.page),
    record: async (name, input, fn): NativeToolResult => {
      const startedAt = performance.now();
      let before = null;
      let result: Awaited<NativeToolResult>;
      try {
        await enforceBrowserSafety({
          page: ref.page,
          testId: options.testId,
          safety: options.safety,
          toolName: name,
          input,
        });
        before = OUTCOME_TOOLS.has(name) ? await captureActionState(ref.page) : null;
        const payload = await fn();
        result = {
          content: payload.content,
          ...(payload.metadata ? { metadata: payload.metadata } : {}),
          ...(payload.modelImages ? {
            modelImages: browserModelImages(ref.page, payload.modelImages),
          } : {}),
          contentBoundary: defaultToolContentBoundary(name, ref.page),
        };
      } catch (error) {
        const toolError = browserToolError(error, ref.page);
        const message = toolError.message;
        const action: HarnessAction = {
          name,
          input,
          output: message,
          outputBoundary: toolError.contentBoundary,
          metadata: {
            error: message,
            ...(toolError instanceof BrowserSafetyError ? {
              policyBlocked: true,
              policyCode: toolError.code,
              policyTool: toolError.toolName,
              policyCategory: toolError.category,
            } : {}),
          },
          timestamp: new Date().toISOString(),
          durationMs: elapsed(startedAt),
        };
        options.actions.push(action);
        options.onAction?.(action);
        throw toolError;
      }
      if (before) {
        const outcome = describeActionOutcome(before, await captureActionState(ref.page));
        if (outcome) {
          result = {
            ...result,
            content: `${result.content}\n\nOutcome: ${outcome}`,
            contentBoundary: mixedContentBoundary(ref.page),
            metadata: { ...result.metadata, outcome },
          };
        }
      }
      const action: HarnessAction = {
        name,
        input,
        output: result.content,
        outputBoundary: result.contentBoundary,
        metadata: result.metadata,
        timestamp: new Date().toISOString(),
        durationMs: elapsed(startedAt),
      };
      // Attach a compact JPEG of the resulting page state so the host can show
      // a visual trail of each step. Prefer the live screencast frame already in
      // memory — writing it costs ~0.1ms and keeps the agent's critical path
      // free of a ~30-40ms (or worse) blocking page.screenshot(). Only fall back
      // to a direct screenshot when no stream frame exists yet (first action, or
      // a non-chromium browser). Best-effort: the page may be mid-navigation or
      // already closed (e.g. finish_test), so failures are swallowed.
      if (options.captureStepScreenshots) {
        const shotPath = join(options.screenshotDir, `step-${options.actions.length + 1}.jpg`);
        const frame = options.liveFrame?.();
        try {
          if (frame) {
            await writeFile(shotPath, frame.data);
          } else {
            await ref.page.screenshot({ path: shotPath, type: "jpeg", quality: 45 });
          }
          action.metadata = { ...action.metadata, stepScreenshotPath: shotPath };
        } catch {
          // Page not screenshot-able right now; skip the visual for this step.
        }
      }
      options.actions.push(action);
      options.onAction?.(action);
      return result;
    },
  };

  const tools = [
    ...createNavigationTools(context),
    ...createMouseTools(context),
    ...createKeyboardTools(context),
    ...createFormTools(context),
    ...createPageTools(context),
    ...createTabTools(context),
    ...createAssertionTools(context),
    ...createExtractTools(context),
    ...createLogTools(context),
    ...createLifecycleTools(context),
  ];

  const allTools = [...tools, createBatchTool(tools, context)];
  const unclassified = allTools
    .map((tool) => tool.name)
    .filter((name) => !(name in BROWSER_TOOL_CONTENT_KINDS));
  if (unclassified.length) {
    throw new Error(`Browser tool content-boundary classification is missing for: ${unclassified.join(", ")}`);
  }

  // The batch tool replays the other tools by name, so it is built last from
  // the finished list. Inner steps record their own actions, keeping the
  // visual trail and live progress stream identical to unbatched execution.
  return allTools;
}

function elapsed(startedAt: number) {
  return Math.max(0, Number((performance.now() - startedAt).toFixed(1)));
}
