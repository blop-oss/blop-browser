import type { BrowserContext, CDPSession, Page, Request, Route } from "playwright";
import type { ToolContentBoundary } from "../types.js";
import type { BrowserSafetyError, CompiledBrowserDomainPolicy } from "./safety.js";
import {
  compiledBrowserDomainAllowed,
  domainDeniedError,
  mixedContentBoundary,
} from "./safety.js";

const ROUTE_PATTERN = "**/*";
const NO_DOMAIN_POLICY = "none";

export type NavigationPolicyCheckpoint = {
  id: number;
};

type NavigationPolicyCheckpointState = {
  page: Page;
  violation?: BrowserSafetyError;
};

type InstalledGuard = {
  context: BrowserContext;
  policy: CompiledBrowserDomainPolicy;
  handler: (route: Route, request: Request) => Promise<void>;
  ready: Promise<void>;
  checkpoints: Map<number, NavigationPolicyCheckpointState>;
  nextCheckpointId: number;
  cdpPages: Map<Page, CdpPageGuard>;
  cdpPending: WeakMap<Page, Promise<void>>;
  closed: boolean;
  onClose: () => void;
  onPage: (page: Page) => void;
};

type CdpPageGuard = {
  session: CDPSession;
  mainFrameId: string;
};

type FetchPausedEvent = {
  requestId: string;
  frameId?: string;
  resourceType?: string;
  redirectedRequestId?: string;
  request: { url: string };
};

export type NavigationPolicyGuard = {
  checkpoint(page: Page): NavigationPolicyCheckpoint;
  settleViolation(
    checkpoint: NavigationPolicyCheckpoint,
    toolName: string,
  ): BrowserSafetyError | undefined;
};

const guards = new WeakMap<BrowserContext, InstalledGuard>();
const contextPolicies = new WeakMap<BrowserContext, string>();

export async function installNavigationPolicyGuard(
  context: BrowserContext,
  policy: CompiledBrowserDomainPolicy | undefined,
): Promise<NavigationPolicyGuard> {
  const hasRules = Boolean(policy && (policy.allow.length > 0 || policy.deny.length > 0));
  const fingerprint = hasRules ? policy!.fingerprint : NO_DOMAIN_POLICY;
  const registeredPolicy = contextPolicies.get(context);
  if (registeredPolicy !== undefined && registeredPolicy !== fingerprint) {
    throw new TypeError(
      "A different browser domain policy is already installed on this BrowserContext.",
    );
  }

  const installed = guards.get(context);
  if (installed) {
    await installed.ready;
    return handleFor(installed);
  }
  if (registeredPolicy === NO_DOMAIN_POLICY) return NOOP_GUARD;
  if (!hasRules) {
    contextPolicies.set(context, NO_DOMAIN_POLICY);
    context.once("close", () => contextPolicies.delete(context));
    return NOOP_GUARD;
  }
  if (context.browser()?.browserType().name() !== "chromium") {
    throw new TypeError(
      "Browser domain policy requires a Chromium BrowserContext; this backend cannot enforce every top-level redirect hop.",
    );
  }

  const state = {} as InstalledGuard;
  const handler = async (route: Route, request: Request) => {
    const document = topLevelDocument(request);
    if (!document) {
      await route.fallback();
      return;
    }

    if (!document.page) {
      // Chromium exposes a popup's first document before its Page. Its redirect
      // chain cannot be attached to the page-scoped Fetch guard in time, so
      // domain policy deliberately fails closed for all new-page navigations.
      const error = domainDeniedError({
        toolName: "top-level-navigation",
        phase: "new-page",
        destination: request.url(),
        contentBoundary: mixedContentBoundaryForUrl(request.url()),
      });
      recordUnattributedViolation(state, error);
      await route.abort("blockedbyclient").catch(() => undefined);
      return;
    }

    if (compiledBrowserDomainAllowed(state.policy, request.url())) {
      // Playwright's context routing automatically continues Chromium redirect
      // hops without invoking this handler again. The narrow, page-scoped CDP
      // Fetch guard is therefore required to inspect redirects; context routing
      // remains responsible for popup fail-closed behavior and host-route
      // cooperation. Non-Chromium backends are rejected during installation.
      await attachChromiumPage(state, document.page);
      await route.fallback();
      return;
    }

    const error = domainDeniedError({
      toolName: "top-level-navigation",
      phase: request.redirectedFrom() ? "redirect" : "navigation",
      destination: request.url(),
      contentBoundary: mixedContentBoundary(document.page),
    });
    recordViolation(state, document.page, error);
    await route.abort("blockedbyclient").catch(() => undefined);
  };
  const onClose = () => {
    state.closed = true;
    guards.delete(context);
    contextPolicies.delete(context);
    state.checkpoints.clear();
    state.cdpPages.clear();
  };
  const onPage = (page: Page) => {
    void attachChromiumPage(state, page).catch(() => undefined);
  };
  Object.assign(state, {
    context,
    policy,
    handler,
    ready: Promise.resolve(),
    checkpoints: new Map<number, NavigationPolicyCheckpointState>(),
    nextCheckpointId: 0,
    cdpPages: new Map<Page, CdpPageGuard>(),
    cdpPending: new WeakMap<Page, Promise<void>>(),
    closed: false,
    onClose,
    onPage,
  });
  contextPolicies.set(context, fingerprint);
  guards.set(context, state);
  context.on("page", onPage);
  context.once("close", onClose);
  state.ready = Promise.all([
    context.route(ROUTE_PATTERN, handler).then(() => undefined),
    ...context.pages().map((page) => attachChromiumPage(state, page)),
  ]).then(() => undefined).catch(async (error) => {
    guards.delete(context);
    contextPolicies.delete(context);
    context.off("close", onClose);
    context.off("page", onPage);
    await context.unroute(ROUTE_PATTERN, handler).catch(() => undefined);
    await detachCdpPages(state);
    throw error;
  });
  await state.ready;
  return handleFor(state);
}

function handleFor(state: InstalledGuard): NavigationPolicyGuard {
  return {
    checkpoint: (page) => {
      const checkpoint = { id: ++state.nextCheckpointId };
      state.checkpoints.set(checkpoint.id, { page });
      return checkpoint;
    },
    settleViolation: (checkpoint, toolName) => {
      const watched = state.checkpoints.get(checkpoint.id);
      state.checkpoints.delete(checkpoint.id);
      return watched?.violation
        ? retargetViolation(watched.violation, toolName)
        : undefined;
    },
  };
}

function recordUnattributedViolation(state: InstalledGuard, error: BrowserSafetyError) {
  // A frame-less popup request has no Page/opener yet. Associate the denial
  // with every overlapping guarded action; failing an extra concurrent action
  // is safer than allowing either action to silently escape the domain policy.
  for (const checkpoint of state.checkpoints.values()) checkpoint.violation ??= error;
}

function recordViolation(state: InstalledGuard, page: Page, error: BrowserSafetyError) {
  assignViolation(state, page, error);
  void page.opener().then((opener) => {
    if (opener) assignViolation(state, opener, error);
  }).catch(() => undefined);
}

function assignViolation(state: InstalledGuard, page: Page, error: BrowserSafetyError) {
  for (const checkpoint of state.checkpoints.values()) {
    if (checkpoint.page === page) checkpoint.violation ??= error;
  }
}

function retargetViolation(error: BrowserSafetyError, toolName: string) {
  if (!error.phase || !error.origin) return error;
  return domainDeniedError({
    toolName,
    phase: error.phase,
    destination: error.origin,
    contentBoundary: error.contentBoundary,
  });
}

async function attachChromiumPage(state: InstalledGuard, page: Page) {
  if (state.closed || page.isClosed() || state.cdpPages.has(page)) return;
  const pending = state.cdpPending.get(page);
  if (pending) return await pending;
  const attach = (async () => {
    const session = await state.context.newCDPSession(page);
    const frameTree = await session.send("Page.getFrameTree");
    const guard = { session, mainFrameId: frameTree.frameTree.frame.id };
    state.cdpPages.set(page, guard);
    session.on("Fetch.requestPaused", (event: FetchPausedEvent) => {
      void handleChromiumRequest(state, page, guard, event);
    });
    page.once("close", () => {
      state.cdpPages.delete(page);
      void session.detach().catch(() => undefined);
    });
    await session.send("Fetch.enable", {
      patterns: [{ urlPattern: "*", resourceType: "Document", requestStage: "Request" }],
    });
  })().finally(() => state.cdpPending.delete(page));
  state.cdpPending.set(page, attach);
  await attach;
}

async function handleChromiumRequest(
  state: InstalledGuard,
  page: Page,
  guard: CdpPageGuard,
  event: FetchPausedEvent,
) {
  const isMainDocument = event.resourceType === "Document" && event.frameId === guard.mainFrameId;
  if (!isMainDocument || compiledBrowserDomainAllowed(state.policy, event.request.url)) {
    await guard.session.send("Fetch.continueRequest", { requestId: event.requestId })
      .catch(() => undefined);
    return;
  }

  const error = domainDeniedError({
    toolName: "top-level-navigation",
    phase: event.redirectedRequestId ? "redirect" : "navigation",
    destination: event.request.url,
    contentBoundary: mixedContentBoundary(page),
  });
  recordViolation(state, page, error);
  await guard.session.send("Fetch.failRequest", {
    requestId: event.requestId,
    errorReason: "BlockedByClient",
  }).catch(() => undefined);
}

async function detachCdpPages(state: InstalledGuard) {
  await Promise.all([...state.cdpPages.values()].map(async ({ session }) => {
    await session.send("Fetch.disable").catch(() => undefined);
    await session.detach().catch(() => undefined);
  }));
  state.cdpPages.clear();
}

function topLevelDocument(request: Request): { page?: Page } | undefined {
  if (!request.isNavigationRequest() || request.resourceType() !== "document") return undefined;
  try {
    const frame = request.frame();
    return frame.parentFrame() === null ? { page: frame.page() } : undefined;
  } catch {
    // Playwright has no associated frame for the first request of a popup.
    return {};
  }
}

function mixedContentBoundaryForUrl(url: string): ToolContentBoundary {
  const origin = safeOrigin(url);
  return {
    source: "mixed",
    trust: "untrusted",
    browser: { source: "browser", trust: "untrusted", url: origin },
  };
}

function safeOrigin(value: string) {
  try {
    const url = new URL(value);
    return url.origin === "null" ? url.protocol : url.origin;
  } catch {
    return "invalid-origin";
  }
}

const NOOP_GUARD: NavigationPolicyGuard = {
  checkpoint: () => ({ id: 0 }),
  settleViolation: () => undefined,
};
