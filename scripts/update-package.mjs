#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const PACKAGE_NAME = "@blopai/browser-harness";
const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const REGISTRY_PATH = "/@blopai%2Fbrowser-harness/latest";
const DEFAULT_TIMEOUT_MS = 3_000;

const require = createRequire(import.meta.url);

try {
  await main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(
    `${JSON.stringify({
      ok: false,
      error: { code: "update_script_error", message },
    })}\n`,
  );
  process.exitCode = 1;
}

async function main(args) {
  const command = args[0];
  if (command === "check") {
    const report = await checkLatest(parseOptions(args.slice(1)));
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return;
  }
  if (command === "install") {
    const exitCode = await installPackage(parseOptions(args.slice(1)));
    process.exitCode = exitCode ?? 1;
    return;
  }
  throw new Error("Usage: update-package.mjs check|install");
}

async function checkLatest(options) {
  const current = options.current ?? packageVersion();
  const registry = npmLatestMetadataUrl(options.registry);
  const response = await fetch(registry, {
    headers: {
      accept: "application/json",
      "user-agent": `blop-browser-update/${current}`,
    },
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`npm registry returned HTTP ${response.status}.`);
  }
  const payload = await response.json();
  const latest = payload?.version;
  if (typeof latest !== "string" || !/^\d+\.\d+\.\d+$/.test(latest)) {
    throw new Error(
      "npm latest metadata must include a numeric package version.",
    );
  }
  if (!/^\d+\.\d+\.\d+$/.test(current)) {
    throw new Error(
      "Package versions must be numeric major.minor.patch values.",
    );
  }
  return {
    ok: true,
    package: PACKAGE_NAME,
    current,
    latest,
    updateAvailable: compareSemver(latest, current) > 0,
    installCommand: `${options.npm ?? "npm"} install --global ${PACKAGE_NAME}`,
    registry,
  };
}

async function installPackage(options) {
  const npmExecutable = options.npm ?? "npm";
  const child = spawn(npmExecutable, ["install", "--global", PACKAGE_NAME], {
    env: process.env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error("Options require a value.");
    }
    if (name === "--current") options.current = value;
    else if (name === "--registry") options.registry = value;
    else if (name === "--npm") options.npm = value;
    else if (name === "--timeout-ms") options.timeoutMs = Number(value);
    else throw new Error(`Unknown option: ${name}`);
  }
  return options;
}

function packageVersion() {
  return require("../package.json").version;
}

function npmLatestMetadataUrl(registry = DEFAULT_REGISTRY) {
  return `${String(registry).replace(/\/$/, "")}${REGISTRY_PATH}`;
}

function compareSemver(left, right) {
  const parsedLeft = left.split(".").map(Number);
  const parsedRight = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (parsedLeft[index] !== parsedRight[index]) {
      return parsedLeft[index] < parsedRight[index] ? -1 : 1;
    }
  }
  return 0;
}
