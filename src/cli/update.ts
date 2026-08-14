import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const HARNESS_PACKAGE_NAME = "@blopai/browser-harness";
export const PACKAGE_UPDATE_INSTALL_ARGS = ["install", "--global", HARNESS_PACKAGE_NAME] as const;
export const PACKAGE_UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_NPM_REGISTRY = "https://registry.npmjs.org";
export const PACKAGE_UPDATE_REGISTRY_PATH = "/@blopai%2Fbrowser-harness/latest";

export type PackageUpdateReport = {
  ok: true;
  package: typeof HARNESS_PACKAGE_NAME;
  current: string;
  latest: string;
  updateAvailable: boolean;
  installCommand: string;
  registry: string;
};

export type PackageUpdateCache = {
  version: 1;
  checkedAt: string;
  current: string;
  latest: string;
  declinedLatest?: string;
};

export function harnessPackageVersion(requireImpl = createRequire(import.meta.url)) {
  return (requireImpl("../../package.json") as { version: string }).version;
}

export function packageUpdateScriptPath() {
  return fileURLToPath(new URL("../../scripts/update-package.mjs", import.meta.url));
}

export function packageUpdateCachePath(configPath: string) {
  return join(dirname(configPath), "update-check.json");
}

export function npmLatestMetadataUrl(registry = DEFAULT_NPM_REGISTRY) {
  return `${registry.replace(/\/$/, "")}${PACKAGE_UPDATE_REGISTRY_PATH}`;
}

export function packageInstallCommand(npmExecutable = "npm") {
  return [npmExecutable, ...PACKAGE_UPDATE_INSTALL_ARGS].join(" ");
}

export function parseSemver(value: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareSemver(left: string, right: string) {
  const parsedLeft = parseSemver(left);
  const parsedRight = parseSemver(right);
  if (!parsedLeft || !parsedRight) {
    throw new Error("Package versions must be numeric major.minor.patch values.");
  }
  for (let index = 0; index < 3; index += 1) {
    const leftPart = parsedLeft[index]!;
    const rightPart = parsedRight[index]!;
    if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

export function isNewerPackageVersion(latest: string, current: string) {
  return compareSemver(latest, current) > 0;
}

export function parseNpmLatestVersion(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("npm latest metadata must be a JSON object.");
  }
  const version = (payload as { version?: unknown }).version;
  if (typeof version !== "string" || !parseSemver(version)) {
    throw new Error("npm latest metadata must include a numeric package version.");
  }
  return version;
}

export function createPackageUpdateReport(input: {
  current: string;
  latest: string;
  registry?: string;
}): PackageUpdateReport {
  return {
    ok: true,
    package: HARNESS_PACKAGE_NAME,
    current: input.current,
    latest: input.latest,
    updateAvailable: isNewerPackageVersion(input.latest, input.current),
    installCommand: packageInstallCommand(),
    registry: input.registry ?? npmLatestMetadataUrl(),
  };
}

export function shouldOfferUpdateCheck(input: {
  command: string;
  json: boolean;
  interactive: boolean;
  env?: NodeJS.ProcessEnv;
}) {
  const env = input.env ?? process.env;
  if (input.json || !input.interactive) return false;
  if (env.CI === "true") return false;
  if ((env.BLOP_BROWSER_UPDATE_CHECK ?? "on") === "off") return false;
  return !["", "help", "--help", "-h", "update", "_daemon"].includes(input.command);
}

export function shouldPromptForCachedUpdate(cache: PackageUpdateCache | null, latest: string) {
  return cache?.declinedLatest !== latest;
}

export function cacheIsFresh(
  cache: PackageUpdateCache | null,
  current: string,
  now = Date.now(),
  ttlMs = PACKAGE_UPDATE_CHECK_TTL_MS,
) {
  if (!cache) return false;
  if (cache.version !== 1 || cache.current !== current) return false;
  const checkedAt = Date.parse(cache.checkedAt);
  return Number.isFinite(checkedAt) && now - checkedAt < ttlMs;
}

export async function readPackageUpdateCache(path: string): Promise<PackageUpdateCache | null> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(source) as Partial<PackageUpdateCache>;
    if (
      parsed.version !== 1
      || typeof parsed.checkedAt !== "string"
      || typeof parsed.current !== "string"
      || typeof parsed.latest !== "string"
    ) {
      return null;
    }
    return {
      version: 1,
      checkedAt: parsed.checkedAt,
      current: parsed.current,
      latest: parsed.latest,
      ...(typeof parsed.declinedLatest === "string" ? { declinedLatest: parsed.declinedLatest } : {}),
    };
  } catch {
    return null;
  }
}

export async function writePackageUpdateCache(path: string, cache: PackageUpdateCache) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600).catch(() => undefined);
}

export function formatUpdatePrompt(report: PackageUpdateReport) {
  return `A newer ${report.package} is available (${report.latest}; you have ${report.current}). Update the package and installed skill now? [y/N]: `;
}

export function formatUpdateAvailableMessage(report: PackageUpdateReport) {
  return `A newer ${report.package} is available (${report.latest}; you have ${report.current}).\nRun: ${report.installCommand}\nExisting browser-harness skill copies are refreshed after that install.`;
}
