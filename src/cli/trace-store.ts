import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { HarnessTraceExport } from "../trace-recorder.js";

export type CliTracePaths = {
  json: string;
  timeline: string;
};

export function cliTracePaths(artifactDirectory: string): CliTracePaths {
  return {
    json: join(artifactDirectory, "browser-trace.json"),
    timeline: join(artifactDirectory, "browser-trace.txt"),
  };
}

export async function persistCliTrace(
  artifactDirectory: string,
  json: string,
  timeline: string,
) {
  await mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
  await chmod(artifactDirectory, 0o700).catch(() => undefined);
  const paths = cliTracePaths(artifactDirectory);
  const suffix = `${process.pid}-${randomUUID()}.tmp`;
  const temporaryJson = `${paths.json}.${suffix}`;
  const temporaryTimeline = `${paths.timeline}.${suffix}`;
  try {
    await Promise.all([
      writeFile(temporaryJson, `${json}\n`, { mode: 0o600 }),
      writeFile(temporaryTimeline, `${timeline}\n`, { mode: 0o600 }),
    ]);
    await Promise.all([
      rename(temporaryJson, paths.json),
      rename(temporaryTimeline, paths.timeline),
    ]);
    await Promise.all([
      chmod(paths.json, 0o600).catch(() => undefined),
      chmod(paths.timeline, 0o600).catch(() => undefined),
    ]);
  } catch (error) {
    await Promise.all([
      rm(temporaryJson, { force: true }),
      rm(temporaryTimeline, { force: true }),
    ]);
    throw error;
  }
}

export async function readPersistedCliTrace(
  artifactDirectory: string,
): Promise<HarnessTraceExport | null> {
  const path = cliTracePaths(artifactDirectory).json;
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const parsed = JSON.parse(raw) as Partial<HarnessTraceExport>;
  if (parsed.version !== 1 || !Array.isArray(parsed.events) || typeof parsed.omittedEvents !== "number") {
    throw new Error(`Stored browser trace is invalid: ${path}`);
  }
  return parsed as HarnessTraceExport;
}
