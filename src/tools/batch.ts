import type { BrowserToolContext, NativeToolBridge } from "./types.js";

const MAX_STEPS = 20;

// Tools a batch may not contain: finishing must stay an explicit, single
// top-level decision, and nesting batches would defeat the step cap.
const EXCLUDED_TOOLS = new Set(["browser_run_steps", "finish_test"]);

/**
 * Execute a short sequence of browser tools in one agent turn. This adapts
 * Webwright's core idea — a known-deterministic flow should run as one program,
 * not one model round-trip per click — while keeping every operation inside
 * the controlled native-tool boundary (no arbitrary scripts, per AGENTS.md).
 * Each inner step still records its own action, so the visual trail and live
 * progress stream are unchanged. Execution stops at the first failing step and
 * reports per-step results so the agent can resume precisely.
 */
export function createBatchTool(tools: NativeToolBridge[], context: BrowserToolContext): NativeToolBridge {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  return {
    name: "browser_run_steps",
    description: `Run up to ${MAX_STEPS} browser tool steps in sequence in a single call. Stops at the first failing step and returns per-step results. Use for flows you can already predict (fill form then submit then assert); do not use while still exploring the page.`,
    parameters: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              tool: { type: "string", description: "Name of a browser tool, e.g. browser_click." },
              input: { type: "object", description: "Input object for that tool." },
            },
            required: ["tool"],
          },
        },
      },
      required: ["steps"],
    },
    promptSnippet: "- browser_run_steps: Batch a predictable sequence (navigate, fill, click, assert) into one call instead of one call per action. It stops at the first failure and tells you which step failed. Explore first; batch only steps you are confident about.",
    execute: (input) => context.record("browser_run_steps", input, async () => {
      const steps = Array.isArray(input.steps) ? input.steps : [];
      if (steps.length === 0) throw new Error("browser_run_steps requires a non-empty steps array.");
      if (steps.length > MAX_STEPS) throw new Error(`browser_run_steps supports at most ${MAX_STEPS} steps, received ${steps.length}.`);

      const results: { step: number; tool: string; status: "passed" | "failed"; output: string }[] = [];
      for (const [index, rawStep] of steps.entries()) {
        const step = (typeof rawStep === "object" && rawStep ? rawStep : {}) as { tool?: unknown; input?: unknown };
        const toolName = String(step.tool ?? "");
        const tool = byName.get(toolName);
        const stepInput = (typeof step.input === "object" && step.input ? step.input : {}) as Record<string, unknown>;

        if (!tool || EXCLUDED_TOOLS.has(toolName)) {
          results.push({ step: index + 1, tool: toolName, status: "failed", output: `Unknown or disallowed tool: ${toolName}` });
          break;
        }

        try {
          const result = await tool.execute(stepInput);
          results.push({ step: index + 1, tool: toolName, status: "passed", output: truncate(result.content) });
        } catch (error) {
          results.push({
            step: index + 1,
            tool: toolName,
            status: "failed",
            output: error instanceof Error ? error.message : String(error),
          });
          break;
        }
      }

      const failed = results.find((result) => result.status === "failed");
      const summary = {
        status: failed ? "failed" : "passed",
        completedSteps: results.filter((result) => result.status === "passed").length,
        totalSteps: steps.length,
        ...(failed ? { failedStep: failed.step } : {}),
        steps: results,
      };
      return {
        content: JSON.stringify(summary, null, 2),
        metadata: { status: summary.status, completedSteps: summary.completedSteps, totalSteps: steps.length, failedStep: failed?.step ?? null },
      };
    }),
  };
}

function truncate(value: string, max = 400) {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
