import { chmod, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  MAX_SESSION_METRICS_BYTES,
  validateSessionMetrics,
  type HarnessSessionMetrics,
} from "../session-metrics.js";

/** Recorder export ceiling plus the single persisted trailing newline. */
export const MAX_PERSISTED_METRICS_BYTES = MAX_SESSION_METRICS_BYTES + 1;

export function cliMetricsPath(artifactDirectory: string) {
  return join(artifactDirectory, "browser-metrics.json");
}

export async function persistCliMetrics(
  artifactDirectory: string,
  json: string,
) {
  if (Buffer.byteLength(json, "utf8") > MAX_SESSION_METRICS_BYTES) {
    throw new Error("Session metrics exceed the bounded export size.");
  }
  await mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
  await chmod(artifactDirectory, 0o700).catch(() => undefined);
  const path = cliMetricsPath(artifactDirectory);
  const temporary = `${path}.${process.pid}-${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${json}\n`, { mode: 0o600 });
    await rename(temporary, path);
    await chmod(path, 0o600).catch(() => undefined);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function readPersistedCliMetrics(
  artifactDirectory: string,
): Promise<HarnessSessionMetrics | null> {
  const path = cliMetricsPath(artifactDirectory);
  let file: Awaited<ReturnType<typeof open>>;
  try {
    file = await open(path, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let raw: string;
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size > MAX_PERSISTED_METRICS_BYTES) {
      throw invalidStoredMetrics(path, "file exceeds the bounded metrics size");
    }
    raw = await file.readFile("utf8");
    if (Buffer.byteLength(raw, "utf8") > MAX_PERSISTED_METRICS_BYTES) {
      throw invalidStoredMetrics(path, "file changed while it was being read");
    }
  } finally {
    await file.close();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw invalidStoredMetrics(path, "JSON is malformed");
  }
  try {
    validateSessionMetrics(parsed);
  } catch {
    throw invalidStoredMetrics(path, "aggregate contract is invalid");
  }
  return parsed;
}

function invalidStoredMetrics(path: string, reason: string) {
  return new Error(`Stored browser metrics are invalid (${reason}): ${path}`);
}
