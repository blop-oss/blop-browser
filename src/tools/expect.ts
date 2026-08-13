import type { Page } from "playwright";

export type RetryOptions = { timeoutMs?: number; intervalMs?: number };

export const DEFAULT_EXPECT_TIMEOUT_MS = 5000;
const DEFAULT_INTERVAL_MS = 100;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 60_000;

/**
 * Auto-retrying assertion core, modeled on Vitest browser mode's
 * `expect.element` / `expect.poll`: re-run `check` until it stops throwing or
 * the timeout elapses. Single-shot reads of async UI (network, animations,
 * hydration) are the main source of flaky agent assertions; polling makes the
 * expect_* tools observe eventual state instead of the first paint.
 */
export async function retryExpect<T>(check: () => Promise<T>, options?: RetryOptions): Promise<T> {
  const timeoutMs = clampTimeout(options?.timeoutMs);
  const intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  for (;;) {
    try {
      return await check();
    } catch (error) {
      lastError = error;
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Read an optional timeoutMs tool parameter, clamped to a sane range. */
export function timeoutFrom(input: Record<string, unknown>): number {
  return clampTimeout(typeof input.timeoutMs === "number" ? input.timeoutMs : undefined);
}

function clampTimeout(timeoutMs: number | undefined) {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) return DEFAULT_EXPECT_TIMEOUT_MS;
  return Math.min(Math.max(timeoutMs, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}

/**
 * Run an assertion with retry semantics, and on final failure attach page
 * context (URL, title, trimmed visible text) so the agent's next step is
 * informed — the equivalent of Vitest printing the DOM under a failed matcher.
 * Playwright call logs are stripped first; they are noisy for an LLM.
 */
export async function assertWithRetry<T>(
  page: Page,
  input: Record<string, unknown>,
  check: () => Promise<T>,
): Promise<T> {
  try {
    return await retryExpect(check, { timeoutMs: timeoutFrom(input) });
  } catch (error) {
    throw await describeFailure(page, error);
  }
}

export async function describeFailure(page: Page, error: unknown): Promise<Error> {
  const original = error instanceof Error ? error.message : String(error);
  const message = original.split("\nCall log:")[0].trim();
  const actionability = actionabilityReason(original);
  try {
    const title = await page.title().catch(() => "");
    const text = await readTrimmedPageText(page);
    const context = `${page.url()}${title ? ` — ${title}` : ""}`;
    return new Error(`${message}${actionability ? `\nReason: ${actionability}` : ""}\n\nPage context: ${context}${text ? `\nVisible text (trimmed):\n${text}` : ""}`);
  } catch {
    return error instanceof Error ? error : new Error(original);
  }
}

function actionabilityReason(message: string) {
  const lines = message
    // ANSI CSI escapes intentionally begin with the U+001B control character.
    // oxlint-disable-next-line no-control-regex
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .split("\n")
    .map((line) => line.replace(/^\s*-\s*/, "").trim());
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (/element is (?:not visible|not stable|not enabled|outside of the viewport)|intercepts pointer events/i.test(lines[index])) {
      return lines[index];
    }
  }
  return undefined;
}

async function readTrimmedPageText(page: Page) {
  const text = await page.locator("body").innerText({ timeout: 1000 }).catch(() => "");
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 2000 ? `${compact.slice(0, 2000)}…` : compact;
}
