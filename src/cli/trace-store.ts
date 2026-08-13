import { chmod, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { HarnessTraceExport } from "../trace-recorder.js";

/** Recorder default (768 KiB) plus the single persisted trailing newline. */
export const MAX_PERSISTED_TRACE_BYTES = 768 * 1024 + 1;
const MAX_PERSISTED_EVENTS = 100;
const MAX_PERSISTED_STRING_LENGTH = 8_000;
const MAX_VALIDATION_DEPTH = 8;
const MAX_VALIDATION_NODES = 5_000;

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
    if (!metadata.isFile() || metadata.size > MAX_PERSISTED_TRACE_BYTES) {
      throw invalidStoredTrace(path, "file exceeds the bounded trace size");
    }
    raw = await file.readFile("utf8");
    if (Buffer.byteLength(raw, "utf8") > MAX_PERSISTED_TRACE_BYTES) {
      throw invalidStoredTrace(path, "file changed while it was being read");
    }
  } finally {
    await file.close();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw invalidStoredTrace(path, "JSON is malformed");
  }
  validateTraceExport(parsed, path);
  return parsed;
}

function validateTraceExport(value: unknown, path: string): asserts value is HarnessTraceExport {
  if (!isRecord(value)
    || value.version !== 1
    || typeof value.generatedAt !== "string"
    || !validTimestamp(value.generatedAt)
    || !nonNegativeInteger(value.omittedEvents)
    || !Array.isArray(value.events)
    || value.events.length > MAX_PERSISTED_EVENTS) {
    throw invalidStoredTrace(path, "top-level contract is invalid");
  }
  if (value.identity !== undefined) validateIdentity(value.identity, path);
  let previousSequence = 0;
  const budget = { nodes: MAX_VALIDATION_NODES };
  for (const event of value.events) {
    if (!isRecord(event)
      || !nonNegativeInteger(event.sequence)
      || event.sequence <= previousSequence
      || !["action", "batch", "lifecycle"].includes(String(event.kind))
      || typeof event.timestamp !== "string"
      || !validTimestamp(event.timestamp)
      || typeof event.completedAt !== "string"
      || !validTimestamp(event.completedAt)
      || typeof event.durationMs !== "number"
      || !Number.isFinite(event.durationMs)
      || event.durationMs < 0
      || typeof event.stateChanging !== "boolean"
      || !boundedString(event.command)
      || !isRecord(event.input)
      || !Array.isArray(event.targetRefs)
      || event.targetRefs.length > 20
      || !event.targetRefs.every((targetRef) => boundedString(targetRef))
      || !isRecord(event.url)
      || !boundedString(event.url.before)
      || !boundedString(event.url.after)
      || !["succeeded", "failed"].includes(String(event.status))) {
      throw invalidStoredTrace(path, "event contract is invalid");
    }
    previousSequence = event.sequence;
    validateBoundedJson(event.input, path, budget, 0);
    for (const optional of [event.result, event.error]) {
      if (optional !== undefined && !boundedString(optional)) {
        throw invalidStoredTrace(path, "event output is invalid");
      }
    }
    if (event.identity !== undefined) validateIdentity(event.identity, path);
    if (event.approval !== undefined) validateBoundedJson(event.approval, path, budget, 0);
    if (event.media !== undefined) validateBoundedJson(event.media, path, budget, 0);
    if (event.contentBoundary !== undefined) validateBoundedJson(event.contentBoundary, path, budget, 0);
  }
}

function validateIdentity(value: unknown, path: string) {
  if (!isRecord(value)
    || (value.sessionId !== undefined && !boundedString(value.sessionId, 160))
    || (value.agentId !== undefined && !boundedString(value.agentId, 160))) {
    throw invalidStoredTrace(path, "identity is invalid");
  }
}

function validateBoundedJson(
  value: unknown,
  path: string,
  budget: { nodes: number },
  depth: number,
) {
  budget.nodes -= 1;
  if (budget.nodes < 0 || depth > MAX_VALIDATION_DEPTH) {
    throw invalidStoredTrace(path, "nested data exceeds its bound");
  }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value === "string" && boundedString(value)) return;
  if (Array.isArray(value)) {
    if (value.length > 100) throw invalidStoredTrace(path, "array exceeds its bound");
    for (const child of value) validateBoundedJson(child, path, budget, depth + 1);
    return;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length > 100) throw invalidStoredTrace(path, "object exceeds its bound");
    for (const [key, child] of entries) {
      if (!boundedString(key, 160)) throw invalidStoredTrace(path, "object key exceeds its bound");
      validateBoundedJson(child, path, budget, depth + 1);
    }
    return;
  }
  throw invalidStoredTrace(path, "nested value is invalid");
}

function invalidStoredTrace(path: string, reason: string) {
  return new Error(`Stored browser trace is invalid (${reason}): ${path}`);
}

function validTimestamp(value: string) {
  return Number.isFinite(Date.parse(value));
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function boundedString(value: unknown, max = MAX_PERSISTED_STRING_LENGTH): value is string {
  return typeof value === "string" && value.length <= max;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
