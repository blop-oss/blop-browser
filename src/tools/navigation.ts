import type { BrowserToolContext, NativeToolBridge } from "./types.js";
import { selectorFor } from "./locators.js";
import { assertWithRetry } from "./expect.js";

export function createNavigationTools(context: BrowserToolContext): NativeToolBridge[] {
  return [
    {
      name: "browser_goto",
      description: "Navigate the browser to a URL.",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
      promptSnippet: "- browser_goto: Navigate to a URL in the test browser.",
      execute: (input) => context.record("browser_goto", input, async () => {
        let url = selectorFor(input.url);
        if (context.baseUrl) {
          url = new URL(url, context.baseUrl).href;
        }
        await context.page.goto(url, { waitUntil: "domcontentloaded" });
        // Many production pages mount consent, auth, or hydration surfaces
        // between DOMContentLoaded and the final load event. Give that phase a
        // bounded chance to settle so the first snapshot does not advertise a
        // control that will be covered before the model can act on it.
        const loadSettled = await context.page.waitForLoadState("load", { timeout: 5000 })
          .then(() => true, () => false);
        return { content: `Navigated to ${url}`, metadata: { url: context.page.url(), loadSettled } };
      }),
    },
    {
      name: "browser_get_url",
      description: "Return the current browser URL.",
      parameters: { type: "object", properties: {} },
      promptSnippet: "- browser_get_url: Read the current URL when navigation state matters.",
      execute: (input) => context.record("browser_get_url", input, async () => {
        const url = context.page.url();
        return { content: url, metadata: { url } };
      }),
    },
    {
      name: "browser_expect_url",
      description: "Assert that the current URL contains or exactly equals expected text. Retries until timeoutMs, so it tolerates in-flight navigations.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
          exact: { type: "boolean" },
          timeoutMs: { type: "number" },
        },
        required: ["url"],
      },
      promptSnippet: "- browser_expect_url: Prefer this after dedicated-view navigation when the exact URL is already reported. Assert current URL, using exact=false for contains checks. Auto-retries.",
      execute: (input) => context.record("browser_expect_url", input, async ({ retry }) => {
        const expected = String(input.url ?? "");
        const exact = Boolean(input.exact);
        const actual = await assertWithRetry(context.page, input, async () => {
          const url = context.page.url();
          if (exact ? url !== expected : !url.includes(expected)) {
            throw new Error(`Expected URL ${exact ? "to equal" : "to contain"} ${expected}, received ${url}`);
          }
          return url;
        }, retry);
        return { content: `URL matched ${expected}`, metadata: { url: actual } };
      }),
    },
    {
      name: "browser_wait_for_url",
      description: "Wait for the current URL to contain or exactly equal expected text.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
          exact: { type: "boolean" },
          timeoutMs: { type: "number" },
        },
        required: ["url"],
      },
      promptSnippet: "- browser_wait_for_url: Wait for navigation or redirects to reach an expected URL.",
      execute: (input) => context.record("browser_wait_for_url", input, async () => {
        const expected = String(input.url ?? "");
        const exact = Boolean(input.exact);
        const timeout = Number(input.timeoutMs ?? 5000);
        await context.page.waitForURL((url) => exact ? url.href === expected : url.href.includes(expected), { timeout });
        return { content: `URL reached ${expected}`, metadata: { url: context.page.url() } };
      }),
    },
    {
      name: "browser_wait_for_network_idle",
      description: "Wait until the active page has no in-flight HTTP requests and remains quiet for idleMs. Use explicitly after SPA submissions or data loading when URL and DOM signals are insufficient; do not use by default on pages with polling or streaming connections.",
      parameters: {
        type: "object",
        properties: {
          timeoutMs: { type: "number", description: "Maximum wait time in ms (default 10000, max 60000)." },
          idleMs: { type: "number", description: "Required quiet window in ms (default 500, max 5000)." },
        },
      },
      promptSnippet: "- browser_wait_for_network_idle: Explicitly wait for active-page requests to finish after an SPA submit or async load. Avoid on polling, SSE, or streaming pages.",
      execute: (input) => context.record("browser_wait_for_network_idle", input, async () => {
        const timeoutMs = boundedMs(input.timeoutMs, 10_000, 100, 60_000);
        const idleMs = boundedMs(input.idleMs, 500, 0, 5_000);
        const activity = context.getNetworkActivity();
        const deadline = Date.now() + timeoutMs;
        while (Date.now() <= deadline) {
          if (activity.inflight.size === 0 && Date.now() - activity.lastActivity >= idleMs) {
            return {
              content: `Network was idle for ${idleMs}ms`,
              metadata: { idleMs, timeoutMs, inflightRequests: 0 },
            };
          }
          await new Promise((resolve) => setTimeout(resolve, Math.min(50, Math.max(10, idleMs))));
        }
        const pendingUrls = [...activity.inflight.values()].slice(0, 5);
        throw new Error(
          `Network did not become idle within ${timeoutMs}ms; ${activity.inflight.size} request(s) remain in flight.`
          + (pendingUrls.length ? ` Pending: ${pendingUrls.join(", ")}` : ""),
        );
      }),
    },
    {
      name: "browser_reload",
      description: "Reload the current page.",
      parameters: { type: "object", properties: {} },
      promptSnippet: "- browser_reload: Reload the current page.",
      execute: (input) => context.record("browser_reload", input, async () => {
        await context.page.reload({ waitUntil: "domcontentloaded" });
        return { content: "Reloaded page", metadata: { url: context.page.url() } };
      }),
    },
    {
      name: "browser_go_back",
      description: "Navigate back in browser history.",
      parameters: { type: "object", properties: {} },
      promptSnippet: "- browser_go_back: Navigate back in browser history.",
      execute: (input) => context.record("browser_go_back", input, async () => {
        await context.page.goBack({ waitUntil: "domcontentloaded" });
        return { content: "Went back", metadata: { url: context.page.url() } };
      }),
    },
    {
      name: "browser_go_forward",
      description: "Navigate forward in browser history.",
      parameters: { type: "object", properties: {} },
      promptSnippet: "- browser_go_forward: Navigate forward in browser history.",
      execute: (input) => context.record("browser_go_forward", input, async () => {
        await context.page.goForward({ waitUntil: "domcontentloaded" });
        return { content: "Went forward", metadata: { url: context.page.url() } };
      }),
    },
  ];
}

function boundedMs(value: unknown, fallback: number, min: number, max: number) {
  const requested = Number(value ?? fallback);
  if (!Number.isFinite(requested)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(requested)));
}
