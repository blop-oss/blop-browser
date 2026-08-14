import { randomUUID } from "node:crypto";
import { BrowserToolError } from "../tools/safety.js";

const MAX_TAKEOVER_MESSAGE_LENGTH = 240;
const MAX_COMMAND_LENGTH = 128;
const MAX_IDENTIFIER_LENGTH = 128;
const MAX_ERROR_MESSAGE_LENGTH = 240;

export type BrowserControlState =
  | "automation"
  | "pausing"
  | "paused"
  | "human-control"
  | "closed";

export type BrowserTakeoverReason = "challenge" | "sensitive-step" | "other";
export type BrowserTakeoverOutcome = "completed" | "cancelled";

export type BrowserControlTransition = Readonly<{
  type:
    | "pause-requested"
    | "paused"
    | "human-control-acquired"
    | "automation-resumed"
    | "closed";
  from: BrowserControlState;
  to: BrowserControlState;
  revision: number;
  timestamp: string;
  requestId?: string;
  reason?: BrowserTakeoverReason;
  /** Bounded host context. Trace integrations must redact this field. */
  message?: string;
  outcome?: BrowserTakeoverOutcome;
}>;

export type BrowserControlStatus = Readonly<{
  state: BrowserControlState;
  revision: number;
  activeAutomation: number;
  requestId?: string;
  reason?: BrowserTakeoverReason;
  requestedAt?: string;
  pausedAt?: string;
  acquiredAt?: string;
  transitionCallbackFailures: number;
  lastTransitionCallbackError?: string;
}>;

export type BrowserHumanControlLease = Readonly<{
  requestId: string;
  leaseId: string;
  acquiredAt: string;
}>;

export type BrowserControlSessionOptions = {
  /**
   * Receives each completed transition exactly once. A callback failure is
   * reported by status() and never rolls back or retries the transition.
   */
  onTransition?: (transition: BrowserControlTransition) => void | Promise<void>;
};

export type BrowserControlSession = {
  status(): BrowserControlStatus;
  requestTakeover(input: {
    reason: BrowserTakeoverReason;
    message?: string;
  }): Promise<BrowserControlStatus>;
  takeControl(input: { requestId: string }): BrowserHumanControlLease;
  resumeAutomation(input: {
    requestId: string;
    leaseId: string;
    outcome?: BrowserTakeoverOutcome;
  }): BrowserControlStatus;
  /**
   * Linearizable automation admission. The operation is never invoked unless
   * automation owns the session, and takeover waits for admitted work to exit.
   */
  runAutomation<T>(command: string, operation: () => Promise<T>): Promise<T>;
  /** Add a bounded-lifecycle observer; returns an idempotent unsubscribe. */
  onTransition(listener: (transition: BrowserControlTransition) => void | Promise<void>): () => void;
  /** Terminal lifecycle signal used when the owning browser session closes. */
  close(): BrowserControlStatus;
};

export class BrowserControlError extends BrowserToolError {
  readonly code:
    | "automation_paused"
    | "invalid_control_transition"
    | "page_unavailable_after_takeover"
    | "session_closed"
    | "takeover_unavailable";
  readonly state: BrowserControlState;
  readonly command: string;
  readonly requestId?: string;

  constructor(options: {
    code:
      | "automation_paused"
      | "invalid_control_transition"
      | "page_unavailable_after_takeover"
      | "session_closed"
      | "takeover_unavailable";
    state: BrowserControlState;
    command: string;
    requestId?: string;
    message?: string;
  }) {
    const fallbackMessage = controlErrorMessage(options.code, options.state, options.command);
    super(options.message === undefined
      ? fallbackMessage
      : boundedText(options.message, MAX_ERROR_MESSAGE_LENGTH) || fallbackMessage, {
      source: "harness",
      trust: "trusted",
    });
    this.name = "BrowserControlError";
    this.code = options.code;
    this.state = options.state;
    this.command = boundedCommand(options.command);
    this.requestId = options.requestId === undefined
      ? undefined
      : boundedIdentifier(options.requestId);
  }
}

export function createBrowserControlSession(
  options: BrowserControlSessionOptions = {},
): BrowserControlSession {
  let state: BrowserControlState = "automation";
  let revision = 0;
  let activeAutomation = 0;
  let request: {
    id: string;
    reason: BrowserTakeoverReason;
    requestedAt: string;
    pausedAt?: string;
    acquiredAt?: string;
  } | undefined;
  let leaseId: string | undefined;
  let transitionCallbackFailures = 0;
  let lastTransitionCallbackError: string | undefined;
  const drainWaiters = new Set<() => void>();
  const transitionListeners = new Set<(
    transition: BrowserControlTransition,
  ) => void | Promise<void>>();
  if (options.onTransition) transitionListeners.add(options.onTransition);

  const status = (): BrowserControlStatus => Object.freeze({
    state,
    revision,
    activeAutomation,
    ...(request ? {
      requestId: request.id,
      reason: request.reason,
      requestedAt: request.requestedAt,
      ...(request.pausedAt ? { pausedAt: request.pausedAt } : {}),
      ...(request.acquiredAt ? { acquiredAt: request.acquiredAt } : {}),
    } : {}),
    transitionCallbackFailures,
    ...(lastTransitionCallbackError ? { lastTransitionCallbackError } : {}),
  });

  const emit = (
    type: BrowserControlTransition["type"],
    from: BrowserControlState,
    to: BrowserControlState,
    details: Pick<BrowserControlTransition, "message" | "outcome"> = {},
  ) => {
    revision += 1;
    const transition: BrowserControlTransition = Object.freeze({
      type,
      from,
      to,
      revision,
      timestamp: new Date().toISOString(),
      ...(request ? { requestId: request.id, reason: request.reason } : {}),
      ...details,
    });
    const recordCallbackFailure = (error: unknown) => {
      transitionCallbackFailures += 1;
      const errorName = error instanceof Error ? error.name : typeof error;
      const safeName = String(errorName).replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) || "unknown";
      lastTransitionCallbackError = `Transition callback failed (${safeName}).`;
    };
    for (const listener of transitionListeners) {
      try {
        const pending = listener(transition);
        if (pending && typeof pending.then === "function") {
          void Promise.resolve(pending).catch(recordCallbackFailure);
        }
      } catch (error) {
        recordCallbackFailure(error);
      }
    }
  };

  const transitionTo = (
    next: BrowserControlState,
    type: BrowserControlTransition["type"],
    details?: Pick<BrowserControlTransition, "message" | "outcome">,
  ) => {
    const previous = state;
    state = next;
    emit(type, previous, next, details);
  };

  const wakeDrainWaiters = () => {
    if (activeAutomation !== 0 && state !== "closed") return;
    for (const resolve of drainWaiters) resolve();
    drainWaiters.clear();
  };

  const waitForDrain = async () => {
    if (activeAutomation === 0 || state === "closed") return;
    await new Promise<void>((resolve) => drainWaiters.add(resolve));
  };

  const invalidTransition = (command: string, message: string) => new BrowserControlError({
    code: state === "closed" ? "session_closed" : "invalid_control_transition",
    state,
    command,
    ...(request ? { requestId: request.id } : {}),
    message,
  });

  return {
    status,
    requestTakeover: async (input) => {
      if (state !== "automation") {
        throw invalidTransition(
          "request-takeover",
          state === "closed"
            ? "Browser control session is closed."
            : `Takeover cannot be requested while browser control is ${state}.`,
        );
      }
      const reason = takeoverReason(input?.reason);
      const message = input.message === undefined ? undefined : boundedMessage(input.message);
      const requestedAt = new Date().toISOString();
      request = { id: randomUUID(), reason, requestedAt };
      leaseId = undefined;
      transitionTo("pausing", "pause-requested", message ? { message } : undefined);
      await waitForDrain();
      const stateAfterDrain = status().state;
      if (stateAfterDrain === "closed") {
        throw invalidTransition("request-takeover", "Browser control session is closed.");
      }
      if (stateAfterDrain !== "pausing" || !request) {
        throw invalidTransition("request-takeover", "Takeover request no longer owns the browser control transition.");
      }
      request.pausedAt = new Date().toISOString();
      transitionTo("paused", "paused");
      return status();
    },
    takeControl: (input) => {
      if (state !== "paused") {
        throw invalidTransition(
          "take-control",
          "Human control can only be acquired after automation has paused.",
        );
      }
      if (!request || input?.requestId !== request.id) {
        throw invalidTransition("take-control", "Takeover request ID does not match the paused session.");
      }
      request.acquiredAt = new Date().toISOString();
      leaseId = randomUUID();
      transitionTo("human-control", "human-control-acquired");
      return Object.freeze({
        requestId: request.id,
        leaseId,
        acquiredAt: request.acquiredAt,
      });
    },
    resumeAutomation: (input) => {
      if (state !== "human-control") {
        throw invalidTransition(
          "resume-automation",
          "Automation can only resume while human control owns the session.",
        );
      }
      if (!request || input?.requestId !== request.id || input?.leaseId !== leaseId) {
        throw invalidTransition(
          "resume-automation",
          "Request or lease ID does not match the active human-control lease.",
        );
      }
      const outcome = takeoverOutcome(input.outcome);
      transitionTo("automation", "automation-resumed", { outcome });
      request = undefined;
      leaseId = undefined;
      return status();
    },
    runAutomation: async <T>(command: string, operation: () => Promise<T>) => {
      const safeCommand = boundedCommand(command);
      if (state !== "automation") {
        throw new BrowserControlError({
          code: state === "closed" ? "session_closed" : "automation_paused",
          state,
          command: safeCommand,
          ...(request ? { requestId: request.id } : {}),
        });
      }
      activeAutomation += 1;
      try {
        return await operation();
      } finally {
        activeAutomation = Math.max(0, activeAutomation - 1);
        wakeDrainWaiters();
      }
    },
    onTransition: (listener) => {
      if (typeof listener !== "function") throw new TypeError("Browser control transition listener must be a function.");
      if (state === "closed") throw invalidTransition("observe-transitions", "Browser control session is closed.");
      transitionListeners.add(listener);
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        transitionListeners.delete(listener);
      };
    },
    close: () => {
      if (state === "closed") return status();
      transitionTo("closed", "closed");
      request = undefined;
      leaseId = undefined;
      wakeDrainWaiters();
      transitionListeners.clear();
      return status();
    },
  };
}

function takeoverReason(value: unknown): BrowserTakeoverReason {
  if (value === "challenge" || value === "sensitive-step" || value === "other") return value;
  throw new TypeError("Takeover reason must be challenge, sensitive-step, or other.");
}

function takeoverOutcome(value: unknown): BrowserTakeoverOutcome {
  if (value === undefined || value === "completed") return "completed";
  if (value === "cancelled") return value;
  throw new TypeError("Takeover outcome must be completed or cancelled.");
}

function boundedMessage(value: unknown) {
  if (typeof value !== "string") throw new TypeError("Takeover message must be a string.");
  return boundedText(value, MAX_TAKEOVER_MESSAGE_LENGTH);
}

function boundedText(value: string, maxLength: number) {
  const normalized = [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || (code >= 0x7f && code <= 0x9f) ? " " : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return [...normalized].slice(0, maxLength).join("");
}

function boundedCommand(value: unknown) {
  const command = String(value ?? "unknown")
    .replace(/[^A-Za-z0-9_.:-]/g, "")
    .slice(0, MAX_COMMAND_LENGTH);
  return command || "unknown";
}

function boundedIdentifier(value: unknown) {
  const identifier = String(value ?? "")
    .replace(/[^A-Za-z0-9_.:-]/g, "")
    .slice(0, MAX_IDENTIFIER_LENGTH);
  return identifier || undefined;
}

function controlErrorMessage(
  code: BrowserControlError["code"],
  state: BrowserControlState,
  command: string,
) {
  if (code === "session_closed") return "Browser control session is closed.";
  if (code === "takeover_unavailable") return "Human takeover is unavailable for this browser session.";
  if (code === "page_unavailable_after_takeover") return "No browser page is available after human takeover.";
  if (code === "invalid_control_transition") return `Invalid browser control transition from ${state}.`;
  return `Browser automation command ${boundedCommand(command)} is paused while control state is ${state}.`;
}
