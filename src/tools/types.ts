import type { Page, Request } from "playwright";
import type {
  HarnessAction,
  HarnessBrowserLog,
  HarnessCriticalPoint,
  HarnessScreenshot,
  TestStatus,
  BrowserContentBoundary,
  ToolContentBoundary,
} from "../types.js";
import type { TraceRecorder } from "../trace-recorder.js";

export type NativeModelImage = {
  /** Data URL kept out of the textual tool result and attached to the next
   * model turn as multimodal evidence. */
  dataUrl: string;
  caption?: string;
  detail?: "auto" | "low" | "high";
  /** Images originate in the browser and must not bypass the text boundary. */
  contentBoundary: BrowserContentBoundary;
};

export type NativeModelImageInput = Omit<NativeModelImage, "contentBoundary">;

export type NativeToolPayload = {
  content: string;
  metadata?: Record<string, unknown>;
  modelImages?: NativeModelImageInput[];
};

export type NativeToolResult = Promise<Omit<NativeToolPayload, "modelImages"> & {
  /**
   * Provenance for the whole result. Browser and mixed content is always
   * untrusted; hosts must preserve this instead of promoting `content` into a
   * trusted instruction channel. Every attached model image also carries its
   * own browser boundary.
   */
  contentBoundary: ToolContentBoundary;
  modelImages?: NativeModelImage[];
}>;

export type BrowserActionCategory =
  | "navigation"
  | "pointer"
  | "keyboard"
  | "form"
  | "file-upload"
  | "page-lifecycle";

export type BrowserPolicyDecision = "allow" | "deny" | "ask";

export type BrowserDomainPolicy = {
  /**
   * Exact HTTP(S) origins or wildcard subdomains such as
   * `https://*.example.com`. A wildcard matches any subdomain depth, excludes
   * the apex, and uses the scheme and effective port in the rule.
   */
  allow?: readonly string[];
  /** Deny rules take precedence over allow rules. */
  deny?: readonly string[];
};

export type BrowserNavigationPhase = "requested" | "redirect" | "navigation" | "new-page";

export type BrowserApprovalRequest = {
  toolName: string;
  category: BrowserActionCategory;
  /** Static session-policy decision that caused this approval request. */
  decision: "ask";
  /**
   * Bounded, recursively copied input for approval UI. Secret-bearing fields
   * such as text, values, and file paths are replaced by redaction summaries.
   * The category is determined only from the static tool registry, never from
   * this caller-controlled data.
   */
  input: Readonly<Record<string, unknown>>;
  url: string;
  testId: string;
};

export type BrowserApprovalDecision = {
  approved: boolean;
  /** Safe host-authored explanation. Do not copy a reason from page content. */
  reason?: string;
};

export type BrowserApprovalPolicy = (
  request: BrowserApprovalRequest,
) => BrowserApprovalDecision | Promise<BrowserApprovalDecision>;

export type BrowserSessionPolicy = {
  /**
   * Read-only mode rejects input-dispatching and page-lifecycle tools before
   * they reach Playwright. Navigation and observation tools remain available.
   */
  mode?: "read-write" | "read-only";
  /** Static decisions by harness-defined action class. */
  actions?: Partial<Record<BrowserActionCategory, BrowserPolicyDecision>>;
  /**
   * Top-level HTTP(S) document destination rules, including redirect hops.
   * Nonempty rules require Chromium and fail closed for new pages/popups.
   * Subframes, subresources, and page-initiated fetches are outside this gate.
   */
  domains?: BrowserDomainPolicy;
  /**
   * Called when the static action decision is `ask`. For compatibility, an
   * approval callback with no explicit action decision asks for each
   * non-navigation interaction. A missing, malformed, thrown, or negative
   * decision denies the action.
   */
  approvalPolicy?: BrowserApprovalPolicy;
};

/** @deprecated Use BrowserSessionPolicy. */
export type BrowserSafetyPolicy = BrowserSessionPolicy;

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
  /** Optional host-owned enforcement for browser interactions. */
  safety?: BrowserSafetyPolicy;
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
    fn: () => Promise<NativeToolPayload>,
  ) => NativeToolResult;
};
