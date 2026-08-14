import { describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildMind2WebPrompt,
  loadMind2WebTasks,
  resolveMind2WebAntiBot,
  runMind2WebTask,
  type Mind2WebAgentAdapter,
  type Mind2WebTask,
} from "../../benchmarks/mind2web/core.js";
import { createTempDir } from "../fixtures/files.js";
import { startFixtureServer } from "../fixtures/server.js";
import { summarizeMind2WebMetrics } from "../../benchmarks/mind2web/metrics.js";

describe("Mind2Web benchmark", () => {
  test("loads and filters normalized tasks", async () => {
    const temp = await createTempDir();
    try {
      const tasksPath = join(temp.dir, "tasks.json");
      await writeFile(tasksPath, JSON.stringify([
        task({ id: "one", website: "weather", split: "test_task" }),
        task({ id: "two", website: "reddit", split: "test_domain" }),
      ]));

      expect(loadMind2WebTasks(tasksPath, { website: "WEATHER", limit: 1 }))
        .toHaveLength(1);
      expect(loadMind2WebTasks(tasksPath, { split: "test_domain" })[0].id)
        .toBe("two");
      expect(loadMind2WebTasks(tasksPath, { id: "one" })[0].website)
        .toBe("weather");
    } finally {
      await temp.cleanup();
    }
  });

  test("runs through an injected agent adapter", async () => {
    const server = await startFixtureServer([
      { path: "/", body: "<main><h1>Forecast</h1></main>" },
    ]);
    const agent: Mind2WebAgentAdapter = {
      name: "deterministic-test-agent",
      async run({ tools }) {
        await tool(tools, "browser_goto").execute({ url: server.url });
        await tool(tools, "browser_expect_text").execute({ text: "Forecast" });
        await tool(tools, "finish_test").execute({
          status: "passed",
          reason: "Forecast loaded.",
        });
      },
    };

    try {
       const result = await runMind2WebTask({
         task: task({ start_url: server.url }),
         agent,
         antiBot: "off",
       });
      expect(result.status).toBe("passed");
      expect(result.agent).toBe("deterministic-test-agent");
      expect(result.actions.map((action) => action.name)).toEqual([
        "browser_goto",
        "browser_expect_text",
        "finish_test",
      ]);
      expect(result.sessionMetrics).toMatchObject({
        commands: { total: 3 },
        tokenUsage: { availability: "unavailable", totalTokens: null },
      });
      const metrics = summarizeMind2WebMetrics({ results: [result] }, []);
      expect(metrics).toMatchObject({
        session_commands: 3,
        session_commands_succeeded: 3,
        session_commands_failed: 0,
        payload_character_unit: "unicode-code-points",
        payload_byte_encoding: "utf-8",
        token_usage_tokenizer: null,
      });
    } finally {
      await server.close();
    }
  });

  test("defaults live Mind2Web anti-bot to on", () => {
    const previous = process.env.BLOP_BROWSER_ANTI_BOT;
    const previousMind2Web = process.env.MIND2WEB_ANTI_BOT;
    delete process.env.BLOP_BROWSER_ANTI_BOT;
    delete process.env.MIND2WEB_ANTI_BOT;
    try {
      expect(resolveMind2WebAntiBot()).toBe("on");
      expect(resolveMind2WebAntiBot("off")).toBe("off");
    } finally {
      if (previous === undefined) delete process.env.BLOP_BROWSER_ANTI_BOT;
      else process.env.BLOP_BROWSER_ANTI_BOT = previous;
      if (previousMind2Web === undefined) delete process.env.MIND2WEB_ANTI_BOT;
      else process.env.MIND2WEB_ANTI_BOT = previousMind2Web;
    }
  });

  test("builds a host-neutral task prompt", () => {
    const prompt = buildMind2WebPrompt(task());
    expect(prompt).toContain("call finish_test");
    expect(prompt).toContain("copy exact URLs, titles, and visible phrases");
    expect(prompt).toContain("never reuse a ref from the previous page");
    expect(prompt).toContain("one final browser_snapshot");
  });

  test("counts recorded action errors missing from runner events", () => {
    const metrics = summarizeMind2WebMetrics({
      results: [{
        status: "passed",
        actions: [
          { name: "browser_snapshot" },
          { name: "browser_type", metadata: { error: "fill failed" } },
          { name: "finish_test" },
        ],
      }],
    }, [
      { event_type: "usage", metadata: { input: 10, output: 2 } },
    ]);

    expect(metrics.event_tool_errors).toBe(0);
    expect(metrics.action_tool_errors).toBe(1);
    expect(metrics.tool_errors).toBe(1);
    expect(metrics.total_input_tokens).toBe(10);
    expect(metrics.output_tokens).toBe(2);
    expect(metrics.token_usage_availability).toBe("provider-reported");
    expect(metrics.agent_passed).toBe(1);
    expect(metrics.evidence_passed).toBe(1);
    expect(metrics.passed).toBe(0);
  });

  test("uses null instead of fabricated token or duration values", () => {
    const unavailable = summarizeMind2WebMetrics({
      results: [{ actions: [{ name: "browser_snapshot", output: "abc" }] }],
    }, []);
    expect(unavailable.total_input_tokens).toBeNull();
    expect(unavailable.output_tokens).toBeNull();
    expect(unavailable.peak_input_tokens).toBeNull();
    expect(unavailable.duration_ms).toBeNull();
    expect(unavailable.token_usage_availability).toBe("unavailable");
    expect(unavailable.token_usage_source).toBeNull();

    const partial = summarizeMind2WebMetrics({ results: [{}] }, [
      { event_type: "usage", metadata: { input: 12 } },
    ]);
    expect(partial.total_input_tokens).toBe(12);
    expect(partial.output_tokens).toBeNull();
    expect(partial.token_usage_availability).toBe("partial");
    expect(partial.token_usage_note).toContain("not converted to tokens");
  });

  test("requires configured final-page evidence for a strict pass", () => {
    const result = (url: string, title: string, text: string) => summarizeMind2WebMetrics({
      results: [{
        status: "passed",
        actions: [
          { name: "browser_snapshot", output: JSON.stringify({ url, title, text }) },
          { name: "finish_test" },
        ],
      }],
    }, [], {
      urlIncludes: "/allenford/weekend",
      titleIncludes: "Weekend Forecast",
      textIncludes: "Weekend Forecast Allenford, ON",
    });

    expect(result(
      "https://weather.test/allenford/14-days",
      "14 Day Forecast",
      "Weekend Forecast Allenford, ON",
    ).passed).toBe(0);
    expect(result(
      "https://weather.test/allenford/weekend",
      "Weekend Forecast",
      "Weekend Forecast\nAllenford, ON",
    ).passed).toBe(1);
  });
});

function task(overrides: Partial<Mind2WebTask> = {}): Mind2WebTask {
  return {
    id: "task-id",
    split: "test_task",
    website: "weather",
    task: "Find the forecast.",
    start_url: "https://weather.example",
    ...overrides,
  };
}

function tool(tools: Parameters<Mind2WebAgentAdapter["run"]>[0]["tools"], name: string) {
  const found = tools.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Missing tool: ${name}`);
  return found;
}
