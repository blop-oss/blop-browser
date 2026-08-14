import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertIgnoredSessionMetricsPath,
  assertLoopbackSessionUrl,
  hashRunnableDistJavaScript,
  loadSessionMetricsProtocol,
  runSessionMetricsProtocol,
  validateProtocol,
  validateReport,
  writeSessionMetricsReport,
} from "../../benchmarks/session-metrics/core.mjs";

const writtenFiles: string[] = [];
const temporaryDirectories: string[] = [];

afterAll(async () => {
  await Promise.all([
    ...writtenFiles.map((path) => rm(path, { force: true })),
    ...temporaryDirectories.map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  ]);
});

describe("local session metrics protocol", () => {
  test("pins the exact two-command workflow and three paired repetitions", async () => {
    const { protocol, sha256 } = await loadSessionMetricsProtocol();

    expect(protocol).toMatchObject({
      protocol_version: "1.0.0",
      repetitions: 3,
      target: {
        kind: "loopback-fixture",
        host: "127.0.0.1",
        path: "/session-metrics",
      },
      configuration: {
        interface: "built-node-cli",
        entry: "dist/cli.js",
        build_hash: "complete-dist-js-tree-v1",
        browser: "chromium",
        executable_source: "playwright-bundled",
        headless: true,
        profile: "persistent-fresh-per-repetition",
        commands: ["open", "snapshot"],
      },
      measurement_scope: {
        payload_characters: "Unicode code points",
        payload_bytes: "UTF-8 bytes",
      },
    });
    expect(sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  test("hashes every runnable dist JavaScript file, not only the entry", async () => {
    const directory = await temporaryBuild();
    const initial = await hashRunnableDistJavaScript(directory);
    const repeated = await hashRunnableDistJavaScript(directory);
    await writeFile(
      join(directory, "runtime.js"),
      "export const runtimeVersion = 2;\n",
    );
    const changed = await hashRunnableDistJavaScript(directory);

    expect(initial).toMatchObject({ files: 2 });
    expect(initial.bytes).toBeGreaterThan(0);
    expect(initial.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(repeated).toEqual(initial);
    expect(changed.sha256).not.toBe(initial.sha256);
    expect(changed.files).toBe(initial.files);
  });

  test("rejects protocol drift and every non-loopback target", async () => {
    const { protocol } = await loadSessionMetricsProtocol();
    const changed = structuredClone(protocol);
    changed.configuration.commands = ["snapshot"];
    expect(() => validateProtocol(changed)).toThrow(
      "doesn't match version 1.0.0",
    );

    expect(
      assertLoopbackSessionUrl("http://127.0.0.1:4173/session-metrics"),
    ).toBe("http://127.0.0.1:4173/session-metrics");
    for (const value of [
      "https://127.0.0.1:4173/session-metrics",
      "http://localhost:4173/session-metrics",
      "http://127.0.0.1:4173/other",
      "http://127.0.0.1:4173/session-metrics?url=https://example.com",
      "https://example.com/session-metrics",
    ]) {
      expect(() => assertLoopbackSessionUrl(value)).toThrow("127.0.0.1");
    }
  });

  test("retains all paired durations, metric deltas, versions, and failures", async () => {
    const calls: Array<{ session: string; command: string }> = [];
    const fixtureUrl = "http://127.0.0.1:4173/session-metrics";
    const report = await runSessionMetricsProtocol({
      cliEntry: await temporaryBuildEntry(),
      fixture: { url: fixtureUrl },
      now: () => new Date("2026-08-14T00:00:00.000Z"),
      runCli: fakeCli(calls, fixtureUrl),
    });

    expect(report.attempts).toHaveLength(3);
    expect(report.source).toEqual(
      expect.objectContaining({
        runnable_dist_js_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        runnable_dist_js_files: 2,
        runnable_dist_js_bytes: expect.any(Number),
      }),
    );
    expect(report.summary).toMatchObject({
      requested_repetitions: 3,
      completed_pairs: 3,
      failed_pairs: 0,
      failures: [],
    });
    for (const attempt of report.attempts) {
      expect(attempt.browser).toEqual({
        name: "chromium",
        version: "143.0.0.0",
        headless: true,
      });
      expect(attempt.cold_start).toMatchObject({
        status: "collected",
        metrics: expectedCompactMetrics(2),
      });
      expect(attempt.warm_resume).toMatchObject({
        status: "collected",
        metrics: expectedCompactMetrics(2),
      });
      expect(attempt.final_session_metrics).toEqual(expectedCompactMetrics(4));
    }
    expect(calls.filter((call) => call.command === "open")).toHaveLength(6);
    expect(calls.filter((call) => call.command === "snapshot")).toHaveLength(6);
    expect(validateReport(report)).toBe(report);
  });

  test("publishes failed phase evidence without selecting favorable pairs", async () => {
    const fixtureUrl = "http://127.0.0.1:4173/session-metrics";
    const runCli = fakeCli([], fixtureUrl, {
      failSession: "metrics-2",
      includeTemporaryPath: true,
    });
    const report = await runSessionMetricsProtocol({
      cliEntry: await temporaryBuildEntry(),
      fixture: { url: fixtureUrl },
      now: () => new Date("2026-08-14T00:00:00.000Z"),
      runCli,
    });

    expect(report.summary.completed_pairs).toBe(2);
    expect(report.summary.failed_pairs).toBe(1);
    expect(report.summary.failures).toEqual([
      expect.objectContaining({
        repetition: 2,
        phase: "cold_start",
        failure_class: "harness",
      }),
    ]);
    expect(report.summary.failures[0].reason).toContain("<temporary>");
    expect(report.summary.failures[0].reason).not.toContain(
      "/blop-session-metrics-",
    );
    expect(report.attempts[1].warm_resume.status).toBe("not_run");
    expect(validateReport(report)).toBe(report);
  });

  test("rejects unbounded, extra, or inconsistent report content", async () => {
    const fixtureUrl = "http://127.0.0.1:4173/session-metrics";
    const report = await runSessionMetricsProtocol({
      cliEntry: await temporaryBuildEntry(),
      fixture: { url: fixtureUrl },
      now: () => new Date("2026-08-14T00:00:00.000Z"),
      runCli: fakeCli([], fixtureUrl),
    });

    const extraPayload = structuredClone(report);
    extraPayload.attempts[0].cold_start.metrics.raw_content = "private";
    expect(() => validateReport(extraPayload)).toThrow(
      "fields don't match version 1.0.0",
    );

    const falseSummary = structuredClone(report);
    falseSummary.summary.completed_pairs = 2;
    expect(() => validateReport(falseSummary)).toThrow();

    const oversized = structuredClone(report);
    oversized.environment.platform = "x".repeat(300_000);
    expect(() => validateReport(oversized)).toThrow("262144-byte limit");
  });

  test("writes private raw reports only under the ignored result directory", async () => {
    const fixtureUrl = "http://127.0.0.1:4173/session-metrics";
    const report = await runSessionMetricsProtocol({
      cliEntry: await temporaryBuildEntry(),
      fixture: { url: fixtureUrl },
      now: () => new Date("2026-08-14T00:00:00.000Z"),
      runCli: fakeCli([], fixtureUrl),
    });
    const output = join(
      "benchmarks/session-metrics/.results",
      `test-${process.pid}.json`,
    );
    writtenFiles.push(await writeSessionMetricsReport(report, output));
    expect(assertIgnoredSessionMetricsPath(output).endsWith(output)).toBe(true);
    expect(await readFile(output, "utf8")).not.toContain("private");

    for (const value of [
      "benchmarks/session-metrics/result.json",
      "benchmarks/session-metrics/.results",
      "benchmarks/session-metrics/.results/result.txt",
      "/tmp/session-metrics.json",
    ]) {
      expect(() => assertIgnoredSessionMetricsPath(value)).toThrow(".results");
    }
  });

  test("ships a bounded schema and no live URL or repetition override", async () => {
    const [schema, runner] = await Promise.all([
      readFile("benchmarks/session-metrics/result.schema.json", "utf8"),
      readFile("benchmarks/session-metrics/run.mjs", "utf8"),
    ]);

    expect(schema).toContain('"additionalProperties": false');
    expect(schema).toContain('"payload_characters": {');
    expect(schema).toContain('"const": "Unicode code points"');
    expect(schema).toContain('"third_party_sites": { "const": false }');
    expect(runner).not.toContain('"--url"');
    expect(runner).not.toContain('"--repetitions"');
    expect(runner).toContain("It has no live-URL or repetition override.");
  });
});

async function temporaryBuild() {
  const directory = await mkdtemp(join(tmpdir(), "session-metrics-build-"));
  temporaryDirectories.push(directory);
  await Promise.all([
    writeFile(join(directory, "cli.js"), 'import "./runtime.js";\n'),
    writeFile(
      join(directory, "runtime.js"),
      "export const runtimeVersion = 1;\n",
    ),
  ]);
  return directory;
}

async function temporaryBuildEntry() {
  return join(await temporaryBuild(), "cli.js");
}

function fakeCli(
  calls: Array<{ session: string; command: string }>,
  fixtureUrl: string,
  options: { failSession?: string; includeTemporaryPath?: boolean } = {},
) {
  const totals = new Map<string, number>();
  const failed = new Set<string>();
  return async ({
    session,
    args,
    environment,
  }: {
    session: string;
    args: string[];
    environment: Record<string, string>;
  }) => {
    const command = args[0]!;
    calls.push({ session, command });
    if (
      options.failSession === session &&
      command === "snapshot" &&
      !failed.has(session)
    ) {
      failed.add(session);
      const temporaryPath = options.includeTemporaryPath
        ? ` at ${environment.BLOP_BROWSER_RUNTIME_DIR}/private-profile`
        : "";
      return envelope(null, 1, `Controlled snapshot failure${temporaryPath}.`);
    }
    if (command === "open") {
      totals.set(session, (totals.get(session) ?? 0) + 1);
      return envelope({ content: `Navigated to ${fixtureUrl}` });
    }
    if (command === "snapshot") {
      totals.set(session, (totals.get(session) ?? 0) + 1);
      return envelope({
        content: JSON.stringify({
          url: fixtureUrl,
          text: "blop-session-metrics-fixture-v1",
        }),
      });
    }
    if (command === "metrics") {
      return envelope(fullMetrics(totals.get(session) ?? 0));
    }
    if (command === "status") {
      return envelope({
        active: true,
        connection: "launch",
        browser: "chromium",
        browserVersion: "143.0.0.0",
        url: fixtureUrl,
        pid: 1234,
      });
    }
    if (command === "destroy") return envelope({ destroyed: true });
    return envelope(null, 1, `Unexpected command ${command}.`);
  };
}

function envelope(result: unknown, exitCode = 0, message?: string) {
  return {
    exitCode,
    response:
      exitCode === 0 ? { ok: true, result } : { ok: false, error: { message } },
    stdoutUtf8Bytes: 0,
    stderr: "",
  };
}

function fullMetrics(total: number) {
  return {
    version: 1,
    saturated: false,
    commands: {
      total,
      succeeded: total,
      failed: 0,
      snapshots: total / 2,
      unclassifiedActions: 0,
      unclassifiedRetries: 0,
      retries: { observed: 0 },
      approvals: { requested: 0, approved: 0, denied: 0 },
      duration: { totalMs: total * 5 },
    },
    payloads: {
      toolInput: {
        characters: total * 10,
        utf8Bytes: total * 10,
        unmeasured: 0,
      },
      toolOutput: {
        characters: total * 20,
        utf8Bytes: total * 20,
        unmeasured: 0,
      },
      snapshotOutput: {
        characters: total * 5,
        utf8Bytes: total * 5,
        unmeasured: 0,
      },
      modelImages: {
        count: 0,
        dataUrlCharacters: 0,
        dataUrlUtf8Bytes: 0,
        unmeasured: 0,
      },
    },
    tokenUsage: {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      availability: "unavailable",
      source: null,
      tokenizer: null,
    },
  };
}

function expectedCompactMetrics(total: number) {
  return {
    saturated: false,
    commands: {
      total,
      succeeded: total,
      failed: 0,
      snapshots: total / 2,
      unclassified_actions: 0,
      unclassified_retries: 0,
      retries: 0,
      approvals: { requested: 0, approved: 0, denied: 0 },
      duration_ms: total * 5,
    },
    payloads: {
      tool_input_characters: total * 10,
      tool_input_utf8_bytes: total * 10,
      tool_input_unmeasured: 0,
      tool_output_characters: total * 20,
      tool_output_utf8_bytes: total * 20,
      tool_output_unmeasured: 0,
      snapshot_output_characters: total * 5,
      snapshot_output_utf8_bytes: total * 5,
      snapshot_output_unmeasured: 0,
      model_images: 0,
      model_image_data_url_characters: 0,
      model_image_data_url_utf8_bytes: 0,
      model_images_unmeasured: 0,
    },
    tokens: {
      input: null,
      output: null,
      total: null,
      availability: "unavailable",
      source: null,
      tokenizer: null,
    },
  };
}
