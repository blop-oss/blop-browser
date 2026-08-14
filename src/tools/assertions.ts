import type { BrowserToolContext, NativeToolBridge } from "./types.js";
import { locateAllTargets, locateTarget, selectorFor, targetParameterSchema } from "./locators.js";
import { assertWithRetry, describeFailure, timeoutFrom } from "./expect.js";

const timeoutParameter = {
  type: "number",
  description: "Max time in ms to keep retrying the assertion (default 5000).",
} satisfies Record<string, unknown>;

// Per-attempt budget for locator reads inside a retry loop. Kept short so the
// outer retryExpect deadline governs the overall wait, not a single stuck read.
const READ_TIMEOUT_MS = 1000;

export function createAssertionTools(context: BrowserToolContext): NativeToolBridge[] {
  return [
    {
      name: "browser_expect_text",
      description: "Assert that rendered text from browser_snapshot.text appears on the page, or inside a target element when target is given. Accessible control names and placeholders in semanticSnapshot are not page text; use browser_expect_visible with that control's ref instead. Rendered whitespace is normalized. Retries until timeoutMs.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string" },
          target: targetParameterSchema,
          timeoutMs: timeoutParameter,
        },
        required: ["text"],
      },
      promptSnippet: "- browser_expect_text: Assert one exact rendered phrase copied from browser_snapshot.text. Names and placeholders shown only in semanticSnapshot are not visible page text; verify those controls with browser_expect_visible and their ref. Whitespace is normalized. Auto-retries.",
      execute: (input) => context.record("browser_expect_text", input, async ({ retry }) => {
        const text = String(input.text ?? "");
        const target = selectorFor(input.target);
        if (target) {
          await assertWithRetry(context.page, input, async () => {
            const actual = await locateTarget(context.page, input.target).innerText({ timeout: READ_TIMEOUT_MS });
            if (!normalizeVisibleText(actual).includes(normalizeVisibleText(text))) {
              throw new Error(`Expected ${target} to contain text "${text}", received "${truncate(actual)}"`);
            }
          }, retry);
          return { content: `Found text in ${target}: ${text}` };
        }
        await assertPageContainsText(context.page, input, text, retry);
        return { content: `Found visible text: ${text}` };
      }),
    },
    {
      name: "browser_wait_for_text",
      description: "Wait for visible page text to appear.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string" },
          timeoutMs: { type: "number" },
        },
        required: ["text"],
      },
      promptSnippet: "- browser_wait_for_text: Wait for async UI text before continuing.",
      execute: (input) => context.record("browser_wait_for_text", input, async ({ retry }) => {
        const text = String(input.text ?? "");
        await assertPageContainsText(context.page, input, text, retry);
        return { content: `Waited for text: ${text}` };
      }),
    },
    {
      name: "browser_wait_for_selector",
      description: "Wait for a CSS or XPath selector to appear.",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string" },
          timeoutMs: { type: "number" },
        },
        required: ["selector"],
      },
      promptSnippet: "- browser_wait_for_selector: Wait for a selector when text or labels are insufficient.",
      execute: (input) => context.record("browser_wait_for_selector", input, async () => {
        const selector = String(input.selector ?? "");
        try {
          await context.page.locator(selector).first().waitFor({ timeout: timeoutFrom(input) });
        } catch (error) {
          throw await describeFailure(context.page, error);
        }
        return { content: `Waited for selector: ${selector}` };
      }),
    },
    {
      name: "browser_get_text",
      description: "Read visible text from an element or from the whole page body.",
      parameters: {
        type: "object",
        properties: { target: targetParameterSchema },
      },
      promptSnippet: "- browser_get_text: Read text from a target element or body for verification context.",
      execute: (input) => context.record("browser_get_text", input, async () => {
        const target = selectorFor(input.target);
        const locator = target ? locateTarget(context.page, input.target) : context.page.locator("body").first();
        const text = await locator.innerText({ timeout: 5000 });
        return { content: text, metadata: { target: target || "body" } };
      }),
    },
    {
      name: "browser_expect_visible",
      description: "Assert that an element is visible. Retries until timeoutMs.",
      parameters: {
        type: "object",
        properties: {
          target: targetParameterSchema,
          timeoutMs: timeoutParameter,
        },
        required: ["target"],
      },
      promptSnippet: "- browser_expect_visible: Assert that a target element is visible. Auto-retries.",
      execute: (input) => context.record("browser_expect_visible", input, async () => {
        const target = selectorFor(input.target);
        try {
          await locateTarget(context.page, input.target).waitFor({ state: "visible", timeout: timeoutFrom(input) });
        } catch (error) {
          throw await describeFailure(context.page, error);
        }
        return { content: `${target} is visible` };
      }),
    },
    {
      name: "browser_expect_hidden",
      description: "Assert that an element is hidden or detached. Retries until timeoutMs.",
      parameters: {
        type: "object",
        properties: {
          target: targetParameterSchema,
          timeoutMs: timeoutParameter,
        },
        required: ["target"],
      },
      promptSnippet: "- browser_expect_hidden: Assert that a target element is hidden or absent. Auto-retries.",
      execute: (input) => context.record("browser_expect_hidden", input, async () => {
        const target = selectorFor(input.target);
        try {
          await locateTarget(context.page, input.target).waitFor({ state: "hidden", timeout: timeoutFrom(input) });
        } catch (error) {
          throw await describeFailure(context.page, error);
        }
        return { content: `${target} is hidden` };
      }),
    },
    {
      name: "browser_expect_value",
      description: "Assert that an input, textarea, select, or editable element has an expected value. Retries until timeoutMs.",
      parameters: {
        type: "object",
        properties: {
          target: targetParameterSchema,
          value: { type: "string" },
          timeoutMs: timeoutParameter,
        },
        required: ["target", "value"],
      },
      promptSnippet: "- browser_expect_value: Assert the current value of a form field. Auto-retries.",
      execute: (input) => context.record("browser_expect_value", input, async ({ retry }) => {
        const target = selectorFor(input.target);
        const expected = String(input.value ?? "");
        const actual = await assertWithRetry(context.page, input, async () => {
          const value = await locateTarget(context.page, input.target).inputValue({ timeout: READ_TIMEOUT_MS });
          if (value !== expected) throw new Error(`Expected ${target} value to be ${expected}, received ${value}`);
          return value;
        }, retry);
        return { content: `${target} value matched ${expected}`, metadata: { value: actual } };
      }),
    },
    {
      name: "browser_expect_checked",
      description: "Assert that a checkbox or radio is checked or unchecked. Retries until timeoutMs.",
      parameters: {
        type: "object",
        properties: {
          target: targetParameterSchema,
          checked: { type: "boolean" },
          timeoutMs: timeoutParameter,
        },
        required: ["target"],
      },
      promptSnippet: "- browser_expect_checked: Assert checkbox/radio checked state; checked defaults to true. Auto-retries.",
      execute: (input) => context.record("browser_expect_checked", input, async ({ retry }) => {
        const target = selectorFor(input.target);
        const expected = input.checked === undefined ? true : Boolean(input.checked);
        const actual = await assertWithRetry(context.page, input, async () => {
          const checked = await locateTarget(context.page, input.target).isChecked({ timeout: READ_TIMEOUT_MS });
          if (checked !== expected) throw new Error(`Expected ${target} checked=${expected}, received ${checked}`);
          return checked;
        }, retry);
        return { content: `${target} checked state matched ${expected}`, metadata: { checked: actual } };
      }),
    },
    {
      name: "browser_expect_enabled",
      description: "Assert that an element is enabled. Retries until timeoutMs.",
      parameters: {
        type: "object",
        properties: {
          target: targetParameterSchema,
          timeoutMs: timeoutParameter,
        },
        required: ["target"],
      },
      promptSnippet: "- browser_expect_enabled: Assert that a target element is enabled. Auto-retries.",
      execute: (input) => context.record("browser_expect_enabled", input, async ({ retry }) => {
        const target = selectorFor(input.target);
        await assertWithRetry(context.page, input, async () => {
          const enabled = await locateTarget(context.page, input.target).isEnabled({ timeout: READ_TIMEOUT_MS });
          if (!enabled) throw new Error(`Expected ${target} to be enabled`);
        }, retry);
        return { content: `${target} is enabled` };
      }),
    },
    {
      name: "browser_expect_disabled",
      description: "Assert that an element is disabled. Retries until timeoutMs.",
      parameters: {
        type: "object",
        properties: {
          target: targetParameterSchema,
          timeoutMs: timeoutParameter,
        },
        required: ["target"],
      },
      promptSnippet: "- browser_expect_disabled: Assert that a target element is disabled. Auto-retries.",
      execute: (input) => context.record("browser_expect_disabled", input, async ({ retry }) => {
        const target = selectorFor(input.target);
        await assertWithRetry(context.page, input, async () => {
          const disabled = await locateTarget(context.page, input.target).isDisabled({ timeout: READ_TIMEOUT_MS });
          if (!disabled) throw new Error(`Expected ${target} to be disabled`);
        }, retry);
        return { content: `${target} is disabled` };
      }),
    },
    {
      name: "browser_expect_count",
      description: "Assert how many elements match a target: exact count, at_least, or at_most. Retries until timeoutMs.",
      parameters: {
        type: "object",
        properties: {
          target: targetParameterSchema,
          count: { type: "number" },
          comparison: { type: "string", enum: ["equal", "at_least", "at_most"] },
          timeoutMs: timeoutParameter,
        },
        required: ["target", "count"],
      },
      promptSnippet: "- browser_expect_count: Assert how many elements match a target (equal/at_least/at_most). Use for list sizes and result counts.",
      execute: (input) => context.record("browser_expect_count", input, async ({ retry }) => {
        const target = selectorFor(input.target);
        const expected = Number(input.count);
        if (!Number.isInteger(expected) || expected < 0) throw new Error("count must be a non-negative integer.");
        const comparison = input.comparison === "at_least" || input.comparison === "at_most" ? input.comparison : "equal";
        const actual = await assertWithRetry(context.page, input, async () => {
          const count = await locateAllTargets(context.page, input.target).count();
          const matches = comparison === "equal" ? count === expected
            : comparison === "at_least" ? count >= expected
            : count <= expected;
          if (!matches) throw new Error(`Expected ${target} to match ${comparison} ${expected} element(s), received ${count}`);
          return count;
        }, retry);
        return { content: `${target} matched ${actual} element(s) (${comparison} ${expected})`, metadata: { count: actual, comparison, expected } };
      }),
    },
    {
      name: "browser_expect_attribute",
      description: "Assert that an element has an attribute, optionally with an exact or contained value. Retries until timeoutMs.",
      parameters: {
        type: "object",
        properties: {
          target: targetParameterSchema,
          attribute: { type: "string" },
          value: { type: "string" },
          contains: { type: "boolean", description: "When true, assert the attribute value contains `value` instead of equaling it." },
          timeoutMs: timeoutParameter,
        },
        required: ["target", "attribute"],
      },
      promptSnippet: "- browser_expect_attribute: Assert attributes like href, class, aria-*, or data-state, exactly or with contains=true.",
      execute: (input) => context.record("browser_expect_attribute", input, async ({ retry }) => {
        const target = selectorFor(input.target);
        const attribute = String(input.attribute ?? "");
        const expected = input.value === undefined ? undefined : String(input.value);
        const contains = Boolean(input.contains);
        const actual = await assertWithRetry(context.page, input, async () => {
          const value = await locateTarget(context.page, input.target).getAttribute(attribute, { timeout: READ_TIMEOUT_MS });
          if (value === null) throw new Error(`Expected ${target} to have attribute ${attribute}`);
          if (expected !== undefined && (contains ? !value.includes(expected) : value !== expected)) {
            throw new Error(`Expected ${target} attribute ${attribute} to ${contains ? "contain" : "equal"} "${expected}", received "${truncate(value)}"`);
          }
          return value;
        }, retry);
        return { content: `${target} attribute ${attribute} matched`, metadata: { target, attribute, value: actual } };
      }),
    },
    {
      name: "browser_expect_focused",
      description: "Assert that an element currently has keyboard focus. Retries until timeoutMs.",
      parameters: {
        type: "object",
        properties: {
          target: targetParameterSchema,
          timeoutMs: timeoutParameter,
        },
        required: ["target"],
      },
      promptSnippet: "- browser_expect_focused: Assert a target element has keyboard focus, e.g. after Tab navigation or autofocus.",
      execute: (input) => context.record("browser_expect_focused", input, async ({ retry }) => {
        const target = selectorFor(input.target);
        await assertWithRetry(context.page, input, async () => {
          const focused = await locateTarget(context.page, input.target)
            .evaluate((element) => element === document.activeElement, undefined, { timeout: READ_TIMEOUT_MS });
          if (!focused) throw new Error(`Expected ${target} to be focused`);
        }, retry);
        return { content: `${target} is focused` };
      }),
    },
    {
      name: "browser_get_attribute",
      description: "Read an attribute from an element.",
      parameters: {
        type: "object",
        properties: {
          target: targetParameterSchema,
          attribute: { type: "string" },
        },
        required: ["target", "attribute"],
      },
      promptSnippet: "- browser_get_attribute: Read attributes like href, aria-label, title, or data-state.",
      execute: (input) => context.record("browser_get_attribute", input, async () => {
        const target = selectorFor(input.target);
        const attribute = String(input.attribute ?? "");
        const value = await locateTarget(context.page, input.target).getAttribute(attribute, { timeout: 5000 });
        return { content: value ?? "", metadata: { target, attribute, value } };
      }),
    },
  ];
}

async function assertPageContainsText(
  page: Parameters<typeof assertWithRetry>[0],
  input: Record<string, unknown>,
  expected: string,
  onRetry?: () => void,
) {
  await assertWithRetry(page, input, async () => {
    // getByText(...).first() can select a hidden duplicate even when another
    // matching node is visible. innerText reflects rendered page text and
    // avoids making DOM order decide whether a page-level assertion passes.
    const actual = await page.locator("body").innerText({ timeout: READ_TIMEOUT_MS });
    if (!normalizeVisibleText(actual).includes(normalizeVisibleText(expected))) {
      throw new Error(`Expected page to contain visible text "${expected}", received "${truncate(actual)}"`);
    }
  }, onRetry);
}

function normalizeVisibleText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, max = 200) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max)}…` : compact;
}
