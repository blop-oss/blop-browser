import type { Frame, Locator, Page } from "playwright";

type ReferenceState = {
  snapshot: number;
  url: string;
  navigationEpoch: number;
  refs: Map<string, { locator: Locator; entry: InteractiveReference }>;
  nextFallback: number;
};

type NavigationState = { epoch: number };

export type InteractiveReference = {
  ref: string;
  role: string;
  name: string;
  value?: string;
  href?: string;
  region?: string;
  frame?: string;
  states?: string[];
  actions: string[];
};

export type InteractiveReferences = {
  elements: InteractiveReference[];
  text: string;
  total: number;
  omitted: number;
};

export type ReferenceCollectionOptions = {
  root?: Locator;
  frame?: string;
  maxElements?: number;
};

const states = new WeakMap<Page, ReferenceState>();
const navigationStates = new WeakMap<Page, NavigationState>();
const MAX_EXPOSED_REFERENCES = 60;
const INTERACTIVE_SELECTOR = [
  "a[href]", "button", "input", "select", "textarea", "summary",
  "[contenteditable='true']", "[tabindex]",
  "[role='button']", "[role='link']", "[role='checkbox']", "[role='radio']",
  "[role='combobox']", "[role='textbox']", "[role='option']", "[role='menuitem']",
  "[role='slider']", "[role='spinbutton']", "[role='switch']", "[role='tab']",
].join(",");

export async function collectInteractiveReferences(
  page: Page,
  options: ReferenceCollectionOptions = {},
): Promise<InteractiveReferences> {
  const navigationState = getNavigationState(page);
  const previous = states.get(page);
  const snapshot = (previous?.snapshot ?? 0) + 1;
  let nextFallback = previous?.nextFallback ?? 1;
  const refs = new Map<string, { locator: Locator; entry: InteractiveReference }>();
  const collected: (InteractiveReference & { locator: Locator })[] = [];
  let sequence = 0;

  const sources = options.root
    ? [{ frame: page.mainFrame(), locator: options.root.locator(INTERACTIVE_SELECTOR), frameLabel: options.frame }]
    : page.frames().map((frame) => ({ frame, locator: frame.locator(INTERACTIVE_SELECTOR), frameLabel: undefined }));

  for (const source of sources) {
    const { frame, locator } = source;
    // ARIA refs are scoped to Playwright's most recent AI snapshot for each
    // frame. Collect them frame-by-frame so equal role/name pairs in sibling
    // iframes can never be zipped together.
    const aiReferences = await collectAiReferenceQueues(frame);
    const entries = await locator.evaluateAll((elements) => {
      const modalCandidates = Array.from(document.querySelectorAll(
        "dialog,[role='dialog'][aria-modal='true'],[role='alertdialog'][aria-modal='true']",
      )).filter((candidate): candidate is HTMLElement => {
        if (!(candidate instanceof HTMLElement)) return false;
        const style = getComputedStyle(candidate);
        const rect = candidate.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      });
      const coversViewport = (candidate: HTMLElement) => {
        for (let layer: HTMLElement | null = candidate; layer && layer !== document.body; layer = layer.parentElement) {
          const style = getComputedStyle(layer);
          const rect = layer.getBoundingClientRect();
          if (style.pointerEvents !== "none"
            && rect.left <= 1 && rect.top <= 1
            && rect.right >= innerWidth - 1 && rect.bottom >= innerHeight - 1) return true;
        }
        return false;
      };
      const suppressesBackground = (candidate: HTMLElement) => Array.from(document.body.children).some((child) =>
        !child.contains(candidate)
        && (child.hasAttribute("inert") || child.getAttribute("aria-hidden") === "true"));
      const blockingModal = modalCandidates.filter((candidate) => {
        let nativeModal = false;
        try {
          nativeModal = candidate.matches(":modal");
        } catch {
          // :modal is unavailable in older engines; explicit ARIA evidence
          // below still detects full-surface custom modals.
        }
        return nativeModal || (candidate.getAttribute("aria-modal") === "true"
          && (coversViewport(candidate) || suppressesBackground(candidate)));
      }).at(-1);
      const isShadowHost = (candidate: Element, element: Element) => {
        let root = element.getRootNode();
        while (root instanceof ShadowRoot) {
          if (root.host === candidate) return true;
          root = root.host.getRootNode();
        }
        return false;
      };
      const receivesPointer = (element: HTMLElement, rect: DOMRect) => {
        if (!(rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth)) return false;
        const insetX = Math.min(Math.max(rect.width * 0.2, 1), 8);
        const insetY = Math.min(Math.max(rect.height * 0.2, 1), 8);
        const points = [
          [rect.left + rect.width / 2, rect.top + rect.height / 2],
          [rect.left + insetX, rect.top + insetY],
          [rect.right - insetX, rect.top + insetY],
          [rect.left + insetX, rect.bottom - insetY],
          [rect.right - insetX, rect.bottom - insetY],
        ];
        return points.some(([rawX, rawY]) => {
          const x = Math.max(0, Math.min(innerWidth - 1, rawX));
          const y = Math.max(0, Math.min(innerHeight - 1, rawY));
          const top = document.elementFromPoint(x, y);
          return Boolean(top && (top === element || element.contains(top) || isShadowHost(top, element)));
        });
      };

      return elements.flatMap((element, index) => {
      if (!(element instanceof HTMLElement)) return [];
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || rect.width === 0 || rect.height === 0) return [];

      const tag = element.tagName.toLowerCase();
      const input = element instanceof HTMLInputElement ? element : null;
      const role = element.getAttribute("role") || (tag === "a" ? "link"
        : tag === "button" || tag === "summary" ? "button"
        : tag === "textarea" ? "textbox"
        : tag === "select" ? "combobox"
        : input?.type === "checkbox" ? "checkbox"
        : input?.type === "radio" ? "radio"
        : input?.type === "range" ? "slider"
        : input?.type === "number" ? "spinbutton"
        : input ? "textbox"
        : element.isContentEditable ? "textbox"
        : "interactive");
      const labels = "labels" in element
        ? Array.from((element as HTMLInputElement).labels ?? []).map((label) => label.innerText.trim()).filter(Boolean).join(" ")
        : "";
      const labelledBy = (element.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "").filter(Boolean).join(" ");
      const name = (element.getAttribute("aria-label") || labelledBy || labels
        || element.getAttribute("alt") || element.getAttribute("title")
        || element.getAttribute("placeholder") || element.innerText || "")
        .replace(/\s+/g, " ").trim().slice(0, 160);
      if (!name && element !== document.activeElement) return [];

      const state: string[] = [];
      if (element === document.activeElement) state.push("focused");
      if ((element as HTMLInputElement).disabled || element.getAttribute("aria-disabled") === "true") state.push("disabled");
      if (input?.checked || element.getAttribute("aria-checked") === "true") state.push("checked");
      if (element.getAttribute("aria-expanded") === "true") state.push("expanded");
      if (element.getAttribute("aria-selected") === "true") state.push("selected");
      const inViewport = rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
      const hitTestable = receivesPointer(element, rect);
      if (inViewport) {
        state.push("in-viewport");
        if (!hitTestable) state.push("occluded");
      }
      if (blockingModal) {
        if (blockingModal.contains(element)) state.push("modal-scope");
        else state.push("blocked-by-modal");
      }

      const regionElement = element.closest("dialog,[role='dialog'],form,nav,main,[role='navigation'],[role='main'],[role='search']");
      const region = regionElement ? [
        regionElement.getAttribute("role") || regionElement.tagName.toLowerCase(),
        regionElement.getAttribute("aria-label") || "",
      ].filter(Boolean).join(":") : undefined;
      const value = "value" in element ? String((element as HTMLInputElement).value).slice(0, 160) : undefined;
      const href = element instanceof HTMLAnchorElement ? element.href : undefined;
      const rawHref = element instanceof HTMLAnchorElement ? element.getAttribute("href") || undefined : undefined;
      const actions = input && (role === "textbox" || role === "combobox") || tag === "textarea" || element.isContentEditable
        ? ["fill", "press", "clear", "focus"]
        : role === "checkbox" || role === "radio" ? ["click", "check", "focus"]
        : tag === "select" ? ["click", "select", "focus"]
        : tag === "a" || tag === "button" || tag === "summary"
          || ["button", "link", "option", "menuitem", "switch", "tab"].includes(role)
          ? ["click", "focus"]
          : ["focus"];
      return [{
        index,
        tag,
        id: element.id || undefined,
        testId: element.getAttribute("data-testid") || undefined,
        ariaLabel: element.getAttribute("aria-label") || undefined,
        nameAttribute: element.getAttribute("name") || undefined,
        placeholder: element.getAttribute("placeholder") || undefined,
        rawHref,
        role,
        name,
        value,
        href,
        region,
        states: state,
        actions,
      }];
      });
    });
    const manualCounts = new Map<string, number>();
    for (const entry of entries) {
      const key = referenceIdentity(entry.role, entry.name);
      manualCounts.set(key, (manualCounts.get(key) ?? 0) + 1);
    }
    const exactAiGroups = new Set([...manualCounts]
      .filter(([key, count]) => aiReferences.get(key)?.length === count)
      .map(([key]) => key));

    for (const entry of entries) {
      sequence += 1;
      const frameLabel = source.frameLabel ?? (frame !== page.mainFrame() ? compactFrame(frame.url()) : undefined);
      const identity = referenceIdentity(entry.role, entry.name);
      const aiQueue = aiReferences.get(identity);
      // Only zip semantic occurrences when both views found the same count.
      // Hidden or accessibility-only duplicates otherwise make occurrence
      // matching ambiguous, where omitting the exact mapping is safer.
      const aiRef = exactAiGroups.has(identity) ? aiQueue?.shift() : undefined;
      // Playwright's own eN/fNeN refs are compact, exact, and persistent for
      // the same connected element. Expose them atomically instead of wrapping
      // them in a spliceable snapshot/ordinal pair. A monotonic xN is reserved
      // for the conservative nth() fallback and is never reused.
      const ref = aiRef ?? `x${nextFallback++}`;
      // Playwright's AI snapshot refs retain the exact Element identity in its
      // isolated utility world and reject detached nodes. A raw locator.nth()
      // is only a fallback: live sites can insert controls between observation
      // and action, causing a global ordinal to point at a different element.
      const entryLocator = aiRef
        ? page.locator(`aria-ref=${aiRef}`)
        : locator.nth(entry.index).and(fallbackIdentityLocator(frame, entry));
      const reference: InteractiveReference = {
        ref,
        role: entry.role,
        name: entry.name,
        ...(entry.value ? { value: entry.value } : {}),
        ...(entry.href ? { href: entry.href } : {}),
        ...(entry.region ? { region: entry.region } : {}),
        ...(frameLabel ? { frame: frameLabel } : {}),
        ...(entry.states.length ? { states: entry.states } : {}),
        actions: entry.actions,
      };
      collected.push({
        ...reference,
        locator: entryLocator,
      });
    }
  }

  collected.sort((left, right) => referencePriority(right) - referencePriority(left));
  const actionable = collected.filter((entry) => !entry.states?.includes("blocked-by-modal"));
  const maxElements = Math.max(1, Math.min(MAX_EXPOSED_REFERENCES, options.maxElements ?? MAX_EXPOSED_REFERENCES));
  const exposed = actionable.slice(0, maxElements);
  // Only refs actually shown in the latest observation are actionable. Raw
  // refs that persist will be re-added automatically on the next snapshot;
  // detached, renamed, hidden, or omitted elements become stale immediately.
  for (const entry of exposed) {
    refs.set(entry.ref, { locator: entry.locator, entry });
  }
  states.set(page, {
    snapshot,
    url: page.url(),
    navigationEpoch: navigationState.epoch,
    refs,
    nextFallback,
  });
  const elements = exposed.map(({ locator: _locator, ...entry }) => entry);
  return {
    elements,
    text: elements.map(formatReference).join("\n"),
    total: collected.length,
    omitted: Math.max(0, collected.length - elements.length),
  };
}

async function collectAiReferenceQueues(frame: Frame) {
  const queues = new Map<string, string[]>();
  // Workaround: Bun's transpiler triggers a port-binding side effect when
  // "ai" appears as a direct string literal in ariaSnapshot options. Assign
  // it to a typed variable so the call site no longer matches the pattern.
  const aiSnapshotMode = "ai" as const;
  const snapshot = await frame.locator("body")
    .ariaSnapshot({ mode: aiSnapshotMode, timeout: 5000 } as { mode: "ai"; timeout: number })
    .catch(() => "");
  const refs = [...snapshot.matchAll(/\[ref=([^\]]+)\]/g)].map((match) => match[1]);
  const framePrefix = refs[0]?.match(/^(.*)e\d+$/)?.[1];
  if (framePrefix === undefined) return queues;

  for (const line of snapshot.split("\n")) {
    const ref = line.match(/\[ref=([^\]]+)\]/)?.[1];
    const node = line.match(/^\s*-\s+([a-z][a-z0-9-]*)(?:\s+("(?:[^"\\]|\\.)*"))?/i);
    if (!ref || !node) continue;
    // A parent-frame snapshot can include descendants with fN-prefixed refs.
    // Keep only refs owned by this exact frame; descendants are collected in
    // their own pass and retain their fully-qualified identifiers.
    if (ref.match(/^(.*)e\d+$/)?.[1] !== framePrefix) continue;

    let name = "";
    if (node[2]) {
      try {
        name = String(JSON.parse(node[2]));
      } catch {
        name = node[2].slice(1, -1);
      }
    }
    const key = referenceIdentity(node[1], name);
    const queue = queues.get(key) ?? [];
    queue.push(ref);
    queues.set(key, queue);
  }
  return queues;
}

function referenceIdentity(role: string, name: string) {
  const normalizedRole = role.toLowerCase() === "searchbox" ? "textbox" : role.toLowerCase();
  const normalizedName = name.replace(/\s+/g, " ").trim();
  return `${normalizedRole}\u0000${normalizedName}`;
}

export function locateReference(page: Page, ref: string): Locator {
  const stored = referenceEntry(page, ref);
  if (!stored) {
    throw new Error(`Unknown or stale element reference "${ref}". Take a new browser_snapshot and copy a currently exposed ref verbatim.`);
  }
  return stored.locator;
}

export function referenceEntry(page: Page, ref: string) {
  const state = states.get(page);
  const navigationState = getNavigationState(page);
  const stored = state?.url === page.url() && state.navigationEpoch === navigationState.epoch
    ? state.refs.get(ref)
    : undefined;
  return stored;
}

export async function describeLocatorBlocker(page: Page, locator: Locator) {
  const blocker = await locator.evaluate((element) => {
    if (!(element instanceof HTMLElement)) return null;
    const modalCandidates = Array.from(document.querySelectorAll(
      "dialog,[role='dialog'][aria-modal='true'],[role='alertdialog'][aria-modal='true']",
    )).filter((candidate): candidate is HTMLElement => {
      if (!(candidate instanceof HTMLElement)) return false;
      const style = getComputedStyle(candidate);
      const rect = candidate.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    });
    const coversViewport = (candidate: HTMLElement) => {
      for (let layer: HTMLElement | null = candidate; layer && layer !== document.body; layer = layer.parentElement) {
        const style = getComputedStyle(layer);
        const rect = layer.getBoundingClientRect();
        if (style.pointerEvents !== "none"
          && rect.left <= 1 && rect.top <= 1
          && rect.right >= innerWidth - 1 && rect.bottom >= innerHeight - 1) return true;
      }
      return false;
    };
    const blockingModal = modalCandidates.filter((candidate) => {
      let nativeModal = false;
      try {
        nativeModal = candidate.matches(":modal");
      } catch {
        // See the snapshot-side detector above.
      }
      const backgroundSuppressed = Array.from(document.body.children).some((child) =>
        !child.contains(candidate)
        && (child.hasAttribute("inert") || child.getAttribute("aria-hidden") === "true"));
      return nativeModal || (candidate.getAttribute("aria-modal") === "true"
        && (coversViewport(candidate) || backgroundSuppressed));
    }).at(-1);
    const rect = element.getBoundingClientRect();
    const inViewport = rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
    if (!inViewport) {
      if (blockingModal && !blockingModal.contains(element)) {
        return {
          tag: "modal",
          name: blockingModal.getAttribute("aria-label") || blockingModal.getAttribute("role") || "dialog",
          source: "",
        };
      }
      // Playwright can scroll an ordinary offscreen target into view. Do not
      // mistake the clamped viewport edge for an occluding element.
      return null;
    }
    const insetX = Math.min(Math.max(rect.width * 0.2, 1), 8);
    const insetY = Math.min(Math.max(rect.height * 0.2, 1), 8);
    const points = [
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
      [rect.left + insetX, rect.top + insetY],
      [rect.right - insetX, rect.top + insetY],
      [rect.left + insetX, rect.bottom - insetY],
      [rect.right - insetX, rect.bottom - insetY],
    ];
    const isShadowHost = (candidate: Element, target: Element) => {
      let root = target.getRootNode();
      while (root instanceof ShadowRoot) {
        if (root.host === candidate) return true;
        root = root.host.getRootNode();
      }
      return false;
    };
    const hitTestable = points.some(([rawX, rawY]) => {
      const x = Math.max(0, Math.min(innerWidth - 1, rawX));
      const y = Math.max(0, Math.min(innerHeight - 1, rawY));
      const top = document.elementFromPoint(x, y);
      return Boolean(top && (top === element || element.contains(top) || isShadowHost(top, element)));
    });
    if (blockingModal && !blockingModal.contains(element)) {
      return {
        tag: "modal",
        name: blockingModal.getAttribute("aria-label") || blockingModal.getAttribute("role") || "dialog",
        source: "",
      };
    }
    if (hitTestable) return null;
    const x = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2));
    const y = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2));
    const top = document.elementFromPoint(x, y);
    if (!top) return null;
    return {
      tag: top.tagName.toLowerCase(),
      name: top.getAttribute("aria-label") || top.getAttribute("title") || "",
      source: top instanceof HTMLIFrameElement ? top.src : "",
    };
  }).catch(() => null);
  if (!blocker) return null;

  const frameControls = blocker.source
    ? [...(states.get(page)?.refs.values() ?? [])]
      .map((stored) => stored.entry)
      .filter((entry) => entry.frame && entry.actions.includes("click") && entry.states?.includes("in-viewport"))
      .sort((left, right) => blockerPriority(right) - blockerPriority(left))
      .slice(0, 5)
      .map((entry) => `[${entry.ref}] ${entry.role} ${JSON.stringify(entry.name)}`)
    : [];
  const identity = blocker.source || blocker.name || blocker.tag;
  return `Target is occluded by ${identity}. Do not retry it until the blocker is handled.`
    + (frameControls.length ? ` Available frame controls: ${frameControls.join("; ")}.` : "");
}

export async function blockedActionResult(page: Page, locator: Locator, action: string) {
  // A blocker can only cover an element that currently exists. Let the
  // action's own bounded auto-wait handle targets that may appear later.
  if (await locator.count() === 0) return null;
  const blocker = await describeLocatorBlocker(page, locator);
  if (!blocker) return null;
  return {
    content: `${action} was not performed. ${blocker} Take a fresh browser_snapshot and handle the blocker first.`,
    metadata: { blocked: true, blocker },
  };
}

function referencePriority(entry: InteractiveReference) {
  const current = entry.states ?? [];
  return (entry.frame ? 1 : 0)
    + (current.includes("focused") ? 8 : 0)
    + (current.includes("in-viewport") ? 4 : 0)
    - (current.includes("occluded") ? 2 : 0)
    - (current.includes("disabled") ? 1 : 0);
}

function formatReference(entry: InteractiveReference) {
  const details = [
    entry.value ? `value=${JSON.stringify(entry.value)}` : "",
    entry.href ? `href=${JSON.stringify(entry.href)}` : "",
    entry.region ? `region=${JSON.stringify(entry.region)}` : "",
    entry.frame ? `frame=${JSON.stringify(entry.frame)}` : "",
    `actions=[${entry.actions.join(",")}]`,
    entry.states?.length ? `[${entry.states.join(",")}]` : "",
  ].filter(Boolean).join(" ");
  return `[${entry.ref}] ${entry.role} ${JSON.stringify(entry.name)}${details ? ` ${details}` : ""}`;
}

function compactFrame(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`.slice(0, 120);
  } catch {
    return url.slice(0, 120);
  }
}

function blockerPriority(entry: InteractiveReference) {
  return /accept|reject|allow|agree|consent|cookie/i.test(entry.name) ? 10 : 0;
}

function fallbackIdentityLocator(frame: Frame, entry: {
  tag: string;
  role: string;
  id?: string;
  testId?: string;
  ariaLabel?: string;
  nameAttribute?: string;
  placeholder?: string;
  rawHref?: string;
  name: string;
}) {
  const attribute = entry.id ? ["id", entry.id]
    : entry.testId ? ["data-testid", entry.testId]
    : entry.ariaLabel ? ["aria-label", entry.ariaLabel]
    : entry.placeholder ? ["placeholder", entry.placeholder]
    : entry.nameAttribute ? ["name", entry.nameAttribute]
    : entry.rawHref ? ["href", entry.rawHref]
    : null;
  if (attribute) {
    return frame.locator(`${entry.tag}[${attribute[0]}=${JSON.stringify(attribute[1])}]`);
  }
  if (entry.role !== "interactive") {
    return frame.getByRole(entry.role as Parameters<Frame["getByRole"]>[0], {
      name: entry.name,
      exact: false,
    });
  }
  return frame.getByText(entry.name, { exact: true });
}

function getNavigationState(page: Page) {
  let state = navigationStates.get(page);
  if (state) return state;
  state = { epoch: 0 };
  navigationStates.set(page, state);
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) state!.epoch += 1;
  });
  return state;
}
