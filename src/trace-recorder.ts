import type { HarnessAction } from "./types.js";

const DEFAULT_MAX_EVENTS = 100;
const MIN_MAX_EVENTS = 1;
const MAX_MAX_EVENTS = 5_000;
const DEFAULT_MAX_STRING_LENGTH = 1_000;
const MIN_MAX_STRING_LENGTH = 64;
const MAX_MAX_STRING_LENGTH = 8_000;
const DEFAULT_MAX_EXPORT_BYTES = 768 * 1024;
const MIN_MAX_EXPORT_BYTES = 16 * 1024;
const MAX_MAX_EXPORT_BYTES = 4 * 1024 * 1024;
const MAX_INPUT_FIELDS = 20;
const MAX_ARRAY_ITEMS = 20;
const MAX_INPUT_DEPTH = 4;
const MAX_INPUT_NODES = 80;
const MAX_TARGET_REFS = 20;

const STATE_CHANGING_COMMANDS = new Set([
  "browser_goto",
  "browser_reload",
  "browser_go_back",
  "browser_go_forward",
  "browser_click",
  "browser_click_at",
  "browser_double_click",
  "browser_right_click",
  "browser_hover",
  "browser_drag_and_drop",
  "browser_type",
  "browser_press",
  "browser_tab",
  "browser_focus",
  "browser_blur",
  "browser_clear",
  "browser_check",
  "browser_uncheck",
  "browser_select_option",
  "browser_upload_file",
  "browser_set_viewport",
  "browser_screenshot",
  "browser_select_page",
  "browser_close_page",
  "browser_run_steps",
  "record_critical_point",
  "finish_test",
]);

const SENSITIVE_KEY_PATTERN = /(?:password|passwd|passcode|secret|token|api[_-]?key|authorization|cookie|credential|session|credit|card|cvv|cvc|ssn|email)/i;
const VALUE_KEY_PATTERN = /^(?:value|values|path|paths|file|files)$/i;

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
  result?: string;
  error?: string;
  approval?: TraceApproval;
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
  const storedEvents: HarnessTraceEvent[] = [];
  let omittedEvents = 0;
  let nextSequence = 1;

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
      const event: HarnessTraceEvent = {
        sequence: nextSequence,
        timestamp: validTimestamp(context.startedAt) ?? validTimestamp(action.timestamp) ?? new Date().toISOString(),
        completedAt: validTimestamp(context.completedAt) ?? validTimestamp(action.timestamp) ?? new Date().toISOString(),
        durationMs: boundedDuration(action.durationMs),
        ...(identity ? { identity } : {}),
        stateChanging: context.stateChanging ?? isStateChangingCommand(action.name),
        command: boundedString(action.name, maxStringLength),
        input: redactTraceInput(action.name, action.input, maxStringLength),
        targetRefs: collectTargetRefs(action.input),
        url: {
          before: redactTraceUrl(context.urlBefore ?? "", maxStringLength),
          after: redactTraceUrl(context.urlAfter ?? context.urlBefore ?? "", maxStringLength),
        },
        status: failed ? "failed" : "succeeded",
        ...(failed ? { error: output } : { result: output }),
        ...(context.approval ?? approvalFromMetadata(action.metadata, maxStringLength)
          ? { approval: immutableCopy(context.approval ?? approvalFromMetadata(action.metadata, maxStringLength)!) }
          : {}),
        ...(context.media ?? mediaFromMetadata(action.metadata, maxStringLength)
          ? { media: immutableCopy(context.media ?? mediaFromMetadata(action.metadata, maxStringLength)!) }
          : {}),
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
    events: () => immutableCopy(storedEvents),
    snapshot,
    timeline: () => formatTraceTimeline(snapshot(), maxStringLength),
    json: (pretty = false) => JSON.stringify(snapshot(), null, pretty ? 2 : undefined),
    clear: () => {
      storedEvents.length = 0;
      omittedEvents = 0;
      nextSequence = 1;
    },
  };
}

export function isStateChangingCommand(command: string) {
  return STATE_CHANGING_COMMANDS.has(command);
}

export function formatTraceTimeline(
  trace: HarnessTraceExport,
  maxStringLength = DEFAULT_MAX_STRING_LENGTH,
) {
  const identity = [
    trace.identity?.sessionId ? `session=${trace.identity.sessionId}` : "",
    trace.identity?.agentId ? `agent=${trace.identity.agentId}` : "",
  ].filter(Boolean).join(" ");
  const header = `Browser trace${identity ? ` (${identity})` : ""}: ${trace.events.length} event(s)`
    + (trace.omittedEvents ? `, ${trace.omittedEvents} older event(s) omitted` : "");
  if (trace.events.length === 0) return `${header}.`;

  const lines = trace.events.map((event) => {
    const status = event.status === "succeeded" ? "OK" : "ERROR";
    const mutation = event.stateChanging ? "write" : "read";
    const navigation = event.url.before !== event.url.after
      ? ` ${event.url.before || "<blank>"} -> ${event.url.after || "<blank>"}`
      : event.url.after ? ` ${event.url.after}` : "";
    const refs = event.targetRefs.length ? ` refs=${event.targetRefs.join(",")}` : "";
    const approval = event.approval
      ? ` approval=${event.approval.status}${event.approval.policy ? `:${event.approval.policy}` : ""}`
      : "";
    const media = [
      event.media?.screenshot ? `screenshot=${event.media.screenshot.index ?? "?"}:${event.media.screenshot.path}` : "",
      event.media?.screencast ? `frame=${event.media.screencast.frame}` : "",
    ].filter(Boolean).join(" ");
    const outcome = boundedString(event.error ?? event.result ?? "", Math.min(maxStringLength, 300));
    return `${String(event.sequence).padStart(4, "0")} ${event.timestamp} ${status} [${mutation}] ${event.command}`
      + `${navigation}${refs}${approval}${media ? ` ${media}` : ""}${outcome ? ` — ${outcome}` : ""}`;
  });
  return `${header}\n${lines.join("\n")}`;
}

export function redactTraceInput(
  command: string,
  input: Record<string, unknown>,
  maxStringLength = DEFAULT_MAX_STRING_LENGTH,
): Readonly<Record<string, unknown>> {
  const budget = { nodes: MAX_INPUT_NODES };
  return immutableCopy(redactObject(command, input, [], maxStringLength, budget));
}

export function redactTraceUrl(value: string, maxStringLength = DEFAULT_MAX_STRING_LENGTH) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.username) url.username = "[REDACTED]";
    if (url.password) url.password = "[REDACTED]";
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, "[REDACTED]");
    if (url.hash) url.hash = "#[REDACTED]";
    return boundedString(url.href, maxStringLength);
  } catch {
    return redactTraceText(value, [], maxStringLength);
  }
}

function redactObject(
  command: string,
  input: Record<string, unknown>,
  path: string[],
  maxStringLength: number,
  budget: { nodes: number },
) {
  const entries = Object.entries(input).slice(0, MAX_INPUT_FIELDS).map(([key, value]) => {
    budget.nodes -= 1;
    if (budget.nodes < 0) return [key, "[omitted: node limit]"];
    if (shouldRedactInput(command, key, path)) return [key, redactionSummary(value)];
    if (/url/i.test(key) && typeof value === "string") return [key, redactTraceUrl(value, maxStringLength)];
    return [key, redactValue(command, value, [...path, key], maxStringLength, budget)];
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
): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return boundedString(value, maxStringLength);
  if (path.length >= MAX_INPUT_DEPTH) return "[omitted: depth limit]";
  if (Array.isArray(value)) {
    const values = value.slice(0, MAX_ARRAY_ITEMS).map((entry) => {
      budget.nodes -= 1;
      return budget.nodes < 0
        ? "[omitted: node limit]"
        : redactValue(command, entry, path, maxStringLength, budget);
    });
    if (value.length > values.length) values.push(`[omitted ${value.length - values.length} item(s)]`);
    return values;
  }
  if (typeof value === "object") {
    return redactObject(command, value as Record<string, unknown>, path, maxStringLength, budget);
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
  let redacted = String(value);
  for (const sensitive of sensitiveValues) redacted = redacted.split(sensitive).join("[REDACTED]");
  redacted = redacted
    .replace(/(bearer\s+)[a-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(/((?:password|passwd|passcode|secret|token|api[_-]?key|authorization|cookie|credential)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/https?:\/\/[^\s<>"']+/gi, (url) => redactTraceUrl(url, maxStringLength));
  return boundedString(redacted.replace(/\s+/g, " ").trim(), maxStringLength);
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
  const normalized = {
    ...(identity.sessionId ? { sessionId: boundedString(identity.sessionId, maxStringLength) } : {}),
    ...(identity.agentId ? { agentId: boundedString(identity.agentId, maxStringLength) } : {}),
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
