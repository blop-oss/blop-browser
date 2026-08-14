import { readFileSync } from "node:fs";
import type { HarnessSessionMetrics } from "../../src/session-metrics.js";

type BenchmarkAction = {
  name?: string;
  output?: unknown;
  metadata?: { error?: unknown };
};

type BenchmarkResult = {
  status?: string;
  durationMs?: number;
  actions?: BenchmarkAction[];
  sessionMetrics?: HarnessSessionMetrics;
};

type BenchmarkRun = {
  results?: BenchmarkResult[];
};

type BenchmarkEvent = {
  event_type?: string;
  metadata?: {
    input?: number;
    output?: number;
    is_error?: boolean;
  };
};

export type BenchmarkEvidenceExpectations = {
  urlIncludes?: string;
  titleIncludes?: string;
  textIncludes?: string;
};

export function summarizeMind2WebMetrics(
  run: BenchmarkRun,
  events: BenchmarkEvent[],
  expectations: BenchmarkEvidenceExpectations = {},
) {
  const result = run.results?.[0];
  const actions = result?.actions ?? [];
  const usage = events
    .filter((event) => event.event_type === "usage")
    .map((event) => event.metadata ?? {});
  const actionToolErrors = actions.filter((action) => action.metadata?.error).length;
  const eventToolErrors = events.filter((event) =>
    event.event_type === "step_complete" && event.metadata?.is_error
  ).length;
  const toolErrors = Math.max(actionToolErrors, eventToolErrors);
  const agentPassed = result?.status === "passed" ? 1 : 0;
  const evidencePassed = benchmarkEvidencePassed(actions, expectations) ? 1 : 0;
  const inputUsage = exactProviderUsage(usage, "input");
  const outputUsage = exactProviderUsage(usage, "output");
  const usageAvailability = usage.length === 0
    ? "unavailable"
    : inputUsage !== null && outputUsage !== null
    ? "provider-reported"
    : "partial";
  const sessionMetrics = result?.sessionMetrics;
  const durationAvailable = typeof result?.durationMs === "number" &&
    Number.isFinite(result.durationMs) && result.durationMs >= 0;

  return {
    passed: agentPassed === 1 && evidencePassed === 1 && toolErrors === 0 ? 1 : 0,
    agent_passed: agentPassed,
    evidence_passed: evidencePassed,
    llm_calls: usage.length,
    output_tokens: outputUsage,
    actions: actions.length,
    snapshots: actions.filter((action) => action.name === "browser_snapshot").length,
    total_input_tokens: inputUsage,
    peak_input_tokens: exactProviderPeak(usage, "input"),
    token_usage_availability: usageAvailability,
    token_usage_source: usage.length ? "host-provider-usage-events" : null,
    token_usage_tokenizer: null,
    token_usage_note: usageAvailability === "provider-reported"
      ? "Exact provider-reported counts; tokenizer and accounting rules are provider-specific."
      : "Token counts are null because complete provider-reported usage was unavailable; character counts are not converted to tokens.",
    duration_ms: durationAvailable ? result!.durationMs! : null,
    duration_source: durationAvailable ? "host-result" : null,
    session_metrics_saturated: sessionMetrics?.saturated ?? null,
    session_commands: sessionMetrics?.commands.total ?? null,
    session_commands_succeeded: sessionMetrics?.commands.succeeded ?? null,
    session_commands_failed: sessionMetrics?.commands.failed ?? null,
    session_snapshots: sessionMetrics?.commands.snapshots ?? null,
    session_unclassified_actions:
      sessionMetrics?.commands.unclassifiedActions ?? null,
    session_unclassified_retries:
      sessionMetrics?.commands.unclassifiedRetries ?? null,
    command_retries: sessionMetrics?.commands.retries.observed ?? null,
    command_retry_scope: sessionMetrics?.commands.retries.scope ?? null,
    approvals_requested: sessionMetrics?.commands.approvals.requested ?? null,
    approvals_approved: sessionMetrics?.commands.approvals.approved ?? null,
    approvals_denied: sessionMetrics?.commands.approvals.denied ?? null,
    command_duration_ms: sessionMetrics?.commands.duration.totalMs ?? null,
    tool_input_characters: sessionMetrics?.payloads.toolInput.characters ?? null,
    tool_input_utf8_bytes: sessionMetrics?.payloads.toolInput.utf8Bytes ?? null,
    tool_input_unmeasured: sessionMetrics?.payloads.toolInput.unmeasured ?? null,
    tool_output_characters: sessionMetrics?.payloads.toolOutput.characters ?? null,
    tool_output_utf8_bytes: sessionMetrics?.payloads.toolOutput.utf8Bytes ?? null,
    tool_output_unmeasured:
      sessionMetrics?.payloads.toolOutput.unmeasured ?? null,
    snapshot_output_characters: sessionMetrics?.payloads.snapshotOutput.characters ?? null,
    snapshot_output_utf8_bytes: sessionMetrics?.payloads.snapshotOutput.utf8Bytes ?? null,
    snapshot_output_unmeasured:
      sessionMetrics?.payloads.snapshotOutput.unmeasured ?? null,
    model_images: sessionMetrics?.payloads.modelImages.count ?? null,
    model_image_data_url_characters:
      sessionMetrics?.payloads.modelImages.dataUrlCharacters ?? null,
    model_image_data_url_utf8_bytes:
      sessionMetrics?.payloads.modelImages.dataUrlUtf8Bytes ?? null,
    model_images_unmeasured:
      sessionMetrics?.payloads.modelImages.unmeasured ?? null,
    payload_character_unit: sessionMetrics ? "unicode-code-points" : null,
    payload_byte_encoding: sessionMetrics ? "utf-8" : null,
    action_tool_errors: actionToolErrors,
    event_tool_errors: eventToolErrors,
    tool_errors: toolErrors,
  };
}

function exactProviderUsage(
  usage: Array<{ input?: number; output?: number }>,
  field: "input" | "output",
) {
  if (
    usage.length === 0 ||
    usage.some((item) =>
      !Number.isSafeInteger(item[field]) || Number(item[field]) < 0
    )
  ) {
    return null;
  }
  const total = usage.reduce((sum, item) => sum + Number(item[field]), 0);
  return Number.isSafeInteger(total) ? total : null;
}

function exactProviderPeak(
  usage: Array<{ input?: number; output?: number }>,
  field: "input" | "output",
) {
  const total = exactProviderUsage(usage, field);
  return total === null
    ? null
    : Math.max(...usage.map((item) => Number(item[field])));
}

function benchmarkEvidencePassed(
  actions: BenchmarkAction[],
  expectations: BenchmarkEvidenceExpectations,
) {
  const required = [expectations.urlIncludes, expectations.titleIncludes, expectations.textIncludes]
    .some((value) => Boolean(value));
  if (!required) return true;

  let finalSnapshot: { url?: unknown; title?: unknown; text?: unknown } | undefined;
  let finalSnapshotIndex = -1;
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];
    if (action.name !== "browser_snapshot" || typeof action.output !== "string") continue;
    try {
      finalSnapshot = JSON.parse(action.output) as typeof finalSnapshot;
      finalSnapshotIndex = index;
    } catch {
      // A malformed snapshot cannot serve as benchmark evidence.
    }
  }
  if (!finalSnapshot || finalSnapshotIndex < 0) return false;

  const stateChangingTools = new Set([
    "browser_goto", "browser_click", "browser_double_click", "browser_press",
    "browser_type", "browser_go_back", "browser_go_forward", "browser_reload",
    "browser_select_page", "browser_close_page",
  ]);
  if (actions.slice(finalSnapshotIndex + 1).some((action) => stateChangingTools.has(action.name ?? ""))) {
    return false;
  }

  const url = String(finalSnapshot.url ?? "");
  const title = String(finalSnapshot.title ?? "");
  const text = String(finalSnapshot.text ?? "").replace(/\s+/g, " ").trim();
  const expectedText = expectations.textIncludes?.replace(/\s+/g, " ").trim();
  return (!expectations.urlIncludes || url.includes(expectations.urlIncludes))
    && (!expectations.titleIncludes || title.includes(expectations.titleIncludes))
    && (!expectedText || text.includes(expectedText));
}

if (import.meta.main) {
  const report = process.argv[2];
  if (!report) throw new Error("Report directory is required.");
  const run = JSON.parse(readFileSync(`${report}/results.json`, "utf8")) as BenchmarkRun;
  const events = readFileSync(`${report}/events.jsonl`, "utf8")
    .trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as BenchmarkEvent);
  const metrics = summarizeMind2WebMetrics(run, events, {
    urlIncludes: process.env.MIND2WEB_EXPECT_URL_CONTAINS,
    titleIncludes: process.env.MIND2WEB_EXPECT_TITLE_CONTAINS,
    textIncludes: process.env.MIND2WEB_EXPECT_TEXT_CONTAINS,
  });
  for (const [name, value] of Object.entries(metrics)) {
    console.log(`METRIC ${name}=${value}`);
  }
  if (metrics.passed !== 1) process.exitCode = 1;
}
