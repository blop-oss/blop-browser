import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  _resetEgressCacheForTests,
  ensurePlaywrightContainer,
  startPlaywrightContainer,
  stopPlaywrightContainer,
} from "../../src/session/playwright-container.js";

// These tests need a working Docker daemon; skip cleanly everywhere else.
function dockerAvailable(): boolean {
  try {
    execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

const hasDocker = dockerAvailable();

// A dedicated name so the test never disturbs the real shared container.
const TEST_CONTAINER = "blop-playwright-test";
const START_TIMEOUT = 240_000;

function dockerExec(args: string[]): string {
  return execFileSync("docker", ["exec", TEST_CONTAINER, ...args], { stdio: "pipe" }).toString();
}

afterAll(async () => {
  if (hasDocker) await stopPlaywrightContainer(TEST_CONTAINER);
});

describe.skipIf(!hasDocker)("playwright container sandbox", () => {
  test(
    "one container serves multiple sessions, and the browser provably runs inside it",
    async () => {
      // --- Session A: container comes up and serves a page. ---
      const sessionA = await startPlaywrightContainer({ containerName: TEST_CONTAINER });
      expect(sessionA.browser.isConnected()).toBe(true);

      const pageA = await (await sessionA.browser.newContext()).newPage();
      await pageA.goto("data:text/html,<title>blop-a</title><h1>session a</h1>");
      expect(await pageA.title()).toBe("blop-a");

      // --- Docker-side proof 1: while the session is live, browser processes
      // exist inside the container. ---
      const processes = dockerExec(["ps", "-eo", "comm"]);
      expect(/chrom|headless/i.test(processes)).toBe(true);

      // --- Docker-side proof 2: the browser reads the *container's*
      // filesystem. A marker file written via `docker exec` is only visible to
      // a browser running inside that container. ---
      const marker = `blop-sandbox-proof-${Date.now()}`;
      dockerExec(["/bin/sh", "-c", `echo ${marker} > /tmp/${marker}.txt`]);
      await pageA.goto(`file:///tmp/${marker}.txt`);
      expect(await pageA.innerText("body")).toContain(marker);

      // --- Session B: a second start() reuses the same container instead of
      // creating a new one, and both sessions work concurrently. ---
      const sessionB = await startPlaywrightContainer({ containerName: TEST_CONTAINER });
      expect(sessionB.containerId).toBe(sessionA.containerId);

      const pageB = await (await sessionB.browser.newContext()).newPage();
      await pageB.goto("data:text/html,<title>blop-b</title>");
      expect(await pageB.title()).toBe("blop-b");
      // Session A is still healthy while B runs.
      expect(await pageA.innerText("body")).toContain(marker);

      // --- Disconnecting a session leaves the container running for reuse. ---
      await sessionA.stop();
      await sessionB.stop();
      const state = execFileSync(
        "docker",
        ["inspect", "--format", "{{.State.Running}}", TEST_CONTAINER],
        { stdio: "pipe" },
      ).toString().trim();
      expect(state).toBe("true");

      // --- Session C: reattaching after disconnect is instant reuse. ---
      const sessionC = await startPlaywrightContainer({ containerName: TEST_CONTAINER });
      expect(sessionC.containerId).toBe(sessionA.containerId);
      const pageC = await (await sessionC.browser.newContext()).newPage();
      await pageC.goto("data:text/html,<title>blop-c</title>");
      expect(await pageC.title()).toBe("blop-c");
      await sessionC.stop();
    },
    START_TIMEOUT,
  );

  test(
    "ensurePlaywrightContainer is idempotent",
    async () => {
      const first = await ensurePlaywrightContainer({ containerName: TEST_CONTAINER });
      const second = await ensurePlaywrightContainer({ containerName: TEST_CONTAINER });
      expect(second.containerId).toBe(first.containerId);
      expect(second.wsEndpoint).toBe(first.wsEndpoint);
    },
    START_TIMEOUT,
  );

  test(
    "startPlaywrightContainer reports whether the sandbox has internet egress",
    async () => {
      // The egress probe runs once per container lifetime and is cached. Reset
      // the cache so this test gets a fresh probe against the shared container.
      _resetEgressCacheForTests();
      const session = await startPlaywrightContainer({ containerName: TEST_CONTAINER });
      expect(typeof session.hasInternetEgress).toBe("boolean");
      // Whether it's true or false depends on the host's network policy; both
      // are valid. The contract is just that the flag is populated and stable.
      const firstValue = session.hasInternetEgress;
      // A second start on the same container reuses the cached probe result.
      const session2 = await startPlaywrightContainer({ containerName: TEST_CONTAINER });
      expect(session2.hasInternetEgress).toBe(firstValue);
      await session.stop();
      await session2.stop();
    },
    START_TIMEOUT,
  );
});
