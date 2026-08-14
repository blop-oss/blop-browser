import { describe, expect, test } from "bun:test";
import { createBrowserControlSession, createTraceRecorder } from "../../src/index.js";
import { setupToolPage, tool } from "./tool-fixture.js";

describe("human takeover tool boundary", () => {
  test("rejects every command before Page access while human owns control", async () => {
    const control = createBrowserControlSession();
    const trace = createTraceRecorder();
    const fixture = await setupToolPage("<h1>Challenge</h1>", [], { control, traceRecorder: trace });
    try {
      const paused = await control.requestTakeover({
        reason: "challenge",
        message: `\t${"😀".repeat(300)}\n`,
      });
      const lease = control.takeControl({ requestId: paused.requestId! });
      const page = fixture.page as typeof fixture.page & Record<string, unknown>;
      const originalUrl = page.url;
      const originalContext = page.context;
      const originalIsClosed = page.isClosed;
      const originalTitle = page.title;
      const originalLocator = page.locator;
      let pageAccesses = 0;
      page.url = (() => { pageAccesses += 1; throw new Error("Page.url must not run"); }) as never;
      page.context = (() => { pageAccesses += 1; throw new Error("Page.context must not run"); }) as never;
      page.isClosed = (() => { pageAccesses += 1; throw new Error("Page.isClosed must not run"); }) as never;
      page.title = (() => { pageAccesses += 1; throw new Error("Page.title must not run"); }) as never;
      page.locator = (() => { pageAccesses += 1; throw new Error("Page.locator must not run"); }) as never;

      for (const [name, input] of [
        ["browser_snapshot", {}],
        ["browser_click", { target: "Missing" }],
        ["browser_run_steps", { steps: [{ tool: "browser_snapshot", input: {} }] }],
      ] as const) {
        await expect(tool(fixture.tools, name).execute(input as Record<string, unknown>))
          .rejects.toMatchObject({
            code: "automation_paused",
            state: "human-control",
            command: name,
          });
      }
      expect(pageAccesses).toBe(0);
      expect(fixture.actions.slice(-3).map(({ name }) => name)).toEqual([
        "browser_snapshot",
        "browser_click",
        "browser_run_steps",
      ]);
      expect(fixture.actions.slice(-3).every((action) =>
        action.metadata?.controlCode === "automation_paused"
        && action.metadata?.controlState === "human-control")).toBe(true);
      const cachedUrl = new URL("/", fixture.serverUrl).href;
      expect(trace.snapshot().events.slice(-3).map((event) => ({
        command: event.command,
        status: event.status,
        before: event.url.before,
        after: event.url.after,
      }))).toEqual([
        { command: "browser_snapshot", status: "failed", before: cachedUrl, after: cachedUrl },
        { command: "browser_click", status: "failed", before: cachedUrl, after: cachedUrl },
        { command: "browser_run_steps", status: "failed", before: cachedUrl, after: cachedUrl },
      ]);
      expect(trace.snapshot().events.find((event) =>
        event.command === "browser_control_pause_requested")?.input.message).toEqual({
        redacted: true,
        type: "string",
        length: 240,
      });

      page.url = originalUrl;
      page.context = originalContext;
      page.isClosed = originalIsClosed;
      page.title = originalTitle;
      page.locator = originalLocator;
      control.resumeAutomation({
        requestId: paused.requestId!,
        leaseId: lease.leaseId,
        outcome: "completed",
      });
      expect((await tool(fixture.tools, "browser_snapshot").execute({})).content)
        .toContain("Challenge");
    } finally {
      await fixture.cleanup();
    }
  });

  test("waits for admitted Playwright work and invalidates semantic refs across takeover", async () => {
    const control = createBrowserControlSession();
    const fixture = await setupToolPage(`
      <button>Continue</button>
      <script>setTimeout(() => document.body.append(' Ready'), 250)</script>
    `, [], { control });
    try {
      const snapshot = await tool(fixture.tools, "browser_snapshot").execute({});
      const ref = JSON.parse(snapshot.content).semanticSnapshot.match(/\[((?:f\d+)?e\d+|x\d+)\]/)?.[1];
      expect(ref).toBeTruthy();

      const admitted = tool(fixture.tools, "browser_expect_text").execute({
        text: "Ready",
        timeoutMs: 2_000,
      });
      await expectEventually(() => control.status().activeAutomation === 1);

      let pauseSettled = false;
      const pause = control.requestTakeover({ reason: "sensitive-step" })
        .then((status) => { pauseSettled = true; return status; });
      await Promise.resolve();
      expect(control.status()).toEqual(expect.objectContaining({ state: "pausing", activeAutomation: 1 }));
      expect(pauseSettled).toBe(false);

      await admitted;
      const paused = await pause;
      const lease = control.takeControl({ requestId: paused.requestId! });
      await fixture.page.getByRole("button").evaluate((button) => {
        button.textContent = "Human changed control";
      });
      control.resumeAutomation({ requestId: paused.requestId!, leaseId: lease.leaseId });

      await expect(tool(fixture.tools, "browser_click").execute({ target: { ref } }))
        .rejects.toThrow("Unknown or stale element reference");
      expect((await tool(fixture.tools, "browser_snapshot").execute({})).content)
        .toContain("Human changed control");
    } finally {
      await fixture.cleanup();
    }
  });

  test("masks password-like values from semantic and ARIA observations after human input", async () => {
    const secret = "human-only-password-3491";
    const longSecret = `${secret}-${"s".repeat(5_000)}-private-tail`;
    const control = createBrowserControlSession();
    const fixture = await setupToolPage(`
      <label>Password <input type="password" autocomplete="current-password" /></label>
      <label>Secret note <textarea name="secret_note"></textarea></label>
      <div contenteditable="true" aria-label="Access token"></div>
      <div contenteditable="true" name="secret_editor"></div>
      <label>Display name <input value="Ada" /></label>
    `, [], { control });
    try {
      const paused = await control.requestTakeover({ reason: "sensitive-step" });
      const lease = control.takeControl({ requestId: paused.requestId! });
      await fixture.page.getByLabel("Password").fill(secret);
      await fixture.page.getByLabel("Secret note").fill(`${secret}-note`);
      await fixture.page.getByLabel("Access token").fill(`${secret}-token`);
      await fixture.page.locator("[name='secret_editor']").fill(longSecret);
      control.resumeAutomation({ requestId: paused.requestId!, leaseId: lease.leaseId });

      const observed = await tool(fixture.tools, "browser_snapshot").execute({
        includeAria: true,
      });
      expect(observed.content).not.toContain(secret);
      expect(observed.content).toContain("[REDACTED]");
      expect(observed.content).toContain("Ada");

      const scoped = await tool(fixture.tools, "browser_snapshot").execute({
        target: { selector: "[name='secret_editor']" },
        includeAria: true,
      });
      expect(scoped.content).not.toContain(secret);
      expect(scoped.content).not.toContain("private-tail");
      expect(scoped.content).toContain("[REDACTED]");
    } finally {
      await fixture.cleanup();
    }
  });

  test("reconciles a human-selected replacement page before automation resumes Page access", async () => {
    const control = createBrowserControlSession();
    const fixture = await setupToolPage("<h1>Original page</h1>", [], { control });
    try {
      const paused = await control.requestTakeover({ reason: "other" });
      const lease = control.takeControl({ requestId: paused.requestId! });
      const replacement = await fixture.page.context().newPage();
      await replacement.setContent("<h1>Human replacement page</h1>");
      await fixture.page.close();
      control.resumeAutomation({ requestId: paused.requestId!, leaseId: lease.leaseId });

      const observed = await tool(fixture.tools, "browser_snapshot").execute({});
      expect(observed.content).toContain("Human replacement page");
    } finally {
      await fixture.cleanup();
    }
  });

  test("records a bounded failure when human control closes every page", async () => {
    const control = createBrowserControlSession();
    const trace = createTraceRecorder();
    const fixture = await setupToolPage("<h1>Only page</h1>", [], { control, traceRecorder: trace });
    try {
      const paused = await control.requestTakeover({ reason: "other" });
      const lease = control.takeControl({ requestId: paused.requestId! });
      await fixture.page.close();
      control.resumeAutomation({ requestId: paused.requestId!, leaseId: lease.leaseId });

      await expect(tool(fixture.tools, "browser_snapshot").execute({}))
        .rejects.toMatchObject({
          code: "page_unavailable_after_takeover",
          command: "reconcile-page",
        });
      expect(fixture.actions.at(-1)).toEqual(expect.objectContaining({
        name: "browser_snapshot",
        metadata: expect.objectContaining({
          controlBlocked: true,
          controlCode: "page_unavailable_after_takeover",
        }),
      }));
      expect(trace.snapshot().events.at(-1)).toEqual(expect.objectContaining({
        command: "browser_snapshot",
        status: "failed",
      }));
    } finally {
      await fixture.cleanup();
    }
  });
});

async function expectEventually(predicate: () => boolean, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(predicate()).toBe(true);
}
