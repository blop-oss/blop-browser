import type { Page, Request } from "playwright";
import type {
  HarnessAction,
  HarnessBrowserLog,
  HarnessCriticalPoint,
  HarnessScreenshot,
  TestStatus,
} from "../types.js";
import type { TraceRecorder } from "../trace-recorder.js";

export type NativeModelImage = {
  /** Data URL kept out of the textual tool result and attached to the next
   * model turn as multimodal evidence. */
  dataUrl: string;
  caption?: string;
  detail?: "auto" | "low" | "high";
};

export type NativeToolResult = Promise<{
  content: string;
  metadata?: Record<string, unknown>;
  modelImages?: NativeModelImage[];
}>;

export type NativeToolBridge = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  promptSnippet: string;
  execute: (input: Record<string, unknown>) => NativeToolResult;
};

export type FinishState = {
  status: TestStatus | null;
  reason: string | null;
};

export type NetworkActivity = {
  inflight: Map<Request, string>;
  lastActivity: number;
};

export type BrowserToolContext = {
  page: Page;
  testId: string;
  screenshotDir: string;
  actions: HarnessAction[];
  screenshots: string[];
  screenshotArtifacts: HarnessScreenshot[];
  criticalPoints: HarnessCriticalPoint[];
  finishState: FinishState;
  baseUrl?: string;
  /** Optional bounded action trace sink. The central record path emits every
   * successful and failed tool action to it in completion order. */
  traceRecorder?: TraceRecorder;
  /**
   * Console/pageerror/requestfailed entries collected by the host's page
   * listeners. When provided, the browser_console_logs tool lets the agent
   * read them as evidence; without it the tool reports capture as disabled.
   */
  browserLogs?: HarnessBrowserLog[];
  /** Fired after each browser action is recorded, for live progress streaming. */
  onAction?: (action: HarnessAction) => void;
  /**
   * When true, capture a compact JPEG of the page after every action and attach
   * its path to the action metadata (stepScreenshotPath). Gives a visual trail
   * of what the agent did. Off by default so CI runs are not slowed.
   */
  captureStepScreenshots?: boolean;
  /**
   * Returns the latest live screencast frame, if a stream is active. When
   * present, per-action step screenshots are served from this in-memory frame
   * (~0.1ms) instead of a blocking page.screenshot() (~30-40ms+). Null before
   * the first repaint or on non-chromium browsers, where we fall back to a
   * direct screenshot.
   */
  liveFrame?: () => { data: Buffer; seq?: number; timestamp?: number } | null;
  /**
   * All open pages/tabs in this browser context, including popups opened by
   * the app via window.open or target=_blank. The first entry is the main
   * page; popups are appended in the order they open. Used by
   * browser_list_pages and browser_select_page so the agent can discover and
   * interact with popups it would otherwise be blind to.
   */
  pages?: Page[];
  /**
   * Switch the active page tools operate on. Called by browser_select_page
   * (and by the host when auto-tracking popups). Mutates `page` in place so
   * every tool reads the newly active page on its next execute.
   */
  setActivePage?: (page: Page) => void;
  /**
   * Returns the page tools currently operate on. The host may wrap `page`
   * in a forwarding proxy so it can swap the underlying page without
   * rebuilding the tools; this getter returns the real underlying Page so
   * identity comparisons against entries in `pages` work.
   */
  getActivePage?: () => Page;
  /** Network requests observed for the active page since tool creation. */
  getNetworkActivity: () => NetworkActivity;
  record: (
    name: string,
    input: Record<string, unknown>,
    fn: () => NativeToolResult,
  ) => NativeToolResult;
};
