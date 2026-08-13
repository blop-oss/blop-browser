import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import {
  assertLoopbackFixtureUrl,
  assertIgnoredResultPath,
  collectFixtureSignals,
  loadDetectionProtocol,
  runLocalSignalProtocol,
  startSignalFixture,
  validateReport,
  validateSignals,
} from "../../benchmarks/detection/core.mjs";

const resources: Array<() => Promise<void>> = [];

afterAll(async () => {
  for (const close of resources.reverse()) await close();
});

describe("local backend signal protocol", () => {
  test("pins both backend configurations and at least three repetitions", async () => {
    const { protocol, sha256 } = await loadDetectionProtocol();

    expect(protocol.protocol_version).toBe("1.0.0");
    expect(protocol.repetitions).toBe(3);
    expect(protocol.target).toEqual({
      kind: "loopback-fixture",
      host: "127.0.0.1",
      path: "/signals",
    });
    expect(
      protocol.backends.map((backend: { id: string }) => backend.id),
    ).toEqual(["chromium-headless", "camoufox-headless"]);
    expect(protocol.backends[0].configuration).toMatchObject({
      headless: true,
      browser_channel: "playwright-bundled",
      viewport: { width: 1280, height: 720 },
      locale: "en-US",
      timezone_id: "UTC",
      bypass_csp: false,
      profile: "fresh-temporary-per-attempt",
    });
    expect(protocol.backends[1].configuration).toMatchObject({
      headless: true,
      browser_binary_version: "record-actual-installed",
      os: "linux",
      locale: ["en-US"],
      window: [1280, 720],
      humanize: false,
      bypass_csp: false,
      fingerprint_generation: "camoufox-default-unseeded-per-attempt",
    });
    expect(sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  test("rejects configuration drift under the same protocol version", async () => {
    const { protocol } = await loadDetectionProtocol();
    const changed = structuredClone(protocol);
    changed.backends[0].configuration.viewport.width = 1920;

    const { validateProtocol } =
      await import("../../benchmarks/detection/core.mjs");
    expect(() => validateProtocol(changed)).toThrow(
      "doesn't match version 1.0.0",
    );
  });

  test("rejects every non-loopback or modified fixture URL", () => {
    expect(assertLoopbackFixtureUrl("http://127.0.0.1:4173/signals")).toBe(
      "http://127.0.0.1:4173/signals",
    );
    for (const value of [
      "https://127.0.0.1:4173/signals",
      "http://localhost:4173/signals",
      "http://127.0.0.1:4173/other",
      "http://127.0.0.1:4173/signals?target=https://example.com",
      "https://example.com/signals",
    ]) {
      expect(() => assertLoopbackFixtureUrl(value)).toThrow("127.0.0.1");
    }
  });

  test("keeps generated reports inside the ignored results directory", () => {
    expect(
      assertIgnoredResultPath(
        "benchmarks/detection/.results/local-signals.json",
      ).endsWith("benchmarks/detection/.results/local-signals.json"),
    ).toBe(true);
    for (const value of [
      "benchmarks/detection/result.json",
      "benchmarks/detection/.results",
      "benchmarks/detection/.results/result.txt",
      "/tmp/blop-detection-result.json",
    ]) {
      expect(() => assertIgnoredResultPath(value)).toThrow(".results");
    }
  });

  test("collects the bounded signal contract from the controlled fixture", async () => {
    const fixture = await startSignalFixture();
    const browser = await chromium.launch({ headless: true });
    resources.push(async () => {
      await browser.close();
      await fixture.close();
    });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
      locale: "en-US",
      timezoneId: "UTC",
    });

    const signals = await collectFixtureSignals(
      page,
      fixture.url,
      "chromium-headless",
    );

    expect(signals.browser_family).toBe("chromium");
    expect(signals.user_agent.length).toBeLessThanOrEqual(512);
    expect(signals.languages.length).toBeLessThanOrEqual(8);
    expect(signals.screen.width).toBeGreaterThan(0);
    expect(signals.window.inner_width).toBe(1280);
    expect(Object.keys(signals)).not.toContain("canvas_hash");
    expect(Object.keys(signals)).not.toContain("audio_hash");
  });

  test("retains every attempt, failure, version, configuration, and limitation", async () => {
    let camoufoxAttempts = 0;
    const launchers = {
      "chromium-headless": fakeLauncher("Playwright Chromium", "143.0.0"),
      "camoufox-headless": async () => {
        camoufoxAttempts += 1;
        if (camoufoxAttempts === 1) {
          throw new Error("Camoufox executable not installed in test fixture.");
        }
        return fakeLauncher("Camoufox", "135.0.1")();
      },
    };
    const report = await runLocalSignalProtocol({
      launchers,
      collector: async (_page: unknown, _url: string, backendId: string) =>
        signalsFor(backendId),
      fixture: { url: "http://127.0.0.1:4173/signals" },
      now: () => new Date("2026-08-14T00:00:00.000Z"),
    });

    expect(report.attempts).toHaveLength(6);
    expect(report.summary).toMatchObject({
      requested: 6,
      collected: 5,
      failed: 1,
    });
    expect(report.summary.backends[1].failures).toEqual([
      {
        repetition: 1,
        failure_class: "environment",
        reason: "Camoufox executable not installed in test fixture.",
      },
    ]);
    expect(report.attempts[0]).toMatchObject({
      browser: {
        name: "Playwright Chromium",
        version: "143.0.0",
        executable_source: "playwright-bundled",
      },
      configuration: {
        headless: true,
        browser_channel: "playwright-bundled",
      },
    });
    const [harnessPackage, playwrightPackage, camoufoxPackage] = await Promise.all([
      readPackage("package.json"),
      readPackage("node_modules/playwright/package.json"),
      readPackage("node_modules/camoufox-js/package.json"),
    ]);
    expect(report.source.harness_version).toBe(harnessPackage.version);
    expect(report.source.playwright_version).toBe(playwrightPackage.version);
    expect(report.source.camoufox_js_version).toBe(camoufoxPackage.version);
    expect(report.limitations.join(" ")).toContain("not a pass");
    expect(validateReport(report)).toBe(report);
  });

  test("detects bounded per-attempt variation without producing a score", async () => {
    let attempt = 0;
    const report = await runLocalSignalProtocol({
      backendIds: ["chromium-headless"],
      launchers: {
        "chromium-headless": fakeLauncher("Playwright Chromium", "143.0.0"),
      },
      collector: async () => {
        attempt += 1;
        return signalsFor("chromium-headless", {
          hardware_concurrency: attempt === 2 ? 4 : 8,
        });
      },
      fixture: { url: "http://127.0.0.1:4173/signals" },
      now: () => new Date("2026-08-14T00:00:00.000Z"),
    });

    expect(report.summary.backends[0].varying_signal_paths).toEqual([
      "hardware_concurrency",
    ]);
    expect("score" in report.summary).toBe(false);
    expect("passed" in report.summary).toBe(false);
  });

  test("rejects tampered configuration, oversized reasons, and oversized reports", async () => {
    const report = await runLocalSignalProtocol({
      backendIds: ["chromium-headless"],
      launchers: {
        "chromium-headless": fakeLauncher("Playwright Chromium", "143.0.0"),
      },
      collector: async () => signalsFor("chromium-headless"),
      fixture: { url: "http://127.0.0.1:4173/signals" },
      now: () => new Date("2026-08-14T00:00:00.000Z"),
    });

    const changed = structuredClone(report);
    changed.attempts[0].configuration.viewport.width = 1920;
    expect(() => validateReport(changed)).toThrow("doesn't match the protocol");

    const longReason = structuredClone(report);
    longReason.attempts[0].outcome.reason = "x".repeat(1_001);
    expect(() => validateReport(longReason)).toThrow("bounded strings");

    const duplicateRepetition = structuredClone(report);
    duplicateRepetition.attempts[2].repetition = 2;
    expect(() => validateReport(duplicateRepetition)).toThrow(
      "repetitions 1, 2, and 3",
    );

    const falseSummary = structuredClone(report);
    falseSummary.summary.backends[0].varying_signal_paths = ["webdriver"];
    expect(() => validateReport(falseSummary)).toThrow(
      "must match the retained attempts",
    );

    const oversized = structuredClone(report);
    oversized.environment.platform = "x".repeat(300_000);
    expect(() => validateReport(oversized)).toThrow("262144-byte limit");
  });

  test("documents a local-only schema and exposes no live URL option", async () => {
    const [schema, runner] = await Promise.all([
      readFile("benchmarks/detection/result.schema.json", "utf8"),
      readFile("benchmarks/detection/run.mjs", "utf8"),
    ]);

    expect(schema).toContain("loopback-only");
    expect(schema).toContain('"third_party_sites": { "const": false }');
    expect(schema).not.toContain('"score"');
    expect(runner).not.toContain('"--url"');
    expect(runner).not.toContain("BLOP_DETECTION_URL");
    expect(runner).toContain("It has no live-URL option.");
  });

  test("keeps the published summary tied to the protocol and package", async () => {
    const [protocol, results, packageDocument] = await Promise.all([
      readFile("benchmarks/detection/protocol.json", "utf8"),
      readFile("benchmarks/detection/RESULTS.md", "utf8"),
      readPackage("package.json"),
    ]);
    const protocolHash = createHash("sha256").update(protocol).digest("hex");

    expect(results).toContain(protocolHash);
    expect(results).toContain("Working tree dirty");
    expect(results).toContain("`false`");
    expect(results).toContain("3/3 collected");
    expect(results).toContain("| None");
    expect(results).toContain("not a detection pass");
    expect(packageDocument.files).toContain("benchmarks/detection/RESULTS.md");
    expect(packageDocument.files).not.toContain(
      "benchmarks/detection/.results",
    );
  });
});

function fakeLauncher(name: string, version: string) {
  return async () => ({
    page: {},
    browserName: name,
    browserVersion: version,
    executableSource:
      name === "Camoufox"
        ? "installed-camoufox-package-cache"
        : "playwright-bundled",
    close: async () => {},
  });
}

async function readPackage(path: string) {
  return JSON.parse(await readFile(path, "utf8")) as {
    version: string;
    files?: string[];
  };
}

function signalsFor(
  backendId: string,
  overrides: Record<string, unknown> = {},
) {
  const firefox = backendId === "camoufox-headless";
  const signals = {
    webdriver: firefox ? false : true,
    user_agent: firefox
      ? "Mozilla/5.0 Firefox/135.0"
      : "Mozilla/5.0 HeadlessChrome/143.0",
    user_agent_contains_headless: !firefox,
    browser_family: firefox ? "firefox" : "chromium",
    platform: "Linux x86_64",
    language: "en-US",
    languages: ["en-US"],
    timezone: "UTC",
    hardware_concurrency: 8,
    device_memory: firefox ? null : 8,
    plugin_count: 0,
    mime_type_count: 0,
    screen: {
      width: 1280,
      height: 720,
      avail_width: 1280,
      avail_height: 720,
      color_depth: 24,
      pixel_depth: 24,
    },
    window: {
      inner_width: 1280,
      inner_height: 720,
      outer_width: 1280,
      outer_height: 720,
      device_pixel_ratio: 1,
    },
    webgl: {
      available: true,
      vendor: "WebKit",
      renderer: "WebKit WebGL",
    },
    ...overrides,
  };
  validateSignals(signals, backendId);
  return signals;
}
