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
import type { SessionMetricsRecorder } from "./session-metrics.js";
import type { BrowserToolContext, NativeToolBridge, NativeToolResult, NetworkActivity } from "./tools/types.js";
import { captureActionState, describeActionOutcome } from "./tools/action-outcome.js";
import {
  isStateChangingCommand,
  type TraceApproval,
  type TraceMediaPosition,
} from "./trace-recorder.js";
import {
  BROWSER_TOOL_CONTENT_KINDS,
  BrowserSafetyError,
  browserModelImages,
  browserToolError,
  defaultToolContentBoundary,
  compileBrowserSessionPolicy,
  enforceBrowserSafety,
  mixedContentBoundary,
} from "./tools/safety.js";
import {
  installNavigationPolicyGuard,
  type NavigationPolicyGuard,
} from "./tools/navigation-policy.js";
import { invalidatePageReferences } from "./tools/references.js";
import { BrowserControlError, type BrowserControlTransition } from "./session/control.js";

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
  const sessionPolicy = compileBrowserSessionPolicy(options.safety);
  await mkdir(options.screenshotDir, { recursive: true });
  let navigationPolicy: NavigationPolicyGuard;

  // The active page tools operate on. Held in a mutable ref so the host (or
  // the browser_select_page tool) can swap it without rebuilding the tools:
  // every tool reads `context.page` at execute time, so mutating `ref.page`
  // propagates to all of them on the next call.
  const ref: { page: Page } = { page: options.page };
  let cachedUrl = pageUrl(ref.page);
  let awaitingPostTakeoverPageReconciliation = false;
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
      const traceStartedAt = new Date().toISOString();
      let metricsRecordingError: string | undefined;
      const retry = () => {
        metricsRecordingError ??= recordMetricsRetry(
          options.sessionMetricsRecorder,
          name,
        );
      };
      const recordControlFailure = (error: BrowserControlError) => {
        const timestamp = new Date().toISOString();
        const action: HarnessAction = {
          name,
          input,
          output: error.message,
          outputBoundary: error.contentBoundary,
          metadata: {
            error: error.message,
            controlBlocked: true,
            controlCode: error.code,
            controlState: error.state,
            controlCommand: error.command,
            ...(error.requestId ? { controlRequestId: error.requestId } : {}),
            ...(metricsRecordingError ? { metricsRecordingError } : {}),
          },
          timestamp,
          durationMs: elapsed(startedAt),
        };
        const traceError = recordTrace(options.traceRecorder, action, {
          startedAt: traceStartedAt,
          completedAt: timestamp,
          urlBefore: cachedUrl,
          urlAfter: cachedUrl,
          stateChanging: isStateChangingCommand(name),
        });
        if (traceError) action.metadata = { ...action.metadata, traceRecordingError: traceError };
        const metricsError = recordSessionMetrics(
          options.sessionMetricsRecorder,
          action,
        );
        if (metricsError) {
          action.metadata = { ...action.metadata, metricsRecordingError: metricsError };
        }
        options.actions.push(action);
        options.onAction?.(action);
      };
      const executeAdmitted = async () => {
        try {
          reconcileActivePage(
            ref,
            options.pages,
            activityFor,
            options.setActivePage,
            awaitingPostTakeoverPageReconciliation,
          );
          awaitingPostTakeoverPageReconciliation = false;
        } catch (error) {
          if (error instanceof BrowserControlError) recordControlFailure(error);
          throw error;
        }
        const urlBefore = observePageUrl(ref.page, cachedUrl, (url) => { cachedUrl = url; });
        const navigationCheckpoint = navigationPolicy.checkpoint(ref.page);
        let navigationPolicySettled = false;
        const settleNavigationPolicy = () => {
          navigationPolicySettled = true;
          return navigationPolicy.settleViolation(navigationCheckpoint, name);
        };
        let before = null;
        let approval: TraceApproval | undefined;
        let result: Awaited<NativeToolResult>;
        try {
          const safetyDecision = await enforceBrowserSafety({
            page: ref.page,
            testId: options.testId,
            safety: sessionPolicy,
            baseUrl: options.baseUrl,
            toolName: name,
            input,
          });
          if (safetyDecision) {
            approval = {
              status: "approved",
              policy: "approval-policy",
              category: safetyDecision.category,
            };
          }
          before = OUTCOME_TOOLS.has(name) ? await captureActionState(ref.page) : null;
          const payload = await fn({ retry });
          const navigationViolation = settleNavigationPolicy();
          if (navigationViolation) throw navigationViolation;
          result = {
            content: payload.content,
            ...(payload.metadata ? { metadata: payload.metadata } : {}),
            ...(payload.modelImages ? {
              modelImages: browserModelImages(ref.page, payload.modelImages),
            } : {}),
            contentBoundary: defaultToolContentBoundary(name, ref.page),
          };
        } catch (error) {
          const navigationViolation = navigationPolicySettled
            ? undefined
            : settleNavigationPolicy();
          const toolError = browserToolError(navigationViolation ?? error, ref.page);
          const message = toolError.message;
          const timestamp = new Date().toISOString();
          const urlAfter = observePageUrl(ref.page, cachedUrl, (url) => { cachedUrl = url; });
          const action: HarnessAction = {
            name,
            input,
            output: message,
            outputBoundary: toolError.contentBoundary,
            metadata: {
              error: message,
              ...(metricsRecordingError ? { metricsRecordingError } : {}),
              ...(approval ? { approval } : {}),
              ...(toolError instanceof BrowserSafetyError ? {
                policyBlocked: true,
                policyCode: toolError.code,
                policyTool: toolError.toolName,
                policyCategory: toolError.category,
                policyDecision: toolError.decision,
                ...(toolError.phase ? { policyPhase: toolError.phase } : {}),
                ...(toolError.origin ? { policyOrigin: toolError.origin } : {}),
              } : {}),
            },
            timestamp,
            durationMs: elapsed(startedAt),
          };
          const traceError = recordTrace(options.traceRecorder, action, {
            startedAt: traceStartedAt,
            completedAt: timestamp,
            urlBefore,
            urlAfter,
            stateChanging: isStateChangingCommand(name),
            approval,
            media: traceMedia(undefined, options.liveFrame?.()),
          });
          if (traceError) action.metadata = { ...action.metadata, traceRecordingError: traceError };
          const metricsError = recordSessionMetrics(
            options.sessionMetricsRecorder,
            action,
          );
          if (metricsError) {
            action.metadata = { ...action.metadata, metricsRecordingError: metricsError };
          }
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
          metadata: {
            ...result.metadata,
            ...(approval ? { approval } : {}),
            ...(metricsRecordingError ? { metricsRecordingError } : {}),
          },
          timestamp: new Date().toISOString(),
          durationMs: elapsed(startedAt),
        };
        // Attach a compact JPEG of the resulting page state so the host can show
        // a visual trail of each step. Prefer the live screencast frame already in
        // memory and keep the agent's critical path free of a blocking
        // page.screenshot(). Only fall back
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
            action.metadata = {
              ...action.metadata,
              stepScreenshotPath: shotPath,
              traceScreenshotIndex: options.actions.length + 1,
              ...(typeof frame?.seq === "number" ? { screencastFrameSequence: frame.seq } : {}),
              ...(typeof frame?.timestamp === "number" ? { screencastFrameTimestamp: frame.timestamp } : {}),
            };
          } catch {
            // Page not screenshot-able right now; skip the visual for this step.
          }
        }
        const urlAfter = observePageUrl(ref.page, cachedUrl, (url) => { cachedUrl = url; });
        const traceError = recordTrace(options.traceRecorder, action, {
          startedAt: traceStartedAt,
          completedAt: action.timestamp,
          urlBefore,
          urlAfter,
          stateChanging: isStateChangingCommand(name),
          approval,
          media: traceMedia(action.metadata, options.liveFrame?.()),
        });
        if (traceError) action.metadata = { ...action.metadata, traceRecordingError: traceError };
        const metricsError = recordSessionMetrics(
          options.sessionMetricsRecorder,
          action,
          result.modelImages?.map((modelImage) => modelImage.dataUrl),
        );
        if (metricsError) {
          action.metadata = { ...action.metadata, metricsRecordingError: metricsError };
        }
        options.actions.push(action);
        options.onAction?.(action);
        return result;
      };

      if (!options.control) return await executeAdmitted();
      let admitted = false;
      try {
        return await options.control.runAutomation(name, async () => {
          admitted = true;
          return await executeAdmitted();
        });
      } catch (error) {
        if (!(error instanceof BrowserControlError) || admitted) throw error;
        recordControlFailure(error);
        throw error;
      }
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

  navigationPolicy = await installNavigationPolicyGuard(
    typeof options.page.context === "function" ? options.page.context() : undefined,
    sessionPolicy.domains,
  );

  options.control?.onTransition((transition) => {
    if (transition.type === "paused" || transition.type === "automation-resumed") {
      const pages = new Set([ref.page, ...(options.pages ?? [])]);
      for (const page of pages) invalidatePageReferences(page);
    }
    if (transition.type === "automation-resumed") {
      awaitingPostTakeoverPageReconciliation = true;
    }
    recordControlTransition(options.traceRecorder, transition, cachedUrl);
  });

  // The batch tool replays the other tools by name, so it is built last from
  // the finished list. Inner steps record their own actions, keeping the
  // visual trail and live progress stream identical to unbatched execution.
  return allTools;
}

function elapsed(startedAt: number) {
  return Math.max(0, Number((performance.now() - startedAt).toFixed(1)));
}

function pageUrl(page: Page) {
  try {
    return page.url();
  } catch {
    return "";
  }
}

function observePageUrl(page: Page, fallback: string, update: (url: string) => void) {
  const observed = pageUrl(page);
  if (observed) update(observed);
  return observed || fallback;
}

function reconcileActivePage(
  ref: { page: Page },
  pages: Page[] | undefined,
  activityFor: (page: Page) => NetworkActivity,
  notify: ((page: Page) => void) | undefined,
  afterTakeover: boolean,
) {
  if (typeof ref.page.isClosed !== "function" || !ref.page.isClosed()) return;
  const replacement = [...(pages ?? [])].reverse().find((page) =>
    typeof page.isClosed !== "function" || !page.isClosed());
  if (!replacement) {
    if (!afterTakeover) return;
    throw new BrowserControlError({
      code: "page_unavailable_after_takeover",
      state: "automation",
      command: "reconcile-page",
      message: "Human control closed every browser page. Supply a live page before the next automation command.",
    });
  }
  ref.page = replacement;
  activityFor(replacement);
  notify?.(replacement);
}

function recordControlTransition(
  recorder: BrowserToolContext["traceRecorder"],
  transition: BrowserControlTransition,
  cachedUrl: string,
) {
  // browser_session_close already captures terminal teardown; avoid a second
  // close event in every session that never entered takeover.
  if (!recorder || transition.type === "closed") return;
  const names = {
    "pause-requested": "browser_control_pause_requested",
    paused: "browser_control_paused",
    "human-control-acquired": "browser_control_human_acquired",
    "automation-resumed": "browser_control_automation_resumed",
  } as const;
  const input = {
    requestId: transition.requestId,
    reason: transition.reason,
    ...(transition.message ? {
      message: { redacted: true, type: "string", length: [...transition.message].length },
    } : {}),
    ...(transition.outcome ? { outcome: transition.outcome } : {}),
    revision: transition.revision,
  };
  recorder.record({
    name: names[transition.type],
    input,
    output: `Browser control changed from ${transition.from} to ${transition.to}.`,
    outputBoundary: { source: "harness", trust: "trusted" },
    timestamp: transition.timestamp,
    durationMs: 0,
  }, {
    startedAt: transition.timestamp,
    completedAt: transition.timestamp,
    urlBefore: cachedUrl,
    urlAfter: cachedUrl,
    stateChanging: true,
  });
}

function traceMedia(
  metadata: Record<string, unknown> | undefined,
  frame: { seq?: number; timestamp?: number } | null | undefined,
): TraceMediaPosition | undefined {
  const screenshotPath = typeof metadata?.stepScreenshotPath === "string"
    ? metadata.stepScreenshotPath
    : typeof metadata?.path === "string" ? metadata.path : undefined;
  const screenshotIndex = typeof metadata?.traceScreenshotIndex === "number"
    ? metadata.traceScreenshotIndex
    : undefined;
  const frameSequence = typeof metadata?.screencastFrameSequence === "number"
    ? metadata.screencastFrameSequence
    : frame?.seq;
  const frameTimestamp = typeof metadata?.screencastFrameTimestamp === "number"
    ? metadata.screencastFrameTimestamp
    : frame?.timestamp;
  if (!screenshotPath && frameSequence === undefined) return undefined;
  return {
    ...(screenshotPath ? {
      screenshot: {
        path: screenshotPath,
        ...(screenshotIndex !== undefined ? { index: screenshotIndex } : {}),
      },
    } : {}),
    ...(frameSequence !== undefined ? {
      screencast: {
        frame: frameSequence,
        ...(frameTimestamp !== undefined ? { timestamp: new Date(frameTimestamp).toISOString() } : {}),
      },
    } : {}),
  };
}

function recordTrace(
  recorder: BrowserToolContext["traceRecorder"],
  action: HarnessAction,
  context: Parameters<NonNullable<BrowserToolContext["traceRecorder"]>["record"]>[1],
) {
  if (!recorder) return;
  try {
    recorder.record(action, context);
  } catch (error) {
    // A recorder failure happens after the browser command has already run.
    // Surface it in the normal action trail without throwing and inviting a
    // host to retry a state-changing command.
    const name = error instanceof Error ? error.name : typeof error;
    const safeName = String(name).replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) || "unknown";
    return `Trace recorder failed (${safeName}).`;
  }
}

function recordSessionMetrics(
  recorder: SessionMetricsRecorder | undefined,
  action: HarnessAction,
  modelImageDataUrls?: readonly string[],
) {
  if (!recorder) return;
  try {
    recorder.recordAction(action, { modelImageDataUrls });
  } catch (error) {
    return metricsRecorderError(error);
  }
}

function recordMetricsRetry(
  recorder: SessionMetricsRecorder | undefined,
  command: string,
) {
  if (!recorder) return;
  try {
    recorder.recordRetry(command);
  } catch (error) {
    return metricsRecorderError(error);
  }
}

function metricsRecorderError(error: unknown) {
  const name = error instanceof Error ? error.name : typeof error;
  const safeName = String(name).replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80)
    || "unknown";
  return `Session metrics recorder failed (${safeName}).`;
}
