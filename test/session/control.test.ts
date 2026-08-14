import { describe, expect, test } from "bun:test";
import {
  BrowserControlError,
  createBrowserControlSession,
  type BrowserControlTransition,
} from "../../src/index.js";

describe("browser control session", () => {
  test("drains admitted automation before handing an opaque lease to human control", async () => {
    const transitions: BrowserControlTransition[] = [];
    const control = createBrowserControlSession({
      onTransition: (transition) => transitions.push(transition),
    });
    let finishAutomation!: () => void;
    const admitted = control.runAutomation("browser_click", async () => {
      await new Promise<void>((resolve) => { finishAutomation = resolve; });
      return "clicked";
    });

    const pause = control.requestTakeover({
      reason: "challenge",
      message: ` Solve the challenge\nwithout logging ${"😀".repeat(400)} `,
    });
    expect(control.status()).toEqual(expect.objectContaining({
      state: "pausing",
      revision: 1,
      reason: "challenge",
      activeAutomation: 1,
    }));
    const requestId = control.status().requestId;
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(control.requestTakeover({ reason: "other" }))
      .rejects.toMatchObject({
        code: "invalid_control_transition",
        state: "pausing",
        requestId,
      });

    let blockedOperationRan = false;
    await expect(control.runAutomation("browser_snapshot", async () => {
      blockedOperationRan = true;
    })).rejects.toMatchObject({
      code: "automation_paused",
      state: "pausing",
      requestId,
      command: "browser_snapshot",
    });
    expect(blockedOperationRan).toBe(false);
    expect(() => control.takeControl({ requestId: requestId! }))
      .toThrow("Human control can only be acquired after automation has paused");

    finishAutomation();
    expect(await admitted).toBe("clicked");
    const paused = await pause;
    expect(paused).toEqual(expect.objectContaining({
      state: "paused",
      requestId,
      activeAutomation: 0,
    }));

    const acquired = control.takeControl({ requestId: requestId! });
    expect(acquired.leaseId).toMatch(/^[0-9a-f-]{36}$/);
    expect(control.status()).toEqual(expect.objectContaining({
      state: "human-control",
      requestId,
    }));
    expect(control.status()).not.toHaveProperty("leaseId");
    expect(() => control.resumeAutomation({
      requestId: requestId!,
      leaseId: "00000000-0000-4000-8000-000000000000",
      outcome: "completed",
    })).toThrow("does not match the active human-control lease");

    const resumed = control.resumeAutomation({
      requestId: requestId!,
      leaseId: acquired.leaseId,
      outcome: "completed",
    });
    expect(resumed).toEqual(expect.objectContaining({ state: "automation", revision: 4 }));
    expect(() => control.resumeAutomation({
      requestId: requestId!,
      leaseId: acquired.leaseId,
    })).toThrow("Automation can only resume while human control owns the session");
    expect(await control.runAutomation("browser_snapshot", async () => "observed")).toBe("observed");
    expect(transitions.map((transition) => transition.type)).toEqual([
      "pause-requested",
      "paused",
      "human-control-acquired",
      "automation-resumed",
    ]);
    expect([...transitions[0]!.message!]).toHaveLength(240);
    expect(transitions[0]?.message).not.toContain("�");
    expect(transitions[0]?.message).not.toMatch(/[\r\n\t]/);
    expect(Object.isFrozen(transitions[0])).toBe(true);
    expect(Object.isFrozen(control.status())).toBe(true);
  });

  test("surfaces bounded transition callback failures without repeating or wedging transitions", async () => {
    const seen: string[] = [];
    const control = createBrowserControlSession({
      onTransition: (transition) => {
        seen.push(transition.type);
        throw new TypeError(`do not expose ${"secret".repeat(100)}`);
      },
    });

    const paused = await control.requestTakeover({ reason: "sensitive-step" });
    const acquired = control.takeControl({ requestId: paused.requestId! });
    const resumed = control.resumeAutomation({
      requestId: paused.requestId!,
      leaseId: acquired.leaseId,
      outcome: "cancelled",
    });

    expect(resumed).toEqual(expect.objectContaining({
      state: "automation",
      transitionCallbackFailures: 4,
      lastTransitionCallbackError: "Transition callback failed (TypeError).",
    }));
    expect(seen).toEqual([
      "pause-requested",
      "paused",
      "human-control-acquired",
      "automation-resumed",
    ]);
  });

  test("observes async transition callback rejection without an unhandled failure", async () => {
    const control = createBrowserControlSession({
      onTransition: async () => {
        throw new RangeError("private notification transport detail");
      },
    });

    const paused = await control.requestTakeover({ reason: "challenge" });
    await Promise.resolve();

    expect(paused.state).toBe("paused");
    expect(control.status()).toEqual(expect.objectContaining({
      state: "paused",
      transitionCallbackFailures: 2,
      lastTransitionCallbackError: "Transition callback failed (RangeError).",
    }));
  });

  test("closes pending takeover waits and rejects further automation deterministically", async () => {
    const control = createBrowserControlSession();
    let finishAutomation!: () => void;
    const admitted = control.runAutomation("browser_click", async () => {
      await new Promise<void>((resolve) => { finishAutomation = resolve; });
    });
    const pause = control.requestTakeover({ reason: "other" });

    control.close();
    await expect(pause).rejects.toMatchObject({ code: "session_closed", state: "closed" });
    await expect(control.runAutomation("browser_snapshot", async () => undefined))
      .rejects.toMatchObject({ code: "session_closed", state: "closed" });
    finishAutomation();
    await admitted;
  });
});

test("BrowserControlError remains a structured harness-authored failure", () => {
  const error = new BrowserControlError({
    code: "automation_paused",
    state: "human-control",
    command: `browser_click ${"command-secret".repeat(20)}`,
    requestId: `request-id\n${"credential".repeat(30)}`,
    message: `Paused\n${"private".repeat(100)}`,
  });
  expect(error).toEqual(expect.objectContaining({
    code: "automation_paused",
    state: "human-control",
    contentBoundary: { source: "harness", trust: "trusted" },
  }));
  expect(error.command.length).toBeLessThanOrEqual(128);
  expect(error.requestId?.length).toBeLessThanOrEqual(128);
  expect(error.message.length).toBeLessThanOrEqual(240);
  expect(error.message).not.toMatch(/[\r\n\t]/);
});
