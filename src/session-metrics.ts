import type { HarnessAction } from "./types.js";
import { BROWSER_TRACE_COMMAND_KINDS } from "./trace-recorder.js";

export const MAX_SESSION_METRICS_BYTES = 64 * 1024;

const MAX_COUNTER = Number.MAX_SAFE_INTEGER;
const MAX_ACTION_DURATION_MS = 24 * 60 * 60 * 1_000;
const RETRY_SCOPE = "harness-owned retries after the first attempt";
const RETRY_EXCLUSIONS = [
  "Playwright internal locator and assertion polling",
  "network and page-load polling",
  "host or agent retries",
  "model-provider retries",
] as const;

type PublicBrowserCommand = keyof typeof BROWSER_TRACE_COMMAND_KINDS;

export type SessionMetricVolume = {
  /** Unicode code points, not JavaScript UTF-16 code units. */
  characters: number;
  utf8Bytes: number;
  unmeasured: number;
};

export type SessionMetricModelImages = {
  count: number;
  dataUrlCharacters: number;
  dataUrlUtf8Bytes: number;
  unmeasured: number;
};

export type SessionMetricDuration = {
  totalMs: number;
  minimumMs: number | null;
  maximumMs: number | null;
};

export type SessionMetricApprovals = {
  requested: number;
  approved: number;
  denied: number;
};

export type SessionCommandMetrics = {
  command: PublicBrowserCommand;
  total: number;
  succeeded: number;
  failed: number;
  snapshots: number;
  retries: number;
  approvals: SessionMetricApprovals;
  duration: SessionMetricDuration;
  payloads: {
    toolInput: SessionMetricVolume;
    toolOutput: SessionMetricVolume;
    snapshotOutput: SessionMetricVolume;
    modelImages: SessionMetricModelImages;
  };
};

export type HarnessSessionMetrics = {
  version: 1;
  generatedAt: string;
  firstObservedAt: string;
  observedActiveSegments: number;
  observedActiveMs: number;
  timing: {
    definition: "sum of active recorder process segments";
    excludes: readonly [
      "inactive time between persistent session processes",
      "browser process lifetime before recorder initialization",
    ];
  };
  saturated: boolean;
  commands: {
    total: number;
    succeeded: number;
    failed: number;
    snapshots: number;
    unclassifiedActions: number;
    unclassifiedRetries: number;
    retries: {
      observed: number;
      scope: typeof RETRY_SCOPE;
      excludes: typeof RETRY_EXCLUSIONS;
    };
    approvals: SessionMetricApprovals;
    duration: SessionMetricDuration;
    byCommand: readonly SessionCommandMetrics[];
  };
  payloads: {
    toolInput: SessionMetricVolume;
    toolOutput: SessionMetricVolume;
    snapshotOutput: SessionMetricVolume;
    modelImages: SessionMetricModelImages;
  };
  tokenUsage: {
    inputTokens: null;
    outputTokens: null;
    totalTokens: null;
    availability: "unavailable";
    source: null;
    tokenizer: null;
    note: string;
  };
};

export type SessionMetricsActionOptions = {
  modelImageDataUrls?: readonly string[];
};

export type SessionMetricsRecorder = {
  recordAction(action: HarnessAction, options?: SessionMetricsActionOptions): void;
  recordRetry(command: string): void;
  snapshot(): HarnessSessionMetrics;
  json(pretty?: boolean): string;
  clear(): void;
};

export type SessionMetricsRecorderOptions = {
  /** A previously validated aggregate. A new active timing segment starts when
   * this recorder is created; inactive time since the old process is excluded. */
  initialMetrics?: HarnessSessionMetrics;
};

type MutableDuration = SessionMetricDuration;
type MutableCommandMetrics = Omit<SessionCommandMetrics, "command">;

/**
 * Aggregate exact browser-tool measurements without retaining tool inputs,
 * page output, or other payload content.
 */
export function createSessionMetricsRecorder(
  options: SessionMetricsRecorderOptions = {},
): SessionMetricsRecorder {
  const initial = options.initialMetrics;
  if (initial) validateSessionMetrics(initial);
  let firstObservedAt = initial?.firstObservedAt ?? new Date().toISOString();
  let completedActiveMs = initial?.observedActiveMs ?? 0;
  let observedActiveSegments = initial?.observedActiveSegments ?? 0;
  let startedMonotonic = performance.now();
  let saturated = initial?.saturated ?? false;
  if (observedActiveSegments === MAX_COUNTER) saturated = true;
  else observedActiveSegments += 1;
  let total = initial?.commands.total ?? 0;
  let succeeded = initial?.commands.succeeded ?? 0;
  let failed = initial?.commands.failed ?? 0;
  let snapshots = initial?.commands.snapshots ?? 0;
  let unclassifiedActions = initial?.commands.unclassifiedActions ?? 0;
  let unclassifiedRetries = initial?.commands.unclassifiedRetries ?? 0;
  let retries = initial?.commands.retries.observed ?? 0;
  const approvals = cloneApprovals(initial?.commands.approvals);
  const duration = cloneDuration(initial?.commands.duration);
  const payloads = clonePayloads(initial?.payloads);
  const commands = new Map<PublicBrowserCommand, MutableCommandMetrics>(
    initial?.commands.byCommand.map((entry) => [
      entry.command,
      {
        total: entry.total,
        succeeded: entry.succeeded,
        failed: entry.failed,
        snapshots: entry.snapshots,
        retries: entry.retries,
        approvals: cloneApprovals(entry.approvals),
        duration: cloneDuration(entry.duration),
        payloads: clonePayloads(entry.payloads),
      },
    ]),
  );

  const add = (current: number, increment: number) => {
    const next = current + Math.max(0, increment);
    if (!Number.isFinite(next) || next > MAX_COUNTER) {
      saturated = true;
      return MAX_COUNTER;
    }
    return next;
  };

  const commandMetrics = (command: PublicBrowserCommand) => {
    let current = commands.get(command);
    if (!current) {
      current = {
        total: 0,
        succeeded: 0,
        failed: 0,
        snapshots: 0,
        retries: 0,
        approvals: emptyApprovals(),
        duration: emptyDuration(),
        payloads: emptyPayloads(),
      };
      commands.set(command, current);
    }
    return current;
  };

  const recordVolume = (
    aggregate: SessionMetricVolume,
    measured: MeasuredText | null,
  ) => {
    if (!measured) {
      aggregate.unmeasured = add(aggregate.unmeasured, 1);
      return;
    }
    aggregate.characters = add(aggregate.characters, measured.characters);
    aggregate.utf8Bytes = add(aggregate.utf8Bytes, measured.utf8Bytes);
  };

  const recordImages = (
    aggregate: SessionMetricModelImages,
    values: readonly string[] | undefined,
  ) => {
    for (const value of values ?? []) {
      if (typeof value !== "string") {
        aggregate.unmeasured = add(aggregate.unmeasured, 1);
        continue;
      }
      const measured = measureText(value);
      aggregate.count = add(aggregate.count, 1);
      aggregate.dataUrlCharacters = add(
        aggregate.dataUrlCharacters,
        measured.characters,
      );
      aggregate.dataUrlUtf8Bytes = add(
        aggregate.dataUrlUtf8Bytes,
        measured.utf8Bytes,
      );
    }
  };

  const snapshot = (): HarnessSessionMetrics => {
    const observedActiveMs = add(
      completedActiveMs,
      Math.max(0, performance.now() - startedMonotonic),
    );
    const result: HarnessSessionMetrics = {
      version: 1,
      generatedAt: new Date().toISOString(),
      firstObservedAt,
      observedActiveSegments,
      observedActiveMs: Number(observedActiveMs.toFixed(1)),
      timing: {
        definition: "sum of active recorder process segments",
        excludes: [
          "inactive time between persistent session processes",
          "browser process lifetime before recorder initialization",
        ],
      },
      saturated,
      commands: {
        total,
        succeeded,
        failed,
        snapshots,
        unclassifiedActions,
        unclassifiedRetries,
        retries: {
          observed: retries,
          scope: RETRY_SCOPE,
          excludes: RETRY_EXCLUSIONS,
        },
        approvals,
        duration,
        byCommand: [...commands.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([command, metrics]) => ({ command, ...metrics })),
      },
      payloads,
      tokenUsage: {
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        availability: "unavailable",
        source: null,
        tokenizer: null,
        note:
          "The harness records exact Unicode code points and UTF-8 bytes. It does not fabricate provider or tokenizer token counts.",
      },
    };
    return immutableCopy(result);
  };

  return {
    recordAction: (action, options = {}) => {
      const command = publicCommand(action.name);
      const failedAction = typeof action.metadata?.error === "string";
      const isSnapshot = action.name === "browser_snapshot";
      const actionDuration = boundedActionDuration(action.durationMs, () => {
        saturated = true;
      });
      const input = measureJson(action.input);
      const output = typeof action.output === "string"
        ? measureText(action.output)
        : null;
      const approval = observedApproval(action.metadata);

      total = add(total, 1);
      if (failedAction) failed = add(failed, 1);
      else succeeded = add(succeeded, 1);
      if (isSnapshot) snapshots = add(snapshots, 1);
      recordDuration(duration, actionDuration, add);
      recordVolume(payloads.toolInput, input);
      recordVolume(payloads.toolOutput, output);
      if (isSnapshot) recordVolume(payloads.snapshotOutput, output);
      recordImages(payloads.modelImages, options.modelImageDataUrls);
      if (approval) recordApproval(approvals, approval, add);

      if (!command) {
        unclassifiedActions = add(unclassifiedActions, 1);
        return;
      }
      const current = commandMetrics(command);
      current.total = add(current.total, 1);
      if (failedAction) current.failed = add(current.failed, 1);
      else current.succeeded = add(current.succeeded, 1);
      if (isSnapshot) current.snapshots = add(current.snapshots, 1);
      recordDuration(current.duration, actionDuration, add);
      recordVolume(current.payloads.toolInput, input);
      recordVolume(current.payloads.toolOutput, output);
      if (isSnapshot) recordVolume(current.payloads.snapshotOutput, output);
      recordImages(current.payloads.modelImages, options.modelImageDataUrls);
      if (approval) recordApproval(current.approvals, approval, add);
    },
    recordRetry: (name) => {
      const command = publicCommand(name);
      retries = add(retries, 1);
      if (!command) {
        unclassifiedRetries = add(unclassifiedRetries, 1);
        return;
      }
      const current = commandMetrics(command);
      current.retries = add(current.retries, 1);
    },
    snapshot,
    json: (pretty = false) => {
      const current = snapshot();
      const compact = JSON.stringify(current);
      const formatted = pretty ? JSON.stringify(current, null, 2) : compact;
      const output = Buffer.byteLength(formatted, "utf8") <= MAX_SESSION_METRICS_BYTES
        ? formatted
        : compact;
      if (Buffer.byteLength(output, "utf8") > MAX_SESSION_METRICS_BYTES) {
        throw new Error(
          `Session metrics exceed the ${MAX_SESSION_METRICS_BYTES}-byte limit.`,
        );
      }
      return output;
    },
    clear: () => {
      firstObservedAt = new Date().toISOString();
      completedActiveMs = 0;
      observedActiveSegments = 1;
      startedMonotonic = performance.now();
      saturated = false;
      total = 0;
      succeeded = 0;
      failed = 0;
      snapshots = 0;
      unclassifiedActions = 0;
      unclassifiedRetries = 0;
      retries = 0;
      Object.assign(approvals, emptyApprovals());
      Object.assign(duration, emptyDuration());
      Object.assign(payloads, emptyPayloads());
      commands.clear();
    },
  };
}

/** Return an immutable zero-command export without claiming an active segment. */
export function emptySessionMetrics(): HarnessSessionMetrics {
  const now = new Date().toISOString();
  return immutableCopy({
    version: 1,
    generatedAt: now,
    firstObservedAt: now,
    observedActiveSegments: 0,
    observedActiveMs: 0,
    timing: {
      definition: "sum of active recorder process segments",
      excludes: [
        "inactive time between persistent session processes",
        "browser process lifetime before recorder initialization",
      ],
    },
    saturated: false,
    commands: {
      total: 0,
      succeeded: 0,
      failed: 0,
      snapshots: 0,
      unclassifiedActions: 0,
      unclassifiedRetries: 0,
      retries: {
        observed: 0,
        scope: RETRY_SCOPE,
        excludes: RETRY_EXCLUSIONS,
      },
      approvals: emptyApprovals(),
      duration: emptyDuration(),
      byCommand: [],
    },
    payloads: emptyPayloads(),
    tokenUsage: {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      availability: "unavailable",
      source: null,
      tokenizer: null,
      note:
        "The harness records exact Unicode code points and UTF-8 bytes. It does not fabricate provider or tokenizer token counts.",
    },
  });
}

/** Validate a persisted or transported metrics aggregate before resuming it. */
export function validateSessionMetrics(
  value: unknown,
): asserts value is HarnessSessionMetrics {
  if (!isRecord(value) || Buffer.byteLength(JSON.stringify(value), "utf8") >
      MAX_SESSION_METRICS_BYTES) {
    throw new Error("Session metrics top-level contract is invalid.");
  }
  exactKeys(value, [
    "version",
    "generatedAt",
    "firstObservedAt",
    "observedActiveSegments",
    "observedActiveMs",
    "timing",
    "saturated",
    "commands",
    "payloads",
    "tokenUsage",
  ]);
  if (
    value.version !== 1 ||
    !validTimestamp(value.generatedAt) ||
    !validTimestamp(value.firstObservedAt) ||
    !boundedInteger(value.observedActiveSegments) ||
    !boundedNumber(value.observedActiveMs) ||
    typeof value.saturated !== "boolean"
  ) {
    throw new Error("Session metrics identity and timing are invalid.");
  }
  validateTiming(value.timing);
  const commandsValue = value.commands;
  if (!isRecord(commandsValue)) {
    throw new Error("Session metrics command totals are invalid.");
  }
  exactKeys(commandsValue, [
    "total",
    "succeeded",
    "failed",
    "snapshots",
    "unclassifiedActions",
    "unclassifiedRetries",
    "retries",
    "approvals",
    "duration",
    "byCommand",
  ]);
  for (const field of [
    "total",
    "succeeded",
    "failed",
    "snapshots",
    "unclassifiedActions",
    "unclassifiedRetries",
  ] as const) {
    if (!boundedInteger(commandsValue[field])) {
      throw new Error("Session metrics command counters are invalid.");
    }
  }
  const commandCounters = commandsValue as unknown as {
    total: number;
    succeeded: number;
    failed: number;
    snapshots: number;
    unclassifiedActions: number;
    unclassifiedRetries: number;
  };
  if (
    validatedSum(commandCounters.succeeded, commandCounters.failed) !==
      commandCounters.total
  ) {
    throw new Error("Session metrics command outcomes don't match total.");
  }
  const retryValue = commandsValue.retries;
  if (
    !isRecord(retryValue) ||
    !boundedInteger(retryValue.observed) ||
    retryValue.scope !== RETRY_SCOPE ||
    JSON.stringify(retryValue.excludes) !== JSON.stringify(RETRY_EXCLUSIONS)
  ) {
    throw new Error("Session metrics retry scope is invalid.");
  }
  validateApprovals(commandsValue.approvals);
  validateDuration(commandsValue.duration, commandCounters.total);
  validatePayloads(value.payloads);
  if (
    value.payloads.snapshotOutput.characters >
      value.payloads.toolOutput.characters ||
    value.payloads.snapshotOutput.utf8Bytes >
      value.payloads.toolOutput.utf8Bytes ||
    value.payloads.snapshotOutput.unmeasured >
      value.payloads.toolOutput.unmeasured
  ) {
    throw new Error("Session metrics snapshot volume exceeds tool output.");
  }
  if (
    !Array.isArray(commandsValue.byCommand) ||
    commandsValue.byCommand.length > Object.keys(BROWSER_TRACE_COMMAND_KINDS).length
  ) {
    throw new Error("Session metrics command buckets are invalid.");
  }
  const seen = new Set<string>();
  let bucketTotal = 0;
  let bucketSucceeded = 0;
  let bucketFailed = 0;
  let bucketRetries = 0;
  let bucketSnapshots = 0;
  let bucketDurationTotalMs = 0;
  let bucketMinimumMs: number | null = null;
  let bucketMaximumMs: number | null = null;
  const bucketApprovals = emptyApprovals();
  const bucketPayloads = emptyPayloads();
  for (const bucket of commandsValue.byCommand) {
    validateCommandBucket(bucket);
    if (seen.has(bucket.command)) {
      throw new Error("Session metrics command buckets must be unique.");
    }
    seen.add(bucket.command);
    bucketTotal = validatedSum(bucketTotal, bucket.total);
    bucketSucceeded = validatedSum(bucketSucceeded, bucket.succeeded);
    bucketFailed = validatedSum(bucketFailed, bucket.failed);
    bucketRetries = validatedSum(bucketRetries, bucket.retries);
    bucketSnapshots = validatedSum(bucketSnapshots, bucket.snapshots);
    bucketDurationTotalMs = validatedDurationSum(
      bucketDurationTotalMs,
      bucket.duration.totalMs,
    );
    if (bucket.duration.minimumMs !== null) {
      bucketMinimumMs = bucketMinimumMs === null
        ? bucket.duration.minimumMs
        : Math.min(bucketMinimumMs, bucket.duration.minimumMs);
    }
    if (bucket.duration.maximumMs !== null) {
      bucketMaximumMs = bucketMaximumMs === null
        ? bucket.duration.maximumMs
        : Math.max(bucketMaximumMs, bucket.duration.maximumMs);
    }
    bucketApprovals.requested = validatedSum(
      bucketApprovals.requested,
      bucket.approvals.requested,
    );
    bucketApprovals.approved = validatedSum(
      bucketApprovals.approved,
      bucket.approvals.approved,
    );
    bucketApprovals.denied = validatedSum(
      bucketApprovals.denied,
      bucket.approvals.denied,
    );
    addValidatedPayloads(bucketPayloads, bucket.payloads);
  }
  const sorted = [...seen].sort((left, right) => left.localeCompare(right));
  if (JSON.stringify([...seen]) !== JSON.stringify(sorted)) {
    throw new Error("Session metrics command buckets must be sorted.");
  }
  if (
    validatedSum(bucketTotal, commandCounters.unclassifiedActions) !==
      commandCounters.total ||
    validatedSum(bucketRetries, commandCounters.unclassifiedRetries) !==
      retryValue.observed ||
    bucketSnapshots !== commandCounters.snapshots
  ) {
    throw new Error("Session metrics command buckets don't match totals.");
  }
  const commandApprovals = commandsValue.approvals as SessionMetricApprovals;
  const commandDuration = commandsValue.duration as SessionMetricDuration;
  const unclassified = commandCounters.unclassifiedActions;
  if (
    commandApprovals.requested > commandCounters.total ||
    commandCounters.snapshots > commandCounters.total ||
    commandCounters.unclassifiedActions > commandCounters.total ||
    !classifiedTotalMatches(bucketSucceeded, commandCounters.succeeded, unclassified) ||
    !classifiedTotalMatches(bucketFailed, commandCounters.failed, unclassified) ||
    !classifiedTotalMatches(
      bucketApprovals.requested,
      commandApprovals.requested,
      unclassified,
    ) ||
    !classifiedTotalMatches(
      bucketApprovals.approved,
      commandApprovals.approved,
      unclassified,
    ) ||
    !classifiedTotalMatches(
      bucketApprovals.denied,
      commandApprovals.denied,
      unclassified,
    ) ||
    !classifiedNumberMatches(
      bucketDurationTotalMs,
      commandDuration.totalMs,
      unclassified,
    ) ||
    !classifiedDurationRangeMatches(
      {
        totalMs: bucketDurationTotalMs,
        minimumMs: bucketMinimumMs,
        maximumMs: bucketMaximumMs,
      },
      commandDuration,
      unclassified,
    ) ||
    !classifiedPayloadsMatch(bucketPayloads, value.payloads, unclassified)
  ) {
    throw new Error("Session metrics classified aggregates don't match commands.");
  }
  if (
    value.observedActiveSegments === 0 &&
    (commandCounters.total > 0 || value.observedActiveMs > 0)
  ) {
    throw new Error("Session metrics inactive timing doesn't match commands.");
  }
  validateTokenUsage(value.tokenUsage);
}

type MeasuredText = { characters: number; utf8Bytes: number };

function measureText(value: string): MeasuredText {
  let characters = 0;
  for (const _character of value) characters += 1;
  return { characters, utf8Bytes: Buffer.byteLength(value, "utf8") };
}

function measureJson(value: unknown) {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? measureText(serialized) : null;
  } catch {
    return null;
  }
}

function publicCommand(value: string): PublicBrowserCommand | undefined {
  return Object.hasOwn(BROWSER_TRACE_COMMAND_KINDS, value)
    ? value as PublicBrowserCommand
    : undefined;
}

function emptyVolume(): SessionMetricVolume {
  return { characters: 0, utf8Bytes: 0, unmeasured: 0 };
}

function emptyModelImages(): SessionMetricModelImages {
  return {
    count: 0,
    dataUrlCharacters: 0,
    dataUrlUtf8Bytes: 0,
    unmeasured: 0,
  };
}

function emptyApprovals(): SessionMetricApprovals {
  return { requested: 0, approved: 0, denied: 0 };
}

function emptyDuration(): MutableDuration {
  return { totalMs: 0, minimumMs: null, maximumMs: null };
}

function emptyPayloads() {
  return {
    toolInput: emptyVolume(),
    toolOutput: emptyVolume(),
    snapshotOutput: emptyVolume(),
    modelImages: emptyModelImages(),
  };
}

function cloneApprovals(
  value: SessionMetricApprovals | undefined,
): SessionMetricApprovals {
  return value ? { ...value } : emptyApprovals();
}

function cloneDuration(
  value: SessionMetricDuration | undefined,
): SessionMetricDuration {
  return value ? { ...value } : emptyDuration();
}

function clonePayloads(value: SessionCommandMetrics["payloads"] | undefined) {
  return value
    ? {
        toolInput: { ...value.toolInput },
        toolOutput: { ...value.toolOutput },
        snapshotOutput: { ...value.snapshotOutput },
        modelImages: { ...value.modelImages },
      }
    : emptyPayloads();
}

function recordDuration(
  duration: MutableDuration,
  value: number,
  add: (current: number, increment: number) => number,
) {
  duration.totalMs = add(duration.totalMs, value);
  duration.minimumMs = duration.minimumMs === null
    ? value
    : Math.min(duration.minimumMs, value);
  duration.maximumMs = duration.maximumMs === null
    ? value
    : Math.max(duration.maximumMs, value);
}

function observedApproval(metadata: Record<string, unknown> | undefined) {
  const approval = metadata?.approval;
  if (approval && typeof approval === "object") {
    const status = (approval as Record<string, unknown>).status;
    if (status === "approved" || status === "denied") return status;
  }
  return metadata?.policyBlocked === true &&
      metadata.policyCode === "approval_denied"
    ? "denied"
    : undefined;
}

function recordApproval(
  aggregate: SessionMetricApprovals,
  status: "approved" | "denied",
  add: (current: number, increment: number) => number,
) {
  aggregate.requested = add(aggregate.requested, 1);
  aggregate[status] = add(aggregate[status], 1);
}

function boundedActionDuration(value: number, saturate: () => void) {
  if (!Number.isFinite(value) || value < 0) {
    saturate();
    return 0;
  }
  if (value > MAX_ACTION_DURATION_MS) saturate();
  return Number(Math.min(value, MAX_ACTION_DURATION_MS).toFixed(1));
}

function immutableCopy<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => immutableCopy(entry))) as T;
  }
  if (value && typeof value === "object") {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, immutableCopy(entry)]),
    )) as T;
  }
  return value;
}

function validateTiming(value: unknown) {
  if (!isRecord(value)) throw new Error("Session metrics timing is invalid.");
  exactKeys(value, ["definition", "excludes"]);
  if (
    value.definition !== "sum of active recorder process segments" ||
    JSON.stringify(value.excludes) !==
      JSON.stringify([
        "inactive time between persistent session processes",
        "browser process lifetime before recorder initialization",
      ])
  ) {
    throw new Error("Session metrics timing definition is invalid.");
  }
}

function validateCommandBucket(value: unknown): asserts value is SessionCommandMetrics {
  if (!isRecord(value)) {
    throw new Error("Session metrics command bucket is invalid.");
  }
  exactKeys(value, [
    "command",
    "total",
    "succeeded",
    "failed",
    "snapshots",
    "retries",
    "approvals",
    "duration",
    "payloads",
  ]);
  if (
    !publicCommand(String(value.command)) ||
    !boundedInteger(value.total) ||
    !boundedInteger(value.succeeded) ||
    !boundedInteger(value.failed) ||
    !boundedInteger(value.snapshots) ||
    !boundedInteger(value.retries) ||
    validatedSum(value.succeeded, value.failed) !== value.total ||
    value.snapshots > value.total ||
    (value.command !== "browser_snapshot" && value.snapshots !== 0)
  ) {
    throw new Error("Session metrics command bucket counters are invalid.");
  }
  validateApprovals(value.approvals);
  if (value.approvals.requested > value.total) {
    throw new Error("Session metrics bucket approvals exceed command total.");
  }
  validateDuration(value.duration, value.total);
  validatePayloads(value.payloads);
}

function validateApprovals(value: unknown): asserts value is SessionMetricApprovals {
  if (!isRecord(value)) {
    throw new Error("Session metrics approvals are invalid.");
  }
  exactKeys(value, ["requested", "approved", "denied"]);
  if (
    !boundedInteger(value.requested) ||
    !boundedInteger(value.approved) ||
    !boundedInteger(value.denied) ||
    validatedSum(value.approved, value.denied) !== value.requested
  ) {
    throw new Error("Session metrics approval counters are invalid.");
  }
}

function validateDuration(
  value: unknown,
  observations: number,
): asserts value is SessionMetricDuration {
  if (!isRecord(value)) {
    throw new Error("Session metrics duration is invalid.");
  }
  exactKeys(value, ["totalMs", "minimumMs", "maximumMs"]);
  if (
    !boundedNumber(value.totalMs) ||
    (value.minimumMs !== null && !boundedNumber(value.minimumMs)) ||
    (value.maximumMs !== null && !boundedNumber(value.maximumMs)) ||
    (observations === 0 &&
      (value.totalMs !== 0 || value.minimumMs !== null || value.maximumMs !== null)) ||
    (observations > 0 &&
      (value.minimumMs === null || value.maximumMs === null ||
        value.minimumMs > value.maximumMs || value.maximumMs > value.totalMs ||
        value.maximumMs > MAX_ACTION_DURATION_MS))
  ) {
    throw new Error("Session metrics duration fields are inconsistent.");
  }
}

function validatePayloads(
  value: unknown,
): asserts value is HarnessSessionMetrics["payloads"] {
  if (!isRecord(value)) {
    throw new Error("Session metrics payload totals are invalid.");
  }
  exactKeys(value, [
    "toolInput",
    "toolOutput",
    "snapshotOutput",
    "modelImages",
  ]);
  for (const field of ["toolInput", "toolOutput", "snapshotOutput"] as const) {
    validateVolume(value[field]);
  }
  const images = value.modelImages;
  if (!isRecord(images)) {
    throw new Error("Session metrics model-image totals are invalid.");
  }
  exactKeys(images, [
    "count",
    "dataUrlCharacters",
    "dataUrlUtf8Bytes",
    "unmeasured",
  ]);
  if (
    !boundedInteger(images.count) ||
    !boundedInteger(images.dataUrlCharacters) ||
    !boundedInteger(images.dataUrlUtf8Bytes) ||
    !boundedInteger(images.unmeasured) ||
    images.dataUrlUtf8Bytes < images.dataUrlCharacters
  ) {
    throw new Error("Session metrics model-image counters are invalid.");
  }
}

function validateVolume(value: unknown): asserts value is SessionMetricVolume {
  if (!isRecord(value)) {
    throw new Error("Session metrics text volume is invalid.");
  }
  exactKeys(value, ["characters", "utf8Bytes", "unmeasured"]);
  if (
    !boundedInteger(value.characters) ||
    !boundedInteger(value.utf8Bytes) ||
    !boundedInteger(value.unmeasured) ||
    value.utf8Bytes < value.characters
  ) {
    throw new Error("Session metrics text-volume counters are invalid.");
  }
}

function validateTokenUsage(value: unknown) {
  if (!isRecord(value)) {
    throw new Error("Session metrics token availability is invalid.");
  }
  exactKeys(value, [
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "availability",
    "source",
    "tokenizer",
    "note",
  ]);
  if (
    value.inputTokens !== null ||
    value.outputTokens !== null ||
    value.totalTokens !== null ||
    value.availability !== "unavailable" ||
    value.source !== null ||
    value.tokenizer !== null ||
    value.note !==
      "The harness records exact Unicode code points and UTF-8 bytes. It does not fabricate provider or tokenizer token counts."
  ) {
    throw new Error("Session metrics must not fabricate token counts.");
  }
}

function exactKeys(value: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
    throw new Error("Session metrics contain unexpected or missing fields.");
  }
}

function boundedInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) &&
    value >= 0 && value <= MAX_COUNTER;
}

function validatedSum(left: number, right: number) {
  const total = left + right;
  if (!Number.isSafeInteger(total) || total > MAX_COUNTER) {
    throw new Error("Session metrics bucket totals exceed the numeric bound.");
  }
  return total;
}

function validatedDurationSum(left: number, right: number) {
  const total = left + right;
  if (!Number.isFinite(total) || total > MAX_COUNTER) {
    throw new Error("Session metrics bucket durations exceed the numeric bound.");
  }
  return Number(total.toFixed(1));
}

function addValidatedPayloads(
  aggregate: HarnessSessionMetrics["payloads"],
  current: HarnessSessionMetrics["payloads"],
) {
  for (const field of ["toolInput", "toolOutput", "snapshotOutput"] as const) {
    for (const counter of ["characters", "utf8Bytes", "unmeasured"] as const) {
      aggregate[field][counter] = validatedSum(
        aggregate[field][counter],
        current[field][counter],
      );
    }
  }
  for (const counter of [
    "count",
    "dataUrlCharacters",
    "dataUrlUtf8Bytes",
    "unmeasured",
  ] as const) {
    aggregate.modelImages[counter] = validatedSum(
      aggregate.modelImages[counter],
      current.modelImages[counter],
    );
  }
}

function classifiedTotalMatches(
  classified: number,
  aggregate: number,
  unclassifiedActions: number,
) {
  return unclassifiedActions === 0
    ? classified === aggregate
    : classified <= aggregate;
}

function classifiedNumberMatches(
  classified: number,
  aggregate: number,
  unclassifiedActions: number,
) {
  const difference = Math.abs(classified - aggregate);
  return unclassifiedActions === 0
    ? difference <= 0.05
    : classified <= aggregate + 0.05;
}

function classifiedDurationRangeMatches(
  classified: SessionMetricDuration,
  aggregate: SessionMetricDuration,
  unclassifiedActions: number,
) {
  if (unclassifiedActions === 0) {
    return nullableNumberMatches(classified.minimumMs, aggregate.minimumMs) &&
      nullableNumberMatches(classified.maximumMs, aggregate.maximumMs);
  }
  if (classified.minimumMs === null || classified.maximumMs === null) {
    return true;
  }
  return aggregate.minimumMs !== null && aggregate.maximumMs !== null &&
    aggregate.minimumMs <= classified.minimumMs + 0.05 &&
    aggregate.maximumMs + 0.05 >= classified.maximumMs;
}

function nullableNumberMatches(left: number | null, right: number | null) {
  return left === null || right === null
    ? left === right
    : Math.abs(left - right) <= 0.05;
}

function classifiedPayloadsMatch(
  classified: HarnessSessionMetrics["payloads"],
  aggregate: HarnessSessionMetrics["payloads"],
  unclassifiedActions: number,
) {
  for (const field of ["toolInput", "toolOutput", "snapshotOutput"] as const) {
    for (const counter of ["characters", "utf8Bytes", "unmeasured"] as const) {
      if (!classifiedTotalMatches(
        classified[field][counter],
        aggregate[field][counter],
        unclassifiedActions,
      )) return false;
    }
  }
  for (const counter of [
    "count",
    "dataUrlCharacters",
    "dataUrlUtf8Bytes",
    "unmeasured",
  ] as const) {
    if (!classifiedTotalMatches(
      classified.modelImages[counter],
      aggregate.modelImages[counter],
      unclassifiedActions,
    )) return false;
  }
  return true;
}

function boundedNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 &&
    value <= MAX_COUNTER;
}

function validTimestamp(value: unknown) {
  return typeof value === "string" && value.length <= 64 &&
    Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
