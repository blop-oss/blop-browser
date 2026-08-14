import { basename, join } from "node:path";
import { writeFile } from "node:fs/promises";
import type { BrowserToolContext, NativeToolBridge } from "./types.js";
import { locateTarget, selectorFor, targetParameterSchema } from "./locators.js";
import type { Locator, Page } from "playwright";
import { collectInteractiveReferences, referenceEntry } from "./references.js";

const DEFAULT_ARIA_SNAPSHOT_CHARS = 12_000;
const MIN_ARIA_SNAPSHOT_CHARS = 1_000;
const MAX_ARIA_SNAPSHOT_CHARS = 50_000;

export function createPageTools(context: BrowserToolContext): NativeToolBridge[] {
  return [
    {
      name: "browser_snapshot",
      description: "Return URL, title, visible text, and a compact semantic interaction view with opaque references. Optionally scope observation to a target and bound exposed controls with maxElements. Prefer { ref: 'e1' } targets from the latest snapshot. Copy refs verbatim; never edit or predict their digits. Never act on an [occluded] entry; handle the visible dialog or blocker first. A frame-hosted control MUST be targeted by ref because page-level role/name locators cannot reach into its frame. Request includeAria only when semantic references and visible text are insufficient.",
      parameters: {
        type: "object",
        properties: {
          maxAriaChars: {
            type: "number",
            description: `ARIA character budget (${MIN_ARIA_SNAPSHOT_CHARS}-${MAX_ARIA_SNAPSHOT_CHARS}, default ${DEFAULT_ARIA_SNAPSHOT_CHARS}).`,
          },
          includeAria: {
            type: "boolean",
            description: "Include the full accessibility snapshot as an explicit fallback. Off by default.",
          },
          target: {
            ...targetParameterSchema,
            description: "Optional region or element to observe. Text, semantic controls, and optional ARIA output are scoped to this target.",
          },
          maxElements: {
            type: "number",
            description: "Maximum semantic controls to expose (1-60, default 60).",
          },
        },
      },
      promptSnippet: "- browser_snapshot: Inspect visible text and the compact semantic interaction view. Use target to scope a large page to a form, dialog, table, or region. Prefer a current { ref: \"e1\" } target. Refs are opaque: copy them verbatim and never edit or predict their digits. A ref may persist across snapshots only while the exact element remains valid and exposed. Never act on an [occluded] entry: close or handle the visible dialog/blocker first. You MUST use the ref for entries with frame= metadata because role/name targets cannot cross frames. Request includeAria only if the needed content is missing, or use browser_extract for focused data.",
      execute: (input) => context.record("browser_snapshot", input, async () => {
        const title = await context.page.title();
        const scopeTarget = input.target === undefined ? undefined : selectorFor(input.target);
        const scopeEntry = typeof input.target === "object" && input.target && "ref" in input.target
          ? referenceEntry(context.page, String((input.target as { ref?: unknown }).ref ?? ""))
          : undefined;
        const scope = input.target === undefined ? context.page.locator("body") : locateTarget(context.page, input.target);
        const bodyText = await scope.innerText({ timeout: 5000 }).catch(() => "");
        const excerpt = bodyText.replace(/\s+/g, " ").trim().slice(0, 4000);
        const includeAria = input.includeAria === true || input.maxAriaChars !== undefined;
        const scopedAria = includeAria || input.target !== undefined
          ? truncateSnapshot(await readAriaSnapshot(scope), clampAriaBudget(input.maxAriaChars))
          : undefined;
        // Collect interaction refs last: Playwright's aria-ref mapping belongs
        // to the most recent ARIA snapshot. The optional full fallback above
        // must not supersede the exact refs exposed to the model.
        const interactiveReferences = await collectInteractiveReferences(context.page, {
          ...(input.target !== undefined ? { root: scope, frame: scopeEntry?.entry.frame } : {}),
          maxElements: clampElementBudget(input.maxElements),
        })
          .catch(() => ({ elements: [], text: "", total: 0, omitted: 0 }));
        const pageWithEvaluate = context.page as typeof context.page & { evaluate?: typeof context.page.evaluate };
        const focusedElement = pageWithEvaluate.evaluate ? await pageWithEvaluate.evaluate(() => {
          const element = document.activeElement;
          if (!element) return null;
          return {
            tag: element.tagName.toLowerCase(),
            text: (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
            ariaLabel: element.getAttribute("aria-label"),
            role: element.getAttribute("role"),
            id: element.id || null,
            name: element.getAttribute("name"),
          };
        }).catch(() => null) : null;
        const pageWithViewport = context.page as typeof context.page & { viewportSize?: typeof context.page.viewportSize };
        const viewport = pageWithViewport.viewportSize ? pageWithViewport.viewportSize() : null;
        const snapshot = {
          url: context.page.url(),
          title,
          text: excerpt,
          semanticSnapshot: interactiveReferences.text,
          ...(scopeTarget ? { scope: scopeTarget } : {}),
          actionTargets: interactiveReferences.elements.slice(0, 8).map((entry) => ({
            target: { ref: entry.ref },
            role: entry.role,
            name: entry.name,
            actions: entry.actions,
            ...(entry.states?.length ? { states: entry.states } : {}),
            ...(entry.href ? { href: entry.href } : {}),
            ...(entry.region ? { region: entry.region } : {}),
            ...(entry.frame ? { frame: entry.frame } : {}),
          })),
          ...(includeAria && scopedAria !== undefined ? { ariaSnapshot: scopedAria } : {}),
          ...(!includeAria && scopeTarget && scopedAria !== undefined ? { scopeSnapshot: scopedAria } : {}),
          omittedInteractiveElements: interactiveReferences.omitted,
          focusedElement,
          viewport,
        };
        return {
          content: JSON.stringify(snapshot, null, 2),
          metadata: {
            url: context.page.url(),
            title,
            hasAriaSnapshot: Boolean(scopedAria),
            interactiveElementCount: interactiveReferences.total,
            exposedInteractiveElementCount: interactiveReferences.elements.length,
            omittedInteractiveElementCount: interactiveReferences.omitted,
            ariaSnapshotTruncated: scopedAria?.endsWith("\n...[ARIA snapshot truncated]") ?? false,
            ...(scopeTarget ? { scope: scopeTarget } : {}),
            viewport: viewport ?? null,
          },
        };
      }),
    },
    {
      name: "browser_set_viewport",
      description: "Set the browser viewport size for responsive agent checks.",
      parameters: {
        type: "object",
        properties: {
          width: { type: "number" },
          height: { type: "number" },
        },
        required: ["width", "height"],
      },
      promptSnippet: "- browser_set_viewport: Set viewport width and height before responsive checks.",
      execute: (input) => context.record("browser_set_viewport", input, async () => {
        const width = Number(input.width);
        const height = Number(input.height);
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
          throw new Error("Viewport width and height must be positive numbers.");
        }

        await context.page.setViewportSize({ width, height });
        return { content: `Viewport set to ${width}x${height}`, metadata: { width, height } };
      }),
    },
    {
      name: "browser_get_viewport",
      description: "Return the current browser viewport size.",
      parameters: { type: "object", properties: {} },
      promptSnippet: "- browser_get_viewport: Read viewport size before responsive assertions.",
      execute: (input) => context.record("browser_get_viewport", input, async () => {
        const viewport = context.page.viewportSize();
        return {
          content: viewport ? `${viewport.width}x${viewport.height}` : "unknown",
          metadata: viewport ?? {},
        };
      }),
    },
    {
      name: "browser_screenshot",
      description: "Capture an evidence screenshot and return its local path. Omit target for page-level evidence. Use a target only when it is current on the present page; a ref clicked before navigation is stale.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          checkpoint: { type: "string" },
          reason: { type: "string" },
          target: {
            ...targetParameterSchema,
            description: "Optional current-page target. Never reuse a ref after it was clicked or after navigation; take a fresh snapshot first, or omit target for page-level evidence.",
          },
          fullPage: { type: "boolean" },
          maxDimension: {
            type: "number",
            description: "Maximum output width or height in pixels (default 2000, range 256-4000). Large screenshots are scaled down for model-safe evidence.",
          },
        },
      },
      promptSnippet: "- browser_screenshot: Capture useful checkpoint evidence. After navigation, omit target for page-level evidence unless a fresh snapshot exposed a new target. Never reuse the clicked pre-navigation ref.",
      execute: (input) => context.record("browser_screenshot", input, async () => {
        const rawName = selectorFor(input.name) || selectorFor(input.checkpoint) || `screenshot-${context.screenshots.length + 1}`;
        const safeName = basename(rawName).replace(/[^a-zA-Z0-9._-]/g, "-");
        const filePath = join(context.screenshotDir, `${safeName}.png`);
        const target = selectorFor(input.target);
        const fullPage = Boolean(input.fullPage);
        const maxDimension = clampScreenshotDimension(input.maxDimension);
        const capture = await captureBoundedScreenshot(
          context.page,
          target ? locateTarget(context.page, input.target).first() : undefined,
          fullPage,
          maxDimension,
        );
        await writeFile(filePath, capture.data);
        const artifact = {
          path: filePath,
          name: safeName,
          ...(typeof input.checkpoint === "string" ? { checkpoint: input.checkpoint } : {}),
          ...(typeof input.reason === "string" ? { reason: input.reason } : {}),
          ...(target ? { target } : {}),
          focused: Boolean(target),
          fullPage,
          maxDimension,
          pixelWidth: capture.width,
          pixelHeight: capture.height,
          scaled: capture.scaled,
          timestamp: new Date().toISOString(),
        };
        context.screenshots.push(filePath);
        context.screenshotArtifacts.push(artifact);
        return { content: filePath, metadata: artifact };
      }),
    },
  ];
}

async function captureBoundedScreenshot(
  page: Page,
  target: Locator | undefined,
  fullPage: boolean,
  maxDimension: number,
) {
  if (target) await target.scrollIntoViewIfNeeded({ timeout: 5000 });
  const box = target ? await target.boundingBox() : null;
  if (target && !box) throw new Error("Screenshot target has no visible bounding box.");
  const geometry = box
    ? await page.evaluate(({ x, y, width, height }) => ({
      x: scrollX + x,
      y: scrollY + y,
      width,
      height,
    }), box)
    : await page.evaluate((captureFullPage) => ({
      x: captureFullPage ? 0 : scrollX,
      y: captureFullPage ? 0 : scrollY,
      width: captureFullPage
        ? Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0)
        : innerWidth,
      height: captureFullPage
        ? Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0)
        : innerHeight,
    }), fullPage);
  const scale = Math.min(1, maxDimension / Math.max(geometry.width, geometry.height));
  let data: Buffer;
  if (scale < 1) {
    let session;
    try {
      session = await page.context().newCDPSession(page);
      const result = await session.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: fullPage || Boolean(target),
        clip: { ...geometry, scale },
      });
      data = Buffer.from(result.data, "base64");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Unable to scale screenshot to maxDimension=${maxDimension}: ${detail}`);
    } finally {
      await session?.detach().catch(() => undefined);
    }
  } else {
    data = target
      ? await target.screenshot({ type: "png", scale: "css" })
      : await page.screenshot({ type: "png", fullPage, scale: "css" });
  }
  const width = data.length >= 24 ? data.readUInt32BE(16) : Math.round(geometry.width * scale);
  const height = data.length >= 24 ? data.readUInt32BE(20) : Math.round(geometry.height * scale);
  return { data, width, height, scaled: width < geometry.width || height < geometry.height };
}

async function readAriaSnapshot(locator: Locator) {
  const locatorWithSnapshot = locator as typeof locator & { ariaSnapshot?: (options?: { timeout?: number }) => Promise<string> };
  if (!locatorWithSnapshot.ariaSnapshot) return "";
  return locatorWithSnapshot.ariaSnapshot({ timeout: 5000 }).catch(() => "");
}

function clampElementBudget(value: unknown): number {
  const requested = Number(value ?? 60);
  if (!Number.isFinite(requested)) return 60;
  return Math.min(60, Math.max(1, Math.floor(requested)));
}

function clampScreenshotDimension(value: unknown) {
  const requested = Number(value ?? 2000);
  if (!Number.isFinite(requested)) return 2000;
  return Math.min(4000, Math.max(256, Math.floor(requested)));
}

function clampAriaBudget(value: unknown): number {
  const requested = Number(value ?? DEFAULT_ARIA_SNAPSHOT_CHARS);
  if (!Number.isFinite(requested)) return DEFAULT_ARIA_SNAPSHOT_CHARS;
  return Math.min(MAX_ARIA_SNAPSHOT_CHARS, Math.max(MIN_ARIA_SNAPSHOT_CHARS, requested));
}

function truncateSnapshot(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n...[ARIA snapshot truncated]`;
}
