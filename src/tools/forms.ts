import type { BrowserToolContext, NativeToolBridge } from "./types.js";
import { locateTarget, selectorFor, targetParameterSchema } from "./locators.js";
import { blockedActionResult } from "./references.js";

export function createFormTools(context: BrowserToolContext): NativeToolBridge[] {
  return [
    {
      name: "browser_check",
      description: "Check a checkbox or radio input by label or selector.",
      parameters: {
        type: "object",
        properties: { target: targetParameterSchema },
        required: ["target"],
      },
      promptSnippet: "- browser_check: Check a checkbox or radio input.",
      execute: (input) => context.record("browser_check", input, async () => {
        const target = selectorFor(input.target);
        const locator = locateFormTarget(context, input.target);
        const blockedResult = await blockedActionResult(context.page, locator, "Check");
        if (blockedResult) return blockedResult;
        await locator.check({ timeout: 5000 });
        return { content: `Checked ${target}` };
      }),
    },
    {
      name: "browser_uncheck",
      description: "Uncheck a checkbox by label or selector.",
      parameters: {
        type: "object",
        properties: { target: targetParameterSchema },
        required: ["target"],
      },
      promptSnippet: "- browser_uncheck: Uncheck a checkbox.",
      execute: (input) => context.record("browser_uncheck", input, async () => {
        const target = selectorFor(input.target);
        const locator = locateFormTarget(context, input.target);
        const blockedResult = await blockedActionResult(context.page, locator, "Uncheck");
        if (blockedResult) return blockedResult;
        await locator.uncheck({ timeout: 5000 });
        return { content: `Unchecked ${target}` };
      }),
    },
    {
      name: "browser_select_option",
      description: "Select one or more options in a select element by value or label.",
      parameters: {
        type: "object",
        properties: {
          target: targetParameterSchema,
          values: {
            oneOf: [
              { type: "string" },
              { type: "array", items: { type: "string" } },
            ],
          },
        },
        required: ["target", "values"],
      },
      promptSnippet: "- browser_select_option: Select dropdown options by value or visible label.",
      execute: (input) => context.record("browser_select_option", input, async () => {
        const target = selectorFor(input.target);
        const values = Array.isArray(input.values) ? input.values.map(String) : String(input.values ?? "");
        const locator = locateFormTarget(context, input.target);
        const blockedResult = await blockedActionResult(context.page, locator, "Selection");
        if (blockedResult) return blockedResult;
        await locator.selectOption(values, { timeout: 5000 });
        return { content: `Selected ${JSON.stringify(values)} in ${target}` };
      }),
    },
    {
      name: "browser_upload_file",
      description: "Upload one or more local files into an input[type=file].",
      parameters: {
        type: "object",
        properties: {
          target: targetParameterSchema,
          paths: {
            oneOf: [
              { type: "string" },
              { type: "array", items: { type: "string" } },
            ],
          },
        },
        required: ["target", "paths"],
      },
      promptSnippet: "- browser_upload_file: Set local file paths on a file input.",
      execute: (input) => context.record("browser_upload_file", input, async () => {
        const target = selectorFor(input.target);
        const paths = Array.isArray(input.paths) ? input.paths.map(String) : String(input.paths ?? "");
        const locator = locateFormTarget(context, input.target);
        const blockedResult = await blockedActionResult(context.page, locator, "Upload");
        if (blockedResult) return blockedResult;
        await locator.setInputFiles(paths, { timeout: 5000 });
        return { content: `Uploaded ${JSON.stringify(paths)} into ${target}` };
      }),
    },
  ];
}

function locateFormTarget(context: BrowserToolContext, target: unknown) {
  if (typeof target === "object" && target) {
    return locateTarget(context.page, target);
  }

  const targetText = selectorFor(target);
  if (/^(?:[.#]|\[)|^xpath=|^css=/.test(targetText)) return context.page.locator(targetText).first();
  return context.page.getByLabel(targetText).first();
}
