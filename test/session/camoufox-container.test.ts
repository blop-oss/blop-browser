import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  startCamoufoxContainer,
  stopCamoufoxContainer,
} from "../../src/session/camoufox-container.js";

const TEST_CONTAINER = "blop-camoufox-test";

function dockerAvailable(): boolean {
  try {
    execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

const hasDocker = dockerAvailable();

describe.skipIf(!hasDocker)("Camoufox container session", () => {
  afterAll(async () => {
    await stopCamoufoxContainer(TEST_CONTAINER);
  });

  test("runs Camoufox in a separate reusable container", async () => {
    const sessionA = await startCamoufoxContainer({ containerName: TEST_CONTAINER });
    try {
      expect(sessionA.hasInternetEgress).toBeNull();
      expect(sessionA.internetEgressProbe).toEqual({
        enabled: false,
        destination: null,
      });
      const contextA = await sessionA.browser.newContext({ viewport: null });
      const pageA = await contextA.newPage();
      await pageA.setContent("<title>Camoufox A</title><h1>ready a</h1>");
      expect(await pageA.title()).toBe("Camoufox A");
      expect(sessionA.containerName).toBe(TEST_CONTAINER);

      const processes = execFileSync(
        "docker",
        ["exec", TEST_CONTAINER, "ps", "-eo", "args"],
        { stdio: "pipe" },
      ).toString();
      expect(processes.toLowerCase()).toContain("camoufox-bin");

      const sessionB = await startCamoufoxContainer({ containerName: TEST_CONTAINER });
      try {
        expect(sessionB.containerId).toBe(sessionA.containerId);
        const contextB = await sessionB.browser.newContext({ viewport: null });
        const pageB = await contextB.newPage();
        await pageB.setContent("<title>Camoufox B</title><h1>ready b</h1>");
        expect(await pageB.title()).toBe("Camoufox B");
        expect(await pageA.locator("h1").textContent()).toBe("ready a");
        await contextB.close();
      } finally {
        await sessionB.stop();
      }
      await contextA.close();
    } finally {
      await sessionA.stop();
    }
  }, 300_000);
});
