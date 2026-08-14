import { describe, expect, test } from "bun:test";
import {
  createSessionMetricsRecorder,
  emptySessionMetrics,
  MAX_SESSION_METRICS_BYTES,
  validateSessionMetrics,
  type SessionMetricsRecorder,
} from "../../src/session-metrics.js";
import type { HarnessAction } from "../../src/types.js";
import { setupToolPage, tool } from "./tool-fixture.js";

describe("browser session metrics", () => {
  test("records exact bounded command, payload, duration, retry, and approval totals", () => {
    const recorder = createSessionMetricsRecorder();
    const snapshotInput = { query: "café 🙂" };
    const snapshotOutput = "Result: café 🙂";

    recorder.recordAction(action("browser_snapshot", snapshotInput, snapshotOutput, 12.5));
    recorder.recordRetry("browser_expect_text");
    recorder.recordAction(action(
      "browser_expect_text",
      { text: "Ready" },
      "Found visible text: Ready",
      105.2,
    ));
    recorder.recordAction(action(
      "browser_click",
      { target: { ref: "e2" } },
      "Approval denied.",
      3.1,
      {
        error: "Approval denied.",
        policyBlocked: true,
        policyCode: "approval_denied",
      },
    ));
    recorder.recordAction(action(
      "browser_type",
      { target: { ref: "e3" }, text: "secret-value" },
      "Typed secret-value",
      8,
      { approval: { status: "approved" } },
    ));
    recorder.recordRetry("caller-controlled-command");

    const metrics = recorder.snapshot();
    const snapshotJson = JSON.stringify(snapshotInput);

    expect(metrics.commands).toMatchObject({
      total: 4,
      succeeded: 3,
      failed: 1,
      snapshots: 1,
      unclassifiedRetries: 1,
      retries: {
        observed: 2,
        scope: "harness-owned retries after the first attempt",
      },
      approvals: { requested: 2, approved: 1, denied: 1 },
    });
    expect(metrics.payloads.toolInput).toEqual({
      characters: [...snapshotJson].length
        + [...JSON.stringify({ text: "Ready" })].length
        + [...JSON.stringify({ target: { ref: "e2" } })].length
        + [...JSON.stringify({ target: { ref: "e3" }, text: "secret-value" })].length,
      utf8Bytes: Buffer.byteLength(snapshotJson)
        + Buffer.byteLength(JSON.stringify({ text: "Ready" }))
        + Buffer.byteLength(JSON.stringify({ target: { ref: "e2" } }))
        + Buffer.byteLength(JSON.stringify({ target: { ref: "e3" }, text: "secret-value" })),
      unmeasured: 0,
    });
    expect(metrics.payloads.snapshotOutput).toEqual({
      characters: [...snapshotOutput].length,
      utf8Bytes: Buffer.byteLength(snapshotOutput),
      unmeasured: 0,
    });
    expect(metrics.commands.byCommand.map((entry) => entry.command)).toEqual([
      "browser_click",
      "browser_expect_text",
      "browser_snapshot",
      "browser_type",
    ]);
    expect(metrics.commands.byCommand.find((entry) =>
      entry.command === "browser_expect_text"
    )?.retries).toBe(1);
    expect(metrics.tokenUsage).toEqual(expect.objectContaining({
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      availability: "unavailable",
      source: null,
      tokenizer: null,
    }));
    expect(recorder.json()).not.toContain("secret-value");
  });

  test("keeps model-image volume exact and exports immutable bounded copies", () => {
    const recorder = createSessionMetricsRecorder();
    recorder.recordAction(
      action("browser_screenshot", {}, "Screenshot captured", 4),
      { modelImageDataUrls: ["data:image/png;base64,AAEC"] },
    );

    const metrics = recorder.snapshot();
    expect(metrics.payloads.modelImages).toEqual({
      count: 1,
      dataUrlCharacters: 26,
      dataUrlUtf8Bytes: 26,
      unmeasured: 0,
    });
    expect(Object.isFrozen(metrics)).toBe(true);
    expect(Object.isFrozen(metrics.commands.byCommand)).toBe(true);
    expect(Buffer.byteLength(recorder.json(), "utf8"))
      .toBeLessThanOrEqual(MAX_SESSION_METRICS_BYTES);
    expect(() => {
      (metrics.commands.byCommand as unknown as unknown[]).push({});
    }).toThrow();
  });

  test("continues aggregates as explicit active process segments", () => {
    const first = createSessionMetricsRecorder();
    first.recordAction(action("browser_snapshot", {}, "first", 2));
    const initial = first.snapshot();
    const resumed = createSessionMetricsRecorder({ initialMetrics: initial });
    resumed.recordAction(action("browser_snapshot", {}, "second", 3));

    const metrics = resumed.snapshot();
    expect(metrics.commands.total).toBe(2);
    expect(metrics.commands.snapshots).toBe(2);
    expect(metrics.observedActiveSegments).toBe(2);
    expect(metrics.observedActiveMs).toBeGreaterThanOrEqual(
      initial.observedActiveMs,
    );
    expect(metrics.timing.excludes).toContain(
      "inactive time between persistent session processes",
    );
  });

  test("validates retry, approval, and saturated active-time invariants", () => {
    const recorder = createSessionMetricsRecorder();
    recorder.recordRetry("caller-controlled-command");
    recorder.recordAction(action(
      "browser_click",
      {},
      "Approved",
      24 * 60 * 60 * 1_000 + 1,
      { approval: { status: "approved" } },
    ));
    const metrics = recorder.snapshot();

    expect(metrics.saturated).toBe(true);
    expect(metrics.commands.retries.observed).toBe(1);
    expect(metrics.commands.unclassifiedRetries).toBe(1);
    expect(() => validateSessionMetrics(metrics)).not.toThrow();

    const badRetries = structuredClone(metrics);
    badRetries.commands.retries.observed = 0;
    expect(() => validateSessionMetrics(badRetries)).toThrow(
      "command buckets don't match totals",
    );

    const badApprovals = structuredClone(metrics);
    badApprovals.commands.total = 0;
    badApprovals.commands.succeeded = 0;
    badApprovals.commands.duration = {
      totalMs: 0,
      minimumMs: null,
      maximumMs: null,
    };
    badApprovals.commands.byCommand[0]!.total = 0;
    badApprovals.commands.byCommand[0]!.succeeded = 0;
    badApprovals.commands.byCommand[0]!.duration = {
      totalMs: 0,
      minimumMs: null,
      maximumMs: null,
    };
    expect(() => validateSessionMetrics(badApprovals)).toThrow(
      "bucket approvals exceed command total",
    );

    const badApprovalReconciliation = structuredClone(metrics);
    badApprovalReconciliation.commands.approvals = {
      requested: 0,
      approved: 0,
      denied: 0,
    };
    expect(() => validateSessionMetrics(badApprovalReconciliation)).toThrow(
      "classified aggregates don't match commands",
    );

    const badOutcomeReconciliation = structuredClone(metrics);
    badOutcomeReconciliation.commands.byCommand[0]!.succeeded = 0;
    badOutcomeReconciliation.commands.byCommand[0]!.failed = 1;
    expect(() => validateSessionMetrics(badOutcomeReconciliation)).toThrow(
      "classified aggregates don't match commands",
    );

    const badPayloadReconciliation = structuredClone(metrics);
    badPayloadReconciliation.commands.byCommand[0]!.payloads.toolOutput.characters += 1;
    badPayloadReconciliation.commands.byCommand[0]!.payloads.toolOutput.utf8Bytes += 1;
    expect(() => validateSessionMetrics(badPayloadReconciliation)).toThrow(
      "classified aggregates don't match commands",
    );

    const saturatedInitial = structuredClone(emptySessionMetrics());
    saturatedInitial.observedActiveSegments = Number.MAX_SAFE_INTEGER;
    saturatedInitial.observedActiveMs = Number.MAX_SAFE_INTEGER;
    saturatedInitial.saturated = true;
    const resumed = createSessionMetricsRecorder({
      initialMetrics: saturatedInitial,
    }).snapshot();
    expect(resumed.observedActiveMs).toBe(Number.MAX_SAFE_INTEGER);
    expect(resumed.observedActiveSegments).toBe(Number.MAX_SAFE_INTEGER);
    expect(resumed.saturated).toBe(true);

    const withUnclassified = createSessionMetricsRecorder();
    withUnclassified.recordAction(action(
      "host_private_observation",
      { value: "host" },
      "Unclassified",
      7,
    ));
    withUnclassified.recordAction(action(
      "browser_snapshot",
      {},
      "Classified",
      3,
    ));
    expect(() => validateSessionMetrics(withUnclassified.snapshot()))
      .not.toThrow();
  });

  test("integrates with browser actions and counts only harness-owned retries", async () => {
    const recorder = createSessionMetricsRecorder();
    const fixture = await setupToolPage(`
      <main>
        <button onclick="this.textContent='Done'">Run</button>
        <p id="status">Waiting</p>
        <script>
          setTimeout(() => {
            document.querySelector('#status').textContent = 'Ready';
          }, 220);
        </script>
      </main>
    `, [], {
      sessionMetricsRecorder: recorder,
      safety: { approvalPolicy: () => ({ approved: true }) },
    });

    try {
      const snapshot = await tool(fixture.tools, "browser_snapshot").execute({});
      const ref = JSON.parse(snapshot.content).semanticSnapshot
        .match(/\[((?:f\d+)?e\d+|x\d+)\] button "Run"/)?.[1];
      await tool(fixture.tools, "browser_expect_text").execute({
        text: "Ready",
        timeoutMs: 2_000,
      });
      await tool(fixture.tools, "browser_click").execute({
        target: { ref },
      });

      const metrics = recorder.snapshot();
      expect(metrics.commands.total).toBe(4);
      expect(metrics.commands.snapshots).toBe(1);
      expect(metrics.commands.retries.observed).toBeGreaterThanOrEqual(1);
      expect(metrics.commands.approvals).toEqual({
        requested: 1,
        approved: 1,
        denied: 0,
      });
      expect(metrics.payloads.snapshotOutput.utf8Bytes)
        .toBe(Buffer.byteLength(snapshot.content));
    } finally {
      await fixture.cleanup();
    }
  }, 20_000);

  test("surfaces recorder failures without retrying a browser action", async () => {
    let clicks = 0;
    const broken: SessionMetricsRecorder = {
      recordAction: () => {
        throw new TypeError("private metrics sink detail");
      },
      recordRetry: () => {
        throw new TypeError("private retry sink detail");
      },
      snapshot: () => createSessionMetricsRecorder().snapshot(),
      json: () => "{}",
      clear: () => undefined,
    };
    const fixture = await setupToolPage(`
      <button onclick="document.body.dataset.count = String(Number(document.body.dataset.count || 0) + 1)">Run</button>
    `, [], { sessionMetricsRecorder: broken });

    try {
      await tool(fixture.tools, "browser_click").execute({ target: "Run" });
      clicks = Number(await fixture.page.locator("body").getAttribute("data-count"));
      expect(clicks).toBe(1);
      expect(fixture.actions.at(-1)?.metadata?.metricsRecordingError)
        .toBe("Session metrics recorder failed (TypeError).");
      expect(JSON.stringify(fixture.actions.at(-1)))
        .not.toContain("private metrics sink detail");
    } finally {
      await fixture.cleanup();
    }
  }, 15_000);

  test("records approved failures and policy denials as approval outcomes", async () => {
    const recorder = createSessionMetricsRecorder();
    let approvals = 0;
    const fixture = await setupToolPage(`<button>Present</button>`, [], {
      sessionMetricsRecorder: recorder,
      safety: {
        approvalPolicy: () => {
          approvals += 1;
          return approvals === 1
            ? { approved: true }
            : { approved: false, reason: "Denied by the test host." };
        },
      },
    });

    try {
      await expect(tool(fixture.tools, "browser_click").execute({
        target: { role: "button", name: "Missing" },
        timeoutMs: 50,
      })).rejects.toThrow();
      await expect(tool(fixture.tools, "browser_click").execute({
        target: "Present",
      })).rejects.toThrow("denied");

      expect(fixture.actions.at(-2)?.metadata?.approval).toEqual({
        status: "approved",
        policy: "approval-policy",
        category: "pointer",
      });
      expect(recorder.snapshot().commands.approvals).toEqual({
        requested: 2,
        approved: 1,
        denied: 1,
      });
    } finally {
      await fixture.cleanup();
    }
  }, 15_000);
});

function action(
  name: string,
  input: Record<string, unknown>,
  output: string,
  durationMs: number,
  metadata?: Record<string, unknown>,
): HarnessAction {
  return {
    name,
    input,
    output,
    metadata,
    timestamp: "2026-08-14T00:00:00.000Z",
    durationMs,
  };
}
