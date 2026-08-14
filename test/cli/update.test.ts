import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cacheIsFresh,
  compareSemver,
  createPackageUpdateReport,
  formatUpdateAvailableMessage,
  formatUpdatePrompt,
  harnessPackageVersion,
  isNewerPackageVersion,
  npmLatestMetadataUrl,
  packageInstallCommand,
  packageUpdateCachePath,
  parseNpmLatestVersion,
  parseSemver,
  readPackageUpdateCache,
  shouldOfferUpdateCheck,
  shouldPromptForCachedUpdate,
  writePackageUpdateCache,
} from "../../src/cli/update.js";
import {
  knownSkillDestinations,
  packageSkillPath,
  refreshInstalledSkills,
} from "../../src/cli/skill.js";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const currentVersion = harnessPackageVersion();
let temporaryDirectory: string | undefined;
let registry: Awaited<ReturnType<typeof startRegistry>> | undefined;

afterEach(async () => {
  await registry?.close();
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = undefined;
  registry = undefined;
});

describe("package update helpers", () => {
  test("compares numeric package versions and rejects non-semver values", () => {
    expect(parseSemver("0.1.8")).toEqual([0, 1, 8]);
    expect(parseSemver("1.0.0-beta")).toBeNull();
    expect(compareSemver("0.1.9", "0.1.8")).toBe(1);
    expect(compareSemver("0.1.8", "0.1.8")).toBe(0);
    expect(compareSemver("0.1.8", "0.2.0")).toBe(-1);
    expect(isNewerPackageVersion("0.1.9", "0.1.8")).toBe(true);
    expect(isNewerPackageVersion("0.1.8", "0.1.8")).toBe(false);
    expect(() => compareSemver("latest", "0.1.8")).toThrow("major.minor.patch");
  });

  test("builds a bounded npm latest report and install command", () => {
    expect(parseNpmLatestVersion({ version: "0.2.0" })).toBe("0.2.0");
    expect(() => parseNpmLatestVersion({ version: "next" })).toThrow("numeric package version");
    expect(npmLatestMetadataUrl()).toBe(
      "https://registry.npmjs.org/@blopai%2Fbrowser-harness/latest",
    );
    expect(packageInstallCommand()).toBe("npm install --global @blopai/browser-harness");
    expect(createPackageUpdateReport({
      current: "0.1.8",
      latest: "0.1.9",
    })).toEqual({
      ok: true,
      package: "@blopai/browser-harness",
      current: "0.1.8",
      latest: "0.1.9",
      updateAvailable: true,
      installCommand: "npm install --global @blopai/browser-harness",
      registry: "https://registry.npmjs.org/@blopai%2Fbrowser-harness/latest",
    });
    expect(formatUpdatePrompt(createPackageUpdateReport({
      current: "0.1.8",
      latest: "0.1.9",
    }))).toContain("Update the package and installed skill now?");
    expect(formatUpdateAvailableMessage(createPackageUpdateReport({
      current: "0.1.8",
      latest: "0.1.9",
    }))).toContain("Existing browser-harness skill copies are refreshed");
  });

  test("offers interactive checks only outside JSON, CI, and explicit opt-out", () => {
    expect(shouldOfferUpdateCheck({
      command: "open",
      json: false,
      interactive: true,
      env: {},
    })).toBe(true);
    expect(shouldOfferUpdateCheck({
      command: "doctor",
      json: true,
      interactive: true,
      env: {},
    })).toBe(false);
    expect(shouldOfferUpdateCheck({
      command: "update",
      json: false,
      interactive: true,
      env: {},
    })).toBe(false);
    expect(shouldOfferUpdateCheck({
      command: "open",
      json: false,
      interactive: true,
      env: { CI: "true" },
    })).toBe(false);
    expect(shouldOfferUpdateCheck({
      command: "open",
      json: false,
      interactive: true,
      env: { BLOP_BROWSER_UPDATE_CHECK: "off" },
    })).toBe(false);
  });

  test("reuses a fresh cache and skips a previously declined latest version", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "blop-update-cache-"));
    const path = packageUpdateCachePath(join(temporaryDirectory, "config.json"));
    const now = Date.parse("2026-08-14T12:00:00.000Z");
    await writePackageUpdateCache(path, {
      version: 1,
      checkedAt: "2026-08-14T11:00:00.000Z",
      current: "0.1.8",
      latest: "0.1.9",
      declinedLatest: "0.1.9",
    });
    const cache = await readPackageUpdateCache(path);
    expect(cacheIsFresh(cache, "0.1.8", now)).toBe(true);
    expect(cacheIsFresh(cache, "0.1.8", Date.parse("2026-08-16T12:00:00.000Z"))).toBe(false);
    expect(shouldPromptForCachedUpdate(cache, "0.1.9")).toBe(false);
    expect(shouldPromptForCachedUpdate(cache, "0.1.10")).toBe(true);
  });
});

describe("package update CLI", () => {
  test("includes the installed package version in doctor without contacting npm", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "blop-update-doctor-"));
    const result = await runCli(["doctor", "--json"], temporaryDirectory);
    expect(result.response.result?.package).toEqual({
      name: "@blopai/browser-harness",
      version: currentVersion,
      updateCommand: "blop-browser update",
    });
  });

  test("reports an available npm version through update --json", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "blop-update-check-"));
    registry = await startRegistry({ version: bumpPatch(currentVersion) });
    const result = await runCli(["update", "--json"], temporaryDirectory, {
      BLOP_BROWSER_NPM_REGISTRY: registry.url,
    });
    expect(result.response).toEqual({
      ok: true,
      result: {
        ok: true,
        package: "@blopai/browser-harness",
        current: currentVersion,
        latest: bumpPatch(currentVersion),
        updateAvailable: true,
        installCommand: "npm install --global @blopai/browser-harness",
        registry: `${registry.url}/@blopai%2Fbrowser-harness/latest`,
        installed: false,
        skillsUpdated: [],
      },
    });
    expect(registry.requests).toEqual(["/@blopai%2Fbrowser-harness/latest"]);
  });

  test("installs through the update script after explicit --install", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "blop-update-install-"));
    registry = await startRegistry({ version: bumpPatch(currentVersion) });
    const npmPath = join(temporaryDirectory, "fake-npm");
    const receiptPath = join(temporaryDirectory, "npm-args.txt");
    await writeFile(npmPath, `#!/bin/sh\nprintf '%s' "$*" > ${JSON.stringify(receiptPath)}\n`);
    await chmod(npmPath, 0o755);
    const result = await runCli(["update", "--install", "--json"], temporaryDirectory, {
      BLOP_BROWSER_NPM_REGISTRY: registry.url,
      BLOP_BROWSER_NPM_PATH: npmPath,
    });
    expect(result.response.result).toEqual(expect.objectContaining({
      updateAvailable: true,
      installed: true,
      skillsUpdated: [],
    }));
    expect(await readFile(receiptPath, "utf8")).toBe(
      "install --global @blopai/browser-harness",
    );
  });

  test("does not install when the registry version matches the installed package", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "blop-update-current-"));
    registry = await startRegistry({ version: currentVersion });
    const npmPath = join(temporaryDirectory, "fake-npm");
    const receiptPath = join(temporaryDirectory, "npm-args.txt");
    await writeFile(npmPath, `#!/bin/sh\nprintf 'ran' > ${JSON.stringify(receiptPath)}\n`);
    await chmod(npmPath, 0o755);
    const result = await runCli(["update", "--install", "--json"], temporaryDirectory, {
      BLOP_BROWSER_NPM_REGISTRY: registry.url,
      BLOP_BROWSER_NPM_PATH: npmPath,
    });
    expect(result.response.result).toEqual(expect.objectContaining({
      latest: currentVersion,
      updateAvailable: false,
      installed: false,
    }));
    expect(await pathExists(receiptPath)).toBe(false);
  });

  test("refreshes existing skill copies and does not create new ones", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "blop-update-skill-"));
    registry = await startRegistry({ version: bumpPatch(currentVersion) });
    const home = join(temporaryDirectory, "home");
    const projectDirectory = join(temporaryDirectory, "project");
    const staleSkill = join(home, ".agents", "skills", "browser-harness", "SKILL.md");
    const missingSkill = join(home, ".claude", "skills", "browser-harness", "SKILL.md");
    const projectSkill = join(projectDirectory, ".opencode", "skills", "browser-harness", "SKILL.md");
    await mkdir(dirname(staleSkill), { recursive: true });
    await mkdir(dirname(projectSkill), { recursive: true });
    await writeFile(staleSkill, "stale user skill\n");
    await writeFile(projectSkill, "stale project skill\n");
    const npmPath = join(temporaryDirectory, "fake-npm");
    await writeFile(npmPath, "#!/bin/sh\nexit 0\n");
    await chmod(npmPath, 0o755);

    const result = await runCli(["update", "--install", "--json"], temporaryDirectory, {
      BLOP_BROWSER_NPM_REGISTRY: registry.url,
      BLOP_BROWSER_NPM_PATH: npmPath,
      HOME: home,
    }, projectDirectory);

    const expectedSkill = await readFile(packageSkillPath(), "utf8");
    expect(result.response.result).toEqual(expect.objectContaining({
      installed: true,
      skillsUpdated: [staleSkill, projectSkill],
    }));
    expect(await readFile(staleSkill, "utf8")).toBe(expectedSkill);
    expect(await readFile(projectSkill, "utf8")).toBe(expectedSkill);
    expect(await pathExists(missingSkill)).toBe(false);
  });
});

describe("installed skill refresh", () => {
  test("lists only known user and project skill destinations", () => {
    expect(knownSkillDestinations({
      home: "/tmp/home",
      projectDirectory: "/tmp/project",
    })).toEqual([
      "/tmp/home/.agents/skills/browser-harness/SKILL.md",
      "/tmp/home/.claude/skills/browser-harness/SKILL.md",
      "/tmp/home/.config/opencode/skills/browser-harness/SKILL.md",
      "/tmp/project/.agents/skills/browser-harness/SKILL.md",
      "/tmp/project/.claude/skills/browser-harness/SKILL.md",
      "/tmp/project/.opencode/skills/browser-harness/SKILL.md",
    ]);
  });

  test("overwrites existing skill files from the packaged source", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "blop-skill-refresh-"));
    const destination = join(
      temporaryDirectory,
      ".agents",
      "skills",
      "browser-harness",
      "SKILL.md",
    );
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, "old skill\n");
    expect(await refreshInstalledSkills({
      home: temporaryDirectory,
      projectDirectory: join(temporaryDirectory, "empty-project"),
    })).toEqual([destination]);
    expect(await readFile(destination, "utf8")).toBe(await readFile(packageSkillPath(), "utf8"));
  });
});

async function runCli(
  args: string[],
  stateDir: string,
  environment: Record<string, string> = {},
  cwd = repositoryRoot,
) {
  const process = Bun.spawn(["bun", join(repositoryRoot, "src/cli.ts"), ...args], {
    cwd,
    env: {
      ...globalThis.process.env,
      BLOP_BROWSER_CONFIG_PATH: join(stateDir, "browser-config.json"),
      BLOP_BROWSER_RUNTIME_DIR: stateDir,
      BLOP_BROWSER_HEADLESS: "1",
      BLOP_BROWSER_UPDATE_CHECK: "off",
      HOME: join(stateDir, "isolated-home"),
      ...environment,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`CLI exited ${exitCode}: ${stderr || stdout}`);
  }
  return {
    stdout,
    stderr,
    response: JSON.parse(stdout) as {
      ok: boolean;
      result?: {
        package?: unknown;
        ok?: boolean;
        current?: string;
        latest?: string;
        updateAvailable?: boolean;
        installCommand?: string;
        registry?: string;
        installed?: boolean;
      };
    },
  };
}

async function startRegistry(payload: { version: string }) {
  const requests: string[] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    requests.push(request.url ?? "");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fake npm registry did not expose a TCP port.");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => await new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function bumpPatch(version: string) {
  const [major, minor, patch] = version.split(".").map(Number);
  return `${major}.${minor}.${(patch ?? 0) + 1}`;
}

async function pathExists(path: string) {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}
