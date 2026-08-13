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
  BrowserDomainPolicy,
  BrowserNavigationPhase,
  BrowserPolicyDecision,
  NativeModelImage,
  NativeModelImageInput,
  BrowserSafetyPolicy,
} from "./types.js";

export type CompiledBrowserDomainPolicy = {
  readonly allow: readonly CompiledOriginPattern[];
  readonly deny: readonly CompiledOriginPattern[];
  readonly fingerprint: string;
};

export type CompiledBrowserSessionPolicy = {
  readonly mode: "read-write" | "read-only";
  readonly actions: Readonly<Partial<Record<BrowserActionCategory, BrowserPolicyDecision>>>;
  readonly domains?: CompiledBrowserDomainPolicy;
  readonly approvalPolicy?: BrowserSafetyPolicy["approvalPolicy"];
};

export type BrowserToolContentKind = "browser" | "caller" | "harness" | "mixed";
export type BrowserToolPolicyClass = "read" | "batch" | BrowserActionCategory;

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

/**
 * Exhaustive static policy classification for every public harness tool.
 * Batch is an envelope: each inner command is evaluated independently.
 */
export const BROWSER_TOOL_POLICY_CLASSES = {
  browser_snapshot: "read",
  browser_set_viewport: "read",
  browser_get_viewport: "read",
  browser_screenshot: "read",
  browser_extract: "read",
  browser_console_logs: "read",
  browser_get_text: "read",
  browser_get_attribute: "read",
  browser_get_url: "read",
  browser_list_pages: "read",

  browser_goto: "navigation",
  browser_expect_url: "read",
  browser_wait_for_url: "read",
  browser_reload: "navigation",
  browser_go_back: "navigation",
  browser_go_forward: "navigation",
  browser_wait_for_network_idle: "read",
  browser_select_page: "read",
  browser_expect_text: "read",
  browser_wait_for_text: "read",
  browser_wait_for_selector: "read",
  browser_expect_visible: "read",
  browser_expect_hidden: "read",
  browser_expect_value: "read",
  browser_expect_checked: "read",
  browser_expect_enabled: "read",
  browser_expect_disabled: "read",
  browser_expect_count: "read",
  browser_expect_attribute: "read",
  browser_expect_focused: "read",
  browser_click: "pointer",
  browser_click_at: "pointer",
  browser_double_click: "pointer",
  browser_right_click: "pointer",
  browser_hover: "pointer",
  browser_drag_and_drop: "pointer",
  browser_type: "keyboard",
  browser_press: "keyboard",
  browser_tab: "keyboard",
  browser_focus: "keyboard",
  browser_blur: "keyboard",
  browser_clear: "keyboard",
  browser_check: "form",
  browser_uncheck: "form",
  browser_select_option: "form",
  browser_upload_file: "file-upload",
  browser_close_page: "page-lifecycle",
  browser_run_steps: "batch",

  record_critical_point: "read",
  finish_test: "read",
} as const satisfies Record<keyof typeof BROWSER_TOOL_CONTENT_KINDS, BrowserToolPolicyClass>;

export class BrowserToolError extends Error {
  readonly contentBoundary: ToolContentBoundary;

  constructor(message: string, contentBoundary: ToolContentBoundary, options?: ErrorOptions) {
    super(message, options);
    this.name = "BrowserToolError";
    this.contentBoundary = contentBoundary;
  }
}

export class BrowserSafetyError extends BrowserToolError {
  readonly code: "read_only" | "policy_denied" | "approval_denied" | "domain_denied";
  readonly toolName: string;
  readonly category: BrowserActionCategory;
  readonly decision: BrowserPolicyDecision;
  readonly phase?: BrowserNavigationPhase;
  readonly origin?: string;

  constructor(options: {
    code: "read_only" | "policy_denied" | "approval_denied" | "domain_denied";
    toolName: string;
    category: BrowserActionCategory;
    decision?: BrowserPolicyDecision;
    phase?: BrowserNavigationPhase;
    origin?: string;
    message: string;
    contentBoundary: ToolContentBoundary;
  }) {
    super(options.message, options.contentBoundary);
    this.name = "BrowserSafetyError";
    this.code = options.code;
    this.toolName = options.toolName;
    this.category = options.category;
    this.decision = options.decision ?? "deny";
    this.phase = options.phase;
    this.origin = options.origin;
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
  safety: CompiledBrowserSessionPolicy;
  baseUrl?: string;
  toolName: string;
  input: Record<string, unknown>;
}) {
  const policyClass = (BROWSER_TOOL_POLICY_CLASSES as Record<string, BrowserToolPolicyClass>)[options.toolName];
  if (!policyClass) {
    throw new BrowserSafetyError({
      code: "policy_denied",
      toolName: options.toolName,
      category: "page-lifecycle",
      decision: "deny",
      message: `Browser session policy blocked unclassified tool ${options.toolName}.`,
      contentBoundary: harnessContentBoundary(),
    });
  }
  if (policyClass === "read" || policyClass === "batch") return;
  const category = policyClass;

  if (options.toolName === "browser_goto" && options.safety.domains) {
    const destination = resolveRequestedUrl(options.input.url, options.baseUrl);
    if (!destination || !compiledBrowserDomainAllowed(options.safety.domains, destination)) {
      throw domainDeniedError({
        toolName: options.toolName,
        phase: "requested",
        destination: destination ?? String(options.input.url ?? ""),
        contentBoundary: callerContentBoundary(),
      });
    }
  }

  const boundary = browserContentBoundary(options.page);
  if (options.safety.mode === "read-only" && category !== "navigation") {
    throw new BrowserSafetyError({
      code: "read_only",
      toolName: options.toolName,
      category,
      decision: "deny",
      message: `Browser safety policy blocked ${options.toolName}: read-only mode does not permit ${category} interactions.`,
      contentBoundary: harnessContentBoundary(),
    });
  }

  const configuredDecision = options.safety.actions[category];
  const policyDecision = configuredDecision
    ?? (category !== "navigation" && options.safety.approvalPolicy ? "ask" : "allow");
  if (policyDecision === "allow") return;
  if (policyDecision === "deny") {
    throw new BrowserSafetyError({
      code: "policy_denied",
      toolName: options.toolName,
      category,
      decision: "deny",
      message: `Browser session policy denied ${options.toolName} (${category}).`,
      contentBoundary: harnessContentBoundary(),
    });
  }

  let decision;
  try {
    decision = await options.safety.approvalPolicy?.({
      toolName: options.toolName,
      category,
      decision: "ask",
      input: boundedApprovalInput(options.input),
      url: boundedApprovalUrl(boundary.url),
      testId: options.testId,
    });
  } catch {
    // Approval infrastructure is part of the trusted host boundary. Fail
    // closed without copying its potentially sensitive exception text.
  }
  if (decision?.approved === true) return { category, decision: "ask" as const };

  const safeReason = decision && typeof decision.reason === "string"
    ? sanitizedApprovalReason(decision.reason)
    : "";
  const reason = safeReason
    ? ` ${safeReason}`
    : "";
  throw new BrowserSafetyError({
    code: "approval_denied",
    toolName: options.toolName,
    category,
    decision: "ask",
    message: `Browser safety policy denied ${options.toolName} (${category}).${reason}`,
    contentBoundary: harnessContentBoundary(),
  });
}

export function browserDomainAllowed(policy: BrowserDomainPolicy, destination: string) {
  return compiledBrowserDomainAllowed(compileDomainPolicy(policy), destination);
}

export function compiledBrowserDomainAllowed(
  compiled: CompiledBrowserDomainPolicy,
  destination: string,
) {
  let url: URL;
  try {
    url = new URL(destination);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (compiled.deny.some((pattern) => patternMatches(pattern, url))) return false;
  return compiled.allow.length === 0 || compiled.allow.some((pattern) => patternMatches(pattern, url));
}

export function compileBrowserSessionPolicy(
  policy: BrowserSafetyPolicy | undefined,
): CompiledBrowserSessionPolicy {
  assertRecord(policy, "Browser session policy");
  assertKnownKeys(policy, ["mode", "actions", "domains", "approvalPolicy"], "Browser session policy");
  const mode = policy?.mode ?? "read-write";
  if (mode !== "read-write" && mode !== "read-only") {
    throw new TypeError("Browser session policy mode must be read-write or read-only.");
  }
  if (policy?.approvalPolicy !== undefined && typeof policy.approvalPolicy !== "function") {
    throw new TypeError("Browser session policy approvalPolicy must be a function.");
  }
  assertRecord(policy?.actions, "Browser session policy actions");
  if (policy?.actions) {
    const unknown = Object.keys(policy.actions).filter((key) =>
      !(BROWSER_ACTION_CATEGORIES as readonly string[]).includes(key)
    );
    if (unknown.length) {
      throw new TypeError(`Browser session policy has unknown action category: ${unknown.join(", ")}.`);
    }
  }
  const actions: Partial<Record<BrowserActionCategory, BrowserPolicyDecision>> = {};
  for (const category of BROWSER_ACTION_CATEGORIES) {
    const decision = policy?.actions?.[category];
    if (decision === undefined) continue;
    if (decision !== "allow" && decision !== "deny" && decision !== "ask") {
      throw new TypeError(`Browser session policy action ${category} must be allow, deny, or ask.`);
    }
    actions[category] = decision;
  }
  const domains = policy?.domains === undefined
    ? undefined
    : compileDomainPolicy(policy.domains);
  return Object.freeze({
    mode,
    actions: Object.freeze(actions),
    ...(domains ? { domains } : {}),
    ...(policy?.approvalPolicy ? { approvalPolicy: policy.approvalPolicy } : {}),
  });
}

export function validateBrowserSessionPolicy(policy: BrowserSafetyPolicy | undefined) {
  compileBrowserSessionPolicy(policy);
}

export function domainDeniedError(options: {
  toolName: string;
  phase: BrowserNavigationPhase;
  destination: string;
  contentBoundary: ToolContentBoundary;
}) {
  const origin = policyOrigin(options.destination);
  const detail = options.phase === "new-page"
    ? `new-page navigation to ${origin} is disabled while domain rules are active`
    : options.phase === "navigation"
    ? `navigation to ${origin} is denied`
    : `${options.phase} navigation to ${origin} is denied`;
  return new BrowserSafetyError({
    code: "domain_denied",
    toolName: options.toolName,
    category: "navigation",
    decision: "deny",
    phase: options.phase,
    origin,
    message: `Browser session policy blocked ${options.toolName}: ${detail}.`,
    contentBoundary: options.contentBoundary,
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
const MAX_APPROVAL_REASON_CHARS = 240;
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

function sanitizedApprovalReason(value: string) {
  const withoutControls = [...value].map((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || (code >= 127 && code <= 159) ? " " : character;
  }).join("");
  const singleLine = withoutControls
    .replace(/\s+/g, " ")
    .trim();
  return singleLine.length <= MAX_APPROVAL_REASON_CHARS
    ? singleLine
    : `${singleLine.slice(0, MAX_APPROVAL_REASON_CHARS)}…`;
}

type CompiledOriginPattern = {
  readonly protocol: "http:" | "https:";
  readonly hostname: string;
  readonly port: string;
  readonly wildcard: boolean;
};

const BROWSER_ACTION_CATEGORIES: readonly BrowserActionCategory[] = [
  "navigation",
  "pointer",
  "keyboard",
  "form",
  "file-upload",
  "page-lifecycle",
];

const MAX_DOMAIN_RULES = 100;
const MAX_DOMAIN_RULE_LENGTH = 512;

function compileDomainPolicy(policy: BrowserDomainPolicy) {
  assertRecord(policy, "Browser domain policy");
  assertKnownKeys(policy, ["allow", "deny"], "Browser domain policy");
  const allow = compileOriginPatterns(policy.allow, "allow");
  const deny = compileOriginPatterns(policy.deny, "deny");
  return Object.freeze({
    allow: Object.freeze(allow),
    deny: Object.freeze(deny),
    fingerprint: JSON.stringify({ allow, deny }),
  });
}

function compileOriginPatterns(values: readonly string[] | undefined, kind: string) {
  if (values === undefined) return [];
  if (!Array.isArray(values)) throw new TypeError(`Browser domain ${kind} rules must be an array.`);
  if (values.length > MAX_DOMAIN_RULES) {
    throw new TypeError(`Browser domain ${kind} rules support at most ${MAX_DOMAIN_RULES} origins.`);
  }
  return values.map((value) => parseOriginPattern(value, kind));
}

function parseOriginPattern(value: string, kind: string): CompiledOriginPattern {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_DOMAIN_RULE_LENGTH) {
    throw new TypeError(`Browser domain ${kind} rules must contain non-empty origins up to ${MAX_DOMAIN_RULE_LENGTH} characters.`);
  }
  const wildcardMatch = value.match(/^(https?):\/\/\*\./i);
  const wildcard = Boolean(wildcardMatch);
  if (value.includes("*") && !wildcard) {
    throw new TypeError(`Invalid browser domain ${kind} rule: wildcards are only allowed as the leftmost '*.' hostname label.`);
  }
  let url: URL;
  try {
    url = new URL(wildcard
      ? value.replace(/^(https?):\/\/\*\./i, "$1://policy-wildcard.")
      : value);
  } catch {
    throw new TypeError(`Invalid browser domain ${kind} rule: expected an HTTP(S) origin.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError(`Invalid browser domain ${kind} rule: only HTTP(S) origins are supported.`);
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new TypeError(`Invalid browser domain ${kind} rule: paths, credentials, queries, and fragments are not allowed.`);
  }
  const normalizedHostname = normalizeHostname(url.hostname);
  const hostname = wildcard
    ? normalizedHostname.replace(/^policy-wildcard\./, "")
    : normalizedHostname;
  if (!hostname || (wildcard && hostname === normalizedHostname)) {
    throw new TypeError(`Invalid browser domain ${kind} wildcard origin.`);
  }
  return {
    protocol: url.protocol as "http:" | "https:",
    hostname,
    port: effectivePort(url),
    wildcard,
  };
}

function patternMatches(pattern: CompiledOriginPattern, url: URL) {
  if (url.protocol !== pattern.protocol || effectivePort(url) !== pattern.port) return false;
  const hostname = normalizeHostname(url.hostname);
  return pattern.wildcard
    ? hostname.endsWith(`.${pattern.hostname}`)
    : hostname === pattern.hostname;
}

function effectivePort(url: URL) {
  return url.port || (url.protocol === "https:" ? "443" : "80");
}

function normalizeHostname(value: string) {
  return value.toLowerCase().replace(/\.$/, "");
}

function resolveRequestedUrl(value: unknown, baseUrl: string | undefined) {
  if (typeof value !== "string") return undefined;
  try {
    return baseUrl ? new URL(value, baseUrl).href : new URL(value).href;
  } catch {
    return undefined;
  }
}

function policyOrigin(value: string) {
  try {
    const url = new URL(value);
    return url.origin === "null" ? url.protocol : url.origin;
  } catch {
    return "invalid-origin";
  }
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> | undefined {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
}

function assertKnownKeys(
  value: Record<string, unknown> | undefined,
  allowed: readonly string[],
  label: string,
) {
  if (!value) return;
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new TypeError(`${label} has unknown key: ${unknown.join(", ")}.`);
}
