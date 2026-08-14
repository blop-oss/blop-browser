import type { HarnessAction, ToolContentBoundary } from "./types.js";
import type { BROWSER_TOOL_CONTENT_KINDS } from "./tools/safety.js";

const DEFAULT_MAX_EVENTS = 100;
const MIN_MAX_EVENTS = 1;
const MAX_MAX_EVENTS = 5_000;
const DEFAULT_MAX_STRING_LENGTH = 1_000;
const MIN_MAX_STRING_LENGTH = 64;
const MAX_MAX_STRING_LENGTH = 8_000;
const DEFAULT_MAX_EXPORT_BYTES = 768 * 1024;
const MIN_MAX_EXPORT_BYTES = 1_024;
const MAX_MAX_EXPORT_BYTES = 4 * 1024 * 1024;
const MAX_INPUT_FIELDS = 20;
const MAX_ARRAY_ITEMS = 20;
const MAX_INPUT_DEPTH = 4;
const MAX_INPUT_NODES = 80;
const MAX_TARGET_REFS = 20;
const MAX_IDENTITY_LENGTH = 160;

export type BrowserTraceCommandKind = "read" | "write" | "batch";

/**
 * Exhaustive trace classification for the public tool registry. Adding a tool
 * to the harness content-boundary registry requires classifying it here too.
 */
export const BROWSER_TRACE_COMMAND_KINDS = {
  browser_snapshot: "read",
  browser_set_viewport: "write",
  browser_get_viewport: "read",
  browser_screenshot: "write",
  browser_extract: "read",
  browser_console_logs: "read",
  browser_get_text: "read",
  browser_get_attribute: "read",
  browser_get_url: "read",
  browser_list_pages: "read",

  browser_goto: "write",
  browser_expect_url: "read",
  browser_wait_for_url: "read",
  browser_reload: "write",
  browser_go_back: "write",
  browser_go_forward: "write",
  browser_wait_for_network_idle: "read",
  browser_select_page: "write",
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
  browser_click: "write",
  browser_click_at: "write",
  browser_double_click: "write",
  browser_right_click: "write",
  browser_hover: "write",
  browser_drag_and_drop: "write",
  browser_type: "write",
  browser_press: "write",
  browser_tab: "write",
  browser_focus: "write",
  browser_blur: "write",
  browser_clear: "write",
  browser_check: "write",
  browser_uncheck: "write",
  browser_select_option: "write",
  browser_upload_file: "write",
  browser_close_page: "write",
  browser_run_steps: "batch",

  record_critical_point: "write",
  finish_test: "write",
} as const satisfies Record<keyof typeof BROWSER_TOOL_CONTENT_KINDS, BrowserTraceCommandKind>;

const SESSION_LIFECYCLE_COMMANDS = new Set([
  "browser_session_start",
  "browser_session_close",
  "browser_session_destroy",
  "browser_control_pause_requested",
  "browser_control_paused",
  "browser_control_human_acquired",
  "browser_control_automation_resumed",
  "browser_control_closed",
]);

const SENSITIVE_KEY_PATTERN = /(?:text|password|passwd|passcode|secret|token|api[_-]?key|authorization|cookie|credential|session|credit|card|cvv|cvc|ssn|email)/i;
const VALUE_KEY_PATTERN = /^(?:value|values|path|paths|file|files)$/i;
const SENSITIVE_PATH_KEY_PATTERN = /^(?:password|passwd|passcode|secret|token|api[_-]?key|authorization|cookie|credential|session)$/i;

/** Framework-neutral metadata that identifies where a browser trace came from. */
export type TraceIdentity = {
  sessionId?: string;
  agentId?: string;
};

export type TraceApproval = {
  status: "approved" | "denied";
  policy?: string;
  category?: string;
  reason?: string;
};

export type TracePolicyDecision = {
  code: string;
  toolName: string;
  category: string;
  decision: string;
  phase?: string;
  origin?: string;
};

export type TraceMediaPosition = {
  screenshot?: {
    path: string;
    index?: number;
  };
  screencast?: {
    frame: number;
    timestamp?: string;
  };
};

export type HarnessTraceEvent = {
  sequence: number;
  kind: "action" | "batch" | "lifecycle";
  timestamp: string;
  completedAt: string;
  durationMs: number;
  identity?: TraceIdentity;
  stateChanging: boolean;
  command: string;
  input: Readonly<Record<string, unknown>>;
  targetRefs: readonly string[];
  url: {
    before: string;
    after: string;
  };
  status: "succeeded" | "failed";
  contentBoundary?: ToolContentBoundary;
  result?: string;
  error?: string;
  approval?: TraceApproval;
  policy?: TracePolicyDecision;
  media?: TraceMediaPosition;
};

export type HarnessTraceExport = {
  version: 1;
  generatedAt: string;
  identity?: TraceIdentity;
  omittedEvents: number;
  events: readonly HarnessTraceEvent[];
};

export type TraceRecordContext = {
  startedAt?: string;
  completedAt?: string;
  urlBefore?: string;
  urlAfter?: string;
  stateChanging?: boolean;
  approval?: TraceApproval;
  media?: TraceMediaPosition;
};

export type TraceRecorderOptions = {
  identity?: TraceIdentity;
  /** Previously exported bounded trace to continue, for example after a
   * persistent CLI session restarts. Existing event identities are retained. */
  initialTrace?: HarnessTraceExport;
  maxEvents?: number;
  maxStringLength?: number;
  maxExportBytes?: number;
};

/** A bounded recorder for ordered browser actions emitted by the harness. */
export type TraceRecorder = {
  record(action: HarnessAction, context?: TraceRecordContext): HarnessTraceEvent;
  events(): readonly HarnessTraceEvent[];
  snapshot(): HarnessTraceExport;
  timeline(): string;
  json(pretty?: boolean): string;
  clear(): void;
};

export function createTraceRecorder(options: TraceRecorderOptions = {}): TraceRecorder {
  const maxEvents = boundedInteger(options.maxEvents, DEFAULT_MAX_EVENTS, MIN_MAX_EVENTS, MAX_MAX_EVENTS);
  const maxStringLength = boundedInteger(
    options.maxStringLength,
    DEFAULT_MAX_STRING_LENGTH,
    MIN_MAX_STRING_LENGTH,
    MAX_MAX_STRING_LENGTH,
  );
  const maxExportBytes = boundedInteger(
    options.maxExportBytes,
    DEFAULT_MAX_EXPORT_BYTES,
    MIN_MAX_EXPORT_BYTES,
    MAX_MAX_EXPORT_BYTES,
  );
  const identity = normalizeIdentity(options.identity, maxStringLength);
  const initialEvents = options.initialTrace?.events.slice(-maxEvents) ?? [];
  const storedEvents: HarnessTraceEvent[] = initialEvents.map((event) => immutableCopy(event));
  let omittedEvents = Math.max(0, Math.floor(options.initialTrace?.omittedEvents ?? 0))
    + Math.max(0, (options.initialTrace?.events.length ?? 0) - initialEvents.length);
  let nextSequence = Math.max(0, ...storedEvents.map((event) => event.sequence)) + 1;

  const snapshot = (): HarnessTraceExport => {
    const events = storedEvents.map((event) => immutableCopy(event));
    let exportOmitted = omittedEvents;
    let exported = traceExport(identity, exportOmitted, events);
    while (events.length > 0 && Buffer.byteLength(JSON.stringify(exported), "utf8") > maxExportBytes) {
      events.shift();
      exportOmitted += 1;
      exported = traceExport(identity, exportOmitted, events);
    }
    return immutableCopy(exported);
  };

  return {
    record: (action, context = {}) => {
      const sensitiveValues = collectSensitiveStrings(action.name, action.input);
      const failed = typeof action.metadata?.error === "string";
      const output = redactTraceText(action.output, sensitiveValues, maxStringLength);
      const approval = sanitizeApproval(
        context.approval ?? approvalFromMetadata(action.metadata, maxStringLength),
        sensitiveValues,
        maxStringLength,
      );
      const policy = sanitizePolicyDecision(
        policyFromMetadata(action.metadata, maxStringLength),
        sensitiveValues,
        maxStringLength,
      );
      const media = sanitizeMedia(
        context.media ?? mediaFromMetadata(action.metadata, maxStringLength),
        sensitiveValues,
        maxStringLength,
      );
      const event: HarnessTraceEvent = {
        sequence: nextSequence,
        kind: action.name === "browser_run_steps"
          ? "batch"
          : SESSION_LIFECYCLE_COMMANDS.has(action.name) ? "lifecycle" : "action",
        timestamp: validTimestamp(context.startedAt) ?? validTimestamp(action.timestamp) ?? new Date().toISOString(),
        completedAt: validTimestamp(context.completedAt) ?? validTimestamp(action.timestamp) ?? new Date().toISOString(),
        durationMs: boundedDuration(action.durationMs),
        ...(identity ? { identity } : {}),
        stateChanging: context.stateChanging ?? isStateChangingCommand(action.name),
        command: redactTraceText(action.name, sensitiveValues, maxStringLength),
        input: redactTraceInput(action.name, action.input, maxStringLength, sensitiveValues),
        targetRefs: collectTargetRefs(action.input),
        url: {
          before: redactTraceUrl(context.urlBefore ?? "", maxStringLength, sensitiveValues),
          after: redactTraceUrl(context.urlAfter ?? context.urlBefore ?? "", maxStringLength, sensitiveValues),
        },
        status: failed ? "failed" : "succeeded",
        ...(action.outputBoundary
          ? { contentBoundary: sanitizeContentBoundary(action.outputBoundary, sensitiveValues, maxStringLength) }
          : {}),
        ...(failed ? { error: output } : { result: output }),
        ...(approval ? { approval } : {}),
        ...(policy ? { policy } : {}),
        ...(media ? { media } : {}),
      };
      nextSequence += 1;
      const immutableEvent = immutableCopy(event);
      storedEvents.push(immutableEvent);
      if (storedEvents.length > maxEvents) {
        storedEvents.shift();
        omittedEvents += 1;
      }
      return immutableCopy(immutableEvent);
    },
    events: () => snapshot().events,
    snapshot,
    timeline: () => formatTraceTimeline(snapshot(), maxStringLength, maxExportBytes),
    json: (pretty = false) => {
      const exported = snapshot();
      const compact = JSON.stringify(exported);
      if (!pretty) return compact;
      const formatted = JSON.stringify(exported, null, 2);
      return Buffer.byteLength(formatted, "utf8") <= maxExportBytes ? formatted : compact;
    },
    clear: () => {
      storedEvents.length = 0;
      omittedEvents = 0;
      nextSequence = 1;
    },
  };
}

export function isStateChangingCommand(command: string) {
  return (BROWSER_TRACE_COMMAND_KINDS as Record<string, BrowserTraceCommandKind>)[command] === "write"
    || SESSION_LIFECYCLE_COMMANDS.has(command);
}

export function formatTraceTimeline(
  trace: HarnessTraceExport,
  maxStringLength = DEFAULT_MAX_STRING_LENGTH,
  maxBytes = DEFAULT_MAX_EXPORT_BYTES,
) {
  const identity = [
    trace.identity?.sessionId ? `session=${trace.identity.sessionId}` : "",
    trace.identity?.agentId ? `agent=${trace.identity.agentId}` : "",
  ].filter(Boolean).join(" ");
  const header = `Browser trace${identity ? ` (${identity})` : ""}: ${trace.events.length} event(s)`
    + (trace.omittedEvents ? `, ${trace.omittedEvents} older event(s) omitted` : "");
  if (trace.events.length === 0) return boundUtf8(`${header}.`, maxBytes);

  const lines = trace.events.map((event) => {
    const status = event.status === "succeeded" ? "OK" : "ERROR";
    const operation = event.kind === "batch" ? "batch" : event.stateChanging ? "write" : "read";
    const navigation = event.url.before !== event.url.after
      ? ` ${event.url.before || "<blank>"} -> ${event.url.after || "<blank>"}`
      : event.url.after ? ` ${event.url.after}` : "";
    const refs = event.targetRefs.length ? ` refs=${event.targetRefs.join(",")}` : "";
    const approval = event.approval
      ? ` approval=${event.approval.status}${event.approval.policy ? `:${event.approval.policy}` : ""}`
      : "";
    const policy = event.policy
      ? ` policy=${event.policy.code}:${event.policy.decision}`
      : "";
    const media = [
      event.media?.screenshot ? `screenshot=${event.media.screenshot.index ?? "?"}:${event.media.screenshot.path}` : "",
      event.media?.screencast ? `frame=${event.media.screencast.frame}` : "",
    ].filter(Boolean).join(" ");
    const outcome = boundedString(event.error ?? event.result ?? "", Math.min(maxStringLength, 300));
    return `${String(event.sequence).padStart(4, "0")} ${event.timestamp} ${status} [${operation}] ${event.command}`
      + `${navigation}${refs}${approval}${policy}${media ? ` ${media}` : ""}${outcome ? ` — ${outcome}` : ""}`;
  });
  return boundUtf8(`${header}\n${lines.join("\n")}`, maxBytes);
}

export function redactTraceInput(
  command: string,
  input: Record<string, unknown>,
  maxStringLength = DEFAULT_MAX_STRING_LENGTH,
  sensitiveValues = collectSensitiveStrings(command, input),
): Readonly<Record<string, unknown>> {
  const budget = { nodes: MAX_INPUT_NODES };
  return immutableCopy(redactObject(command, input, [], maxStringLength, budget, sensitiveValues));
}

export function redactTraceUrl(
  value: string,
  maxStringLength = DEFAULT_MAX_STRING_LENGTH,
  sensitiveValues: string[] = [],
) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.username) url.username = "REDACTED";
    if (url.password) url.password = "REDACTED";
    const pathSegments = url.pathname.split("/");
    url.pathname = pathSegments.map((segment, index) => {
      if (!segment) return segment;
      const decoded = decodeUrlComponent(segment);
      const previous = index > 0 ? decodeUrlComponent(pathSegments[index - 1] ?? "") : "";
      if (SENSITIVE_PATH_KEY_PATTERN.test(previous) || containsSensitiveValue(decoded, sensitiveValues)) {
        return "REDACTED";
      }
      const redacted = redactTraceText(decoded, sensitiveValues, maxStringLength);
      return redacted === decoded ? segment : encodeURIComponent(redacted);
    }).join("/");
    if (url.search) url.search = "?REDACTED";
    if (url.hash) url.hash = "#[REDACTED]";
    return boundedString(url.href, maxStringLength);
  } catch {
    return boundedString(
      redactNonUrlText(value, sensitiveValues).replace(/\s+/g, " ").trim(),
      maxStringLength,
    );
  }
}

function redactObject(
  command: string,
  input: Record<string, unknown>,
  path: string[],
  maxStringLength: number,
  budget: { nodes: number },
  sensitiveValues: string[],
) {
  const entries = Object.entries(input).slice(0, MAX_INPUT_FIELDS).map(([key, value]) => {
    budget.nodes -= 1;
    if (budget.nodes < 0) return [key, "[omitted: node limit]"];
    if (shouldRedactInput(command, key, path)) return [key, redactionSummary(value)];
    if (/url/i.test(key) && typeof value === "string") {
      return [key, redactTraceUrl(value, maxStringLength, sensitiveValues)];
    }
    return [key, redactValue(command, value, [...path, key], maxStringLength, budget, sensitiveValues)];
  });
  if (Object.keys(input).length > entries.length) {
    entries.push(["_omittedFields", Object.keys(input).length - entries.length]);
  }
  return Object.fromEntries(entries);
}

function redactValue(
  command: string,
  value: unknown,
  path: string[],
  maxStringLength: number,
  budget: { nodes: number },
  sensitiveValues: string[],
): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return redactTraceText(value, sensitiveValues, maxStringLength);
  if (path.length >= MAX_INPUT_DEPTH) return "[omitted: depth limit]";
  if (Array.isArray(value)) {
    const values = value.slice(0, MAX_ARRAY_ITEMS).map((entry) => {
      budget.nodes -= 1;
      return budget.nodes < 0
        ? "[omitted: node limit]"
        : redactValue(command, entry, path, maxStringLength, budget, sensitiveValues);
    });
    if (value.length > values.length) values.push(`[omitted ${value.length - values.length} item(s)]`);
    return values;
  }
  if (typeof value === "object") {
    return redactObject(command, value as Record<string, unknown>, path, maxStringLength, budget, sensitiveValues);
  }
  return `[${typeof value}]`;
}

function shouldRedactInput(command: string, key: string, path: string[]) {
  if (SENSITIVE_KEY_PATTERN.test(key) || VALUE_KEY_PATTERN.test(key)) return true;
  return command === "browser_type" && path.length === 0 && key === "text";
}

function collectSensitiveStrings(command: string, input: Record<string, unknown>) {
  const values: string[] = [];
  const visit = (value: unknown, path: string[]) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (shouldRedactInput(command, key, path)) {
        if (typeof child === "string" && child) values.push(child);
        else if (Array.isArray(child)) {
          for (const entry of child) if (typeof entry === "string" && entry) values.push(entry);
        }
      } else if (typeof child === "object") {
        visit(child, [...path, key]);
      }
    }
  };
  visit(input, []);
  return [...new Set(values)].sort((left, right) => right.length - left.length).slice(0, 100);
}

function collectTargetRefs(input: Record<string, unknown>) {
  const refs: string[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > MAX_INPUT_DEPTH || refs.length >= MAX_TARGET_REFS || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === "ref" && typeof child === "string" && child) {
        const bounded = boundedString(child, 128);
        if (!refs.includes(bounded)) refs.push(bounded);
      } else {
        visit(child, depth + 1);
      }
    }
  };
  visit(input, 0);
  return immutableCopy(refs);
}

function redactTraceText(value: string, sensitiveValues: string[], maxStringLength: number) {
  const redacted = redactNonUrlText(value, sensitiveValues)
    .replace(/https?:\/\/[^\s<>"']+/gi, (url) => redactTraceUrl(url, maxStringLength, sensitiveValues));
  return boundedString(redacted.replace(/\s+/g, " ").trim(), maxStringLength);
}

function redactNonUrlText(value: string, sensitiveValues: string[]) {
  let redacted = String(value);
  for (const sensitive of sensitiveValues) redacted = redacted.split(sensitive).join("[REDACTED]");
  return redacted
    .replace(/(bearer\s+)[a-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(/((?:password|passwd|passcode|secret|token|api[_-]?key|authorization|cookie|credential)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/\b(?:eyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}|(?:sk|pk|tok|key|secret)[_-][a-z0-9_-]{12,})\b/gi, "[REDACTED]");
}

function sanitizeApproval(
  approval: TraceApproval | undefined,
  sensitiveValues: string[],
  maxStringLength: number,
): TraceApproval | undefined {
  if (!approval) return undefined;
  return immutableCopy({
    status: approval.status,
    ...(approval.policy
      ? { policy: redactTraceText(approval.policy, sensitiveValues, maxStringLength) }
      : {}),
    ...(approval.category
      ? { category: redactTraceText(approval.category, sensitiveValues, maxStringLength) }
      : {}),
    ...(approval.reason
      ? { reason: redactTraceText(approval.reason, sensitiveValues, maxStringLength) }
      : {}),
  });
}

function sanitizePolicyDecision(
  policy: TracePolicyDecision | undefined,
  sensitiveValues: string[],
  maxStringLength: number,
): TracePolicyDecision | undefined {
  if (!policy) return undefined;
  return immutableCopy({
    code: redactTraceText(policy.code, sensitiveValues, maxStringLength),
    toolName: redactTraceText(policy.toolName, sensitiveValues, maxStringLength),
    category: redactTraceText(policy.category, sensitiveValues, maxStringLength),
    decision: redactTraceText(policy.decision, sensitiveValues, maxStringLength),
    ...(policy.phase
      ? { phase: redactTraceText(policy.phase, sensitiveValues, maxStringLength) }
      : {}),
    ...(policy.origin
      ? { origin: redactPolicyOrigin(policy.origin, maxStringLength, sensitiveValues) }
      : {}),
  });
}

function redactPolicyOrigin(
  origin: string,
  maxStringLength: number,
  sensitiveValues: string[],
) {
  const redacted = redactTraceUrl(origin, maxStringLength, sensitiveValues);
  try {
    return new URL(redacted).origin;
  } catch {
    return redacted;
  }
}

function sanitizeMedia(
  media: TraceMediaPosition | undefined,
  sensitiveValues: string[],
  maxStringLength: number,
): TraceMediaPosition | undefined {
  if (!media) return undefined;
  const screenshotPath = media.screenshot?.path
    ? redactTracePath(media.screenshot.path, sensitiveValues, maxStringLength)
    : undefined;
  const frame = media.screencast && Number.isFinite(media.screencast.frame)
    ? Math.max(0, Math.floor(media.screencast.frame))
    : undefined;
  if (!screenshotPath && frame === undefined) return undefined;
  return immutableCopy({
    ...(screenshotPath ? {
      screenshot: {
        path: screenshotPath,
        ...(typeof media.screenshot?.index === "number"
          ? { index: Math.max(0, Math.floor(media.screenshot.index)) }
          : {}),
      },
    } : {}),
    ...(frame !== undefined ? {
      screencast: {
        frame,
        ...(validTimestamp(media.screencast?.timestamp)
          ? { timestamp: validTimestamp(media.screencast?.timestamp)! }
          : {}),
      },
    } : {}),
  });
}

function sanitizeContentBoundary(
  boundary: ToolContentBoundary,
  sensitiveValues: string[],
  maxStringLength: number,
): ToolContentBoundary {
  if (boundary.source === "browser") {
    return immutableCopy({
      source: "browser",
      trust: "untrusted",
      url: redactTraceUrl(boundary.url, maxStringLength, sensitiveValues),
    });
  }
  if (boundary.source === "mixed") {
    return immutableCopy({
      source: "mixed",
      trust: "untrusted",
      browser: {
        source: "browser",
        trust: "untrusted",
        url: redactTraceUrl(boundary.browser.url, maxStringLength, sensitiveValues),
      },
    });
  }
  return immutableCopy(boundary);
}

function redactTracePath(value: string, sensitiveValues: string[], maxStringLength: number) {
  const redacted = redactTraceText(value, sensitiveValues, maxStringLength)
    .replace(
      /((?:password|passwd|passcode|secret|token|api[_-]?key|authorization|cookie|credential|session)[/\\])([^/\\]+)/gi,
      "$1[REDACTED]",
    );
  return boundedString(redacted, maxStringLength);
}

function approvalFromMetadata(metadata: Record<string, unknown> | undefined, maxStringLength: number) {
  const approval = metadata?.approval;
  if (approval && typeof approval === "object") {
    const value = approval as Record<string, unknown>;
    const status = value.status === "approved" || value.status === "denied" ? value.status : undefined;
    if (status) {
      return {
        status,
        ...(typeof value.policy === "string" ? { policy: boundedString(value.policy, maxStringLength) } : {}),
        ...(typeof value.category === "string" ? { category: boundedString(value.category, maxStringLength) } : {}),
        ...(typeof value.reason === "string" ? { reason: boundedString(value.reason, maxStringLength) } : {}),
      } satisfies TraceApproval;
    }
  }
  if (metadata?.policyBlocked === true) {
    return {
      status: "denied",
      ...(typeof metadata.policyCode === "string" ? { policy: boundedString(metadata.policyCode, maxStringLength) } : {}),
      ...(typeof metadata.policyCategory === "string" ? { category: boundedString(metadata.policyCategory, maxStringLength) } : {}),
    } satisfies TraceApproval;
  }
  return undefined;
}

function policyFromMetadata(
  metadata: Record<string, unknown> | undefined,
  maxStringLength: number,
): TracePolicyDecision | undefined {
  if (metadata?.policyBlocked !== true) return undefined;
  const code = typeof metadata.policyCode === "string"
    ? boundedString(metadata.policyCode, maxStringLength)
    : undefined;
  const toolName = typeof metadata.policyTool === "string"
    ? boundedString(metadata.policyTool, maxStringLength)
    : undefined;
  const category = typeof metadata.policyCategory === "string"
    ? boundedString(metadata.policyCategory, maxStringLength)
    : undefined;
  const decision = typeof metadata.policyDecision === "string"
    ? boundedString(metadata.policyDecision, maxStringLength)
    : undefined;
  if (!code || !toolName || !category || !decision) return undefined;
  return {
    code,
    toolName,
    category,
    decision,
    ...(typeof metadata.policyPhase === "string"
      ? { phase: boundedString(metadata.policyPhase, maxStringLength) }
      : {}),
    ...(typeof metadata.policyOrigin === "string"
      ? { origin: boundedString(metadata.policyOrigin, maxStringLength) }
      : {}),
  };
}

function mediaFromMetadata(metadata: Record<string, unknown> | undefined, maxStringLength: number) {
  const screenshotPath = typeof metadata?.stepScreenshotPath === "string"
    ? metadata.stepScreenshotPath
    : typeof metadata?.path === "string" ? metadata.path : undefined;
  const frame = typeof metadata?.screencastFrameSequence === "number"
    ? metadata.screencastFrameSequence
    : undefined;
  if (!screenshotPath && frame === undefined) return undefined;
  return {
    ...(screenshotPath ? {
      screenshot: {
        path: boundedString(screenshotPath, maxStringLength),
        ...(typeof metadata?.traceScreenshotIndex === "number" ? { index: metadata.traceScreenshotIndex } : {}),
      },
    } : {}),
    ...(frame !== undefined ? {
      screencast: {
        frame: Math.max(0, Math.floor(frame)),
        ...(typeof metadata?.screencastFrameTimestamp === "number"
          ? { timestamp: new Date(metadata.screencastFrameTimestamp).toISOString() }
          : {}),
      },
    } : {}),
  } satisfies TraceMediaPosition;
}

function normalizeIdentity(identity: TraceIdentity | undefined, maxStringLength: number) {
  if (!identity) return undefined;
  const identityLength = Math.min(maxStringLength, MAX_IDENTITY_LENGTH);
  const normalized = {
    ...(identity.sessionId
      ? { sessionId: redactTraceText(identity.sessionId, [], identityLength) }
      : {}),
    ...(identity.agentId
      ? { agentId: redactTraceText(identity.agentId, [], identityLength) }
      : {}),
  };
  return Object.keys(normalized).length ? immutableCopy(normalized) : undefined;
}

function traceExport(
  identity: TraceIdentity | undefined,
  omittedEvents: number,
  events: HarnessTraceEvent[],
): HarnessTraceExport {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    ...(identity ? { identity } : {}),
    omittedEvents,
    events,
  };
}

function redactionSummary(value: unknown) {
  if (typeof value === "string") return { redacted: true, type: "string", length: value.length };
  if (Array.isArray(value)) return { redacted: true, type: "array", length: value.length };
  return { redacted: true, type: value === null ? "null" : typeof value };
}

function boundedString(value: string, max: number) {
  const string = String(value);
  return string.length <= max ? string : `${string.slice(0, Math.max(0, max - 1))}…`;
}

function boundUtf8(value: string, maxBytes: number) {
  const encoded = Buffer.from(value, "utf8");
  if (encoded.byteLength <= maxBytes) return value;
  const marker = Buffer.from("\n[trace output truncated]", "utf8");
  if (marker.byteLength >= maxBytes) return asciiPrefix(marker, maxBytes);
  let prefix = encoded.subarray(0, maxBytes - marker.byteLength).toString("utf8");
  while (Buffer.byteLength(prefix, "utf8") + marker.byteLength > maxBytes) prefix = prefix.slice(0, -1);
  return `${prefix}${marker.toString("utf8")}`;
}

function asciiPrefix(value: Buffer, maxBytes: number) {
  return value.subarray(0, maxBytes).toString("ascii");
}

function containsSensitiveValue(value: string, sensitiveValues: string[]) {
  return sensitiveValues.some((sensitive) => sensitive && value.includes(sensitive));
}

function decodeUrlComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value!)));
}

function boundedDuration(value: number) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Number(Math.min(value, 24 * 60 * 60 * 1_000).toFixed(1));
}

function validTimestamp(value: string | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function immutableCopy<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => immutableCopy(entry))) as T;
  if (value && typeof value === "object") {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, immutableCopy(entry)]),
    )) as T;
  }
  return value;
}
