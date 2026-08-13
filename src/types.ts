/** Framework-agnostic types for the browser harness. Hosts (e.g. Blop) map these
 * onto their own result/report models via structural typing. */

export type TestStatus = "passed" | "failed" | "error";

/**
 * Provenance attached to browser-tool output. Hosts must keep this boundary
 * when passing tool results to a model: page-derived text is data, never an
 * instruction from the harness or host.
 */
export type BrowserContentBoundary = {
  source: "browser";
  trust: "untrusted";
  url: string;
};

export type HarnessContentBoundary = {
  source: "harness";
  trust: "trusted";
};

export type CallerContentBoundary = {
  source: "caller";
  trust: "untrusted";
};

export type MixedContentBoundary = {
  source: "mixed";
  trust: "untrusted";
  browser: BrowserContentBoundary;
};

export type ToolContentBoundary =
  | BrowserContentBoundary
  | CallerContentBoundary
  | HarnessContentBoundary
  | MixedContentBoundary;

export type HarnessAction = {
  name: string;
  input: Record<string, unknown>;
  output: string;
  outputBoundary?: ToolContentBoundary;
  metadata?: Record<string, unknown>;
  timestamp: string;
  durationMs: number;
};

export type HarnessScreenshot = {
  path: string;
  name: string;
  checkpoint?: string;
  reason?: string;
  target?: string;
  focused: boolean;
  fullPage: boolean;
  timestamp: string;
};

export type HarnessCriticalPoint = {
  id: string;
  description: string;
  status: "pending" | "passed" | "failed";
  evidence?: string;
  screenshot?: string;
  timestamp: string;
};

export type HarnessBrowserLog = {
  type: "console" | "pageerror" | "requestfailed";
  level?: string;
  message: string;
  url?: string;
  timestamp: string;
};
