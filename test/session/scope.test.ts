import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  browserSessionDirectories,
  getBrowserSessionScope,
  validateBrowserSessionName,
} from "../../src/index.js";

describe("browser session scope API", () => {
  test("describes managed and existing-profile storage without exposing an implicit profile", () => {
    const runtimeDirectory = join("/tmp", "browser-scope-api");
    const persistent = getBrowserSessionScope("agent-a", { runtimeDirectory });
    const disposable = getBrowserSessionScope("agent-b", {
      runtimeDirectory,
      profileMode: "disposable",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    const existing = getBrowserSessionScope("agent-c", { runtimeDirectory, existingProfile: true });

    expect(persistent).toEqual(expect.objectContaining({
      mode: "persistent",
      storageScope: "session",
      profileDirectory: join(runtimeDirectory, "agent-a-profile"),
      downloadsDirectory: join(runtimeDirectory, "agent-a-downloads"),
      expiresAt: null,
      destroyable: true,
    }));
    expect(disposable).toEqual(expect.objectContaining({
      mode: "disposable",
      expiresAt: "2030-01-01T00:00:00.000Z",
    }));
    expect(existing).toEqual(expect.objectContaining({
      mode: "existing-profile",
      storageScope: "external-browser",
      profileDirectory: null,
      downloadsDirectory: null,
      expiresAt: null,
      destroyable: false,
    }));
    expect(browserSessionDirectories("agent-a", runtimeDirectory).profileDirectory)
      .not.toBe(browserSessionDirectories("agent-b", runtimeDirectory).profileDirectory);
  });

  test("rejects names that could escape the runtime directory", () => {
    expect(() => validateBrowserSessionName("../primary-profile")).toThrow("Session names must use");
  });
});
