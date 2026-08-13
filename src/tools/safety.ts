import type { Page } from "playwright";
import type {
  BrowserContentBoundary,
  CallerContentBoundary,
  HarnessContentBoundary,
  MixedContentBoundary,
  ToolContentBoundary,
} from "../types.js";
import type {
  BrowserActionCategory,
  NativeModelImage,
  NativeModelImageInput,
  BrowserSafetyPolicy,
} from "./types.js";

const MUTATING_TOOL_CATEGORIES = new Map<string, BrowserActionCategory>([
  ["browser_click", "pointer"],
  ["browser_click_at", "pointer"],
  ["browser_double_click", "pointer"],
  ["browser_right_click", "pointer"],
  ["browser_hover", "pointer"],
  ["browser_drag_and_drop", "pointer"],
  ["browser_type", "keyboard"],
  ["browser_press", "keyboard"],
  ["browser_tab", "keyboard"],
  ["browser_focus", "keyboard"],
  ["browser_blur", "keyboard"],
  ["browser_clear", "keyboard"],
  ["browser_check", "form"],
  ["browser_uncheck", "form"],
  ["browser_select_option", "form"],
  ["browser_upload_file", "file-upload"],
  ["browser_close_page", "page-lifecycle"],
]);

export type BrowserToolContentKind = "browser" | "caller" | "harness" | "mixed";

/**
 * Exhaustive provenance registry for every tool created by createBrowserTools.
 * Do not silently default an unknown future tool to trusted harness content:
 * callers must classify it here before it can return a result.
 */
export const BROWSER_TOOL_CONTENT_KINDS = {
  browser_snapshot: "browser",
  browser_set_viewport: "harness",
  browser_get_viewport: "browser",
  browser_screenshot: "browser",
  browser_extract: "browser",
  browser_console_logs: "browser",
  browser_get_text: "browser",
  browser_get_attribute: "browser",
  browser_get_url: "browser",
  browser_list_pages: "browser",

  browser_goto: "mixed",
  browser_expect_url: "mixed",
  browser_wait_for_url: "mixed",
  browser_reload: "mixed",
  browser_go_back: "mixed",
  browser_go_forward: "mixed",
  browser_wait_for_network_idle: "mixed",
  browser_select_page: "mixed",
  browser_expect_text: "mixed",
  browser_wait_for_text: "mixed",
  browser_wait_for_selector: "mixed",
  browser_expect_visible: "mixed",
  browser_expect_hidden: "mixed",
  browser_expect_value: "mixed",
  browser_expect_checked: "mixed",
  browser_expect_enabled: "mixed",
  browser_expect_disabled: "mixed",
  browser_expect_count: "mixed",
  browser_expect_attribute: "mixed",
  browser_expect_focused: "mixed",
  browser_click: "mixed",
  browser_click_at: "mixed",
  browser_double_click: "mixed",
  browser_right_click: "mixed",
  browser_hover: "mixed",
  browser_drag_and_drop: "mixed",
  browser_type: "mixed",
  browser_press: "mixed",
  browser_tab: "mixed",
  browser_focus: "mixed",
  browser_blur: "mixed",
  browser_clear: "mixed",
  browser_check: "mixed",
  browser_uncheck: "mixed",
  browser_select_option: "mixed",
  browser_upload_file: "mixed",
  browser_close_page: "mixed",
  browser_run_steps: "mixed",

  record_critical_point: "caller",
  finish_test: "caller",
} as const satisfies Record<string, BrowserToolContentKind>;

export class BrowserToolError extends Error {
  readonly contentBoundary: ToolContentBoundary;

  constructor(message: string, contentBoundary: ToolContentBoundary, options?: ErrorOptions) {
    super(message, options);
    this.name = "BrowserToolError";
    this.contentBoundary = contentBoundary;
  }
}

export class BrowserSafetyError extends BrowserToolError {
  readonly code: "read_only" | "approval_denied";
  readonly toolName: string;
  readonly category: BrowserActionCategory;

  constructor(options: {
    code: "read_only" | "approval_denied";
    toolName: string;
    category: BrowserActionCategory;
    message: string;
    contentBoundary: ToolContentBoundary;
  }) {
    super(options.message, options.contentBoundary);
    this.name = "BrowserSafetyError";
    this.code = options.code;
    this.toolName = options.toolName;
    this.category = options.category;
  }
}

export function browserContentBoundary(page: Page): BrowserContentBoundary {
  let url = "";
  try {
    url = page.url();
  } catch {
    // A page can close while an action is producing its result. The boundary
    // remains useful even when its exact source URL is no longer available.
  }
  return { source: "browser", trust: "untrusted", url };
}

export function browserModelImages(
  page: Page,
  images: NativeModelImageInput[],
): NativeModelImage[] {
  const contentBoundary = browserContentBoundary(page);
  return images.map((image) => ({ ...image, contentBoundary }));
}

export function harnessContentBoundary(): HarnessContentBoundary {
  return { source: "harness", trust: "trusted" };
}

export function callerContentBoundary(): CallerContentBoundary {
  return { source: "caller", trust: "untrusted" };
}

export function mixedContentBoundary(page: Page): MixedContentBoundary {
  return {
    source: "mixed",
    trust: "untrusted",
    browser: browserContentBoundary(page),
  };
}

export function defaultToolContentBoundary(toolName: string, page: Page): ToolContentBoundary {
  const kind = (BROWSER_TOOL_CONTENT_KINDS as Record<string, BrowserToolContentKind>)[toolName];
  if (!kind) throw new BrowserToolError(
    `Browser tool ${toolName} has no content-boundary classification.`,
    harnessContentBoundary(),
  );
  if (kind === "browser") return browserContentBoundary(page);
  if (kind === "caller") return callerContentBoundary();
  if (kind === "mixed") return mixedContentBoundary(page);
  return harnessContentBoundary();
}

export async function enforceBrowserSafety(options: {
  page: Page;
  testId: string;
  safety?: BrowserSafetyPolicy;
  toolName: string;
  input: Record<string, unknown>;
}) {
  const category = MUTATING_TOOL_CATEGORIES.get(options.toolName);
  if (!category) return;

  const boundary = browserContentBoundary(options.page);
  if (options.safety?.mode === "read-only") {
    throw new BrowserSafetyError({
      code: "read_only",
      toolName: options.toolName,
      category,
      message: `Browser safety policy blocked ${options.toolName}: read-only mode does not permit ${category} interactions.`,
      contentBoundary: harnessContentBoundary(),
    });
  }

  if (!options.safety?.approvalPolicy) return;
  const decision = await options.safety.approvalPolicy({
    toolName: options.toolName,
    category,
    input: boundedApprovalInput(options.input),
    url: boundedApprovalUrl(boundary.url),
    testId: options.testId,
  });
  if (decision?.approved === true) return;

  const reason = decision && typeof decision.reason === "string" && decision.reason.trim()
    ? ` ${decision.reason.trim()}`
    : "";
  throw new BrowserSafetyError({
    code: "approval_denied",
    toolName: options.toolName,
    category,
    message: `Browser safety policy denied ${options.toolName} (${category}).${reason}`,
    contentBoundary: harnessContentBoundary(),
  });
}

export function browserToolError(error: unknown, page: Page): BrowserToolError {
  if (error instanceof BrowserToolError) return error;
  const message = error instanceof Error ? error.message : String(error);
  // Unknown Playwright/tool failures may incorporate selector matches, page
  // URLs, accessibility snapshots, or DOM text. Treat them as mixed unless a
  // typed harness error (such as BrowserSafetyError) states otherwise.
  return new BrowserToolError(
    message,
    mixedContentBoundary(page),
    error instanceof Error ? { cause: error } : undefined,
  );
}

const MAX_APPROVAL_FIELDS = 20;
const MAX_APPROVAL_ARRAY_ITEMS = 10;
const MAX_APPROVAL_STRING_CHARS = 160;
const MAX_APPROVAL_DEPTH = 3;
const REDACTED_INPUT_KEYS = /(?:text|value|path|file|password|secret|token|credential|cookie)/i;

function boundedApprovalInput(input: Record<string, unknown>): Readonly<Record<string, unknown>> {
  const entries = Object.entries(input).slice(0, MAX_APPROVAL_FIELDS).map(([key, value]) => [
    key,
    REDACTED_INPUT_KEYS.test(key) ? redactionSummary(value) : boundedApprovalValue(value, 0),
  ]);
  if (Object.keys(input).length > entries.length) {
    entries.push(["_omittedFields", Object.keys(input).length - entries.length]);
  }
  return Object.freeze(Object.fromEntries(entries));
}

function boundedApprovalValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    return value.length <= MAX_APPROVAL_STRING_CHARS
      ? value
      : `${value.slice(0, MAX_APPROVAL_STRING_CHARS)}…`;
  }
  if (depth >= MAX_APPROVAL_DEPTH) return "[omitted: max depth]";
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_APPROVAL_ARRAY_ITEMS)
      .map((item) => boundedApprovalValue(item, depth + 1));
    return value.length > items.length
      ? [...items, `[omitted ${value.length - items.length} item(s)]`]
      : items;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .slice(0, MAX_APPROVAL_FIELDS)
      .map(([key, child]) => [
        key,
        REDACTED_INPUT_KEYS.test(key) ? redactionSummary(child) : boundedApprovalValue(child, depth + 1),
      ]);
    return Object.fromEntries(entries);
  }
  return `[${typeof value}]`;
}

function redactionSummary(value: unknown) {
  if (typeof value === "string") return { redacted: true, type: "string", length: value.length };
  if (Array.isArray(value)) return { redacted: true, type: "array", length: value.length };
  return { redacted: true, type: value === null ? "null" : typeof value };
}

function boundedApprovalUrl(value: string) {
  try {
    const url = new URL(value);
    const pathname = url.pathname.length <= 1_000 ? url.pathname : `${url.pathname.slice(0, 1_000)}…`;
    return `${url.origin}${pathname}${url.search ? "?[query redacted]" : ""}${url.hash ? "#[fragment redacted]" : ""}`;
  } catch {
    return value.length <= 1_000 ? value : `${value.slice(0, 1_000)}…`;
  }
}
