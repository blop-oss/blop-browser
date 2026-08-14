import { lstat, opendir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { validateBrowserSessionName } from "../session/scope.js";

export const MAX_CLASSIFIED_RUNTIME_ENTRIES = 1_024;
export const MAX_INSPECTED_RUNTIME_ENTRIES = MAX_CLASSIFIED_RUNTIME_ENTRIES + 1;
export const MAX_LISTED_RUNTIME_ENTRIES = 96;
export const MAX_REPORTED_FILE_BYTES = 16 * 1_024 * 1_024;

const RETAINED_SUFFIXES = [
  ["profile", "-profile"],
  ["downloads", "-downloads"],
  ["artifacts", "-artifacts"],
  ["endpoint", ".json"],
  ["startup-lock", ".starting"],
  ["daemon-log", ".log"],
] as const;

type RetainedDataKind = typeof RETAINED_SUFFIXES[number][0];

export type RetainedDataEntry = {
  kind: RetainedDataKind;
  path: string;
  nodeType: "file" | "directory" | "symlink" | "other" | "unavailable";
  fileBytes: number | null;
  fileBytesClipped: boolean;
};

export type RetainedSessionData = {
  session: string;
  entries: RetainedDataEntry[];
  deleteCommand: string;
};

export type RetainedDataInventory = {
  version: 1;
  runtimeDirectory: string;
  limits: {
    inspectedEntries: number;
    classifiedEntries: number;
    listedEntries: number;
    reportedFileBytes: number;
  };
  inspectedEntries: number;
  listedEntries: number;
  truncated: boolean;
  sessions: RetainedSessionData[];
  preserved: PreservedRetainedData[];
  measurement: "metadata-only; at most 1,024 entries are classified and one additional entry may be read to establish truncation; directories are not traversed";
};

export type PreservedRetainedData = {
  category: "global-config" | "browser-cache" | "docker-resources" | "external-browser-profile";
  location: string | null;
  reason: string;
};

export async function listRetainedSessionData(
  runtimeDirectory: string,
  configPath: string,
): Promise<RetainedDataInventory> {
  const grouped = new Map<string, RetainedDataEntry[]>();
  let inspectedEntries = 0;
  let listedEntries = 0;
  let truncated = false;
  let directory: Awaited<ReturnType<typeof opendir>>;
  try {
    directory = await opendir(runtimeDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return inventory(runtimeDirectory, configPath, grouped, 0, 0, false);
  }

  for await (const directoryEntry of directory) {
    inspectedEntries += 1;
    if (inspectedEntries > MAX_CLASSIFIED_RUNTIME_ENTRIES) {
      truncated = true;
      break;
    }
    const recognized = recognizeRetainedEntry(directoryEntry.name);
    if (!recognized) continue;
    const path = join(runtimeDirectory, directoryEntry.name);
    if (resolve(path) === resolve(configPath)) continue;
    if (listedEntries >= MAX_LISTED_RUNTIME_ENTRIES) {
      truncated = true;
      continue;
    }
    const metadata = await retainedEntryMetadata(path, recognized.kind);
    const entries = grouped.get(recognized.session) ?? [];
    entries.push(metadata);
    grouped.set(recognized.session, entries);
    listedEntries += 1;
  }
  return inventory(
    runtimeDirectory,
    configPath,
    grouped,
    Math.min(inspectedEntries, MAX_INSPECTED_RUNTIME_ENTRIES),
    listedEntries,
    truncated,
  );
}

function recognizeRetainedEntry(name: string): { session: string; kind: RetainedDataKind } | null {
  for (const [kind, suffix] of RETAINED_SUFFIXES) {
    if (!name.endsWith(suffix)) continue;
    const session = name.slice(0, -suffix.length);
    try {
      validateBrowserSessionName(session);
      return { session, kind };
    } catch {
      return null;
    }
  }
  return null;
}

async function retainedEntryMetadata(path: string, kind: RetainedDataKind): Promise<RetainedDataEntry> {
  try {
    const metadata = await lstat(path, { bigint: true });
    const nodeType = metadata.isSymbolicLink()
      ? "symlink"
      : metadata.isFile()
      ? "file"
      : metadata.isDirectory()
      ? "directory"
      : "other";
    const measuredBytes = nodeType === "file" ? metadata.size : null;
    const clipped = measuredBytes !== null && measuredBytes > BigInt(MAX_REPORTED_FILE_BYTES);
    return {
      kind,
      path,
      nodeType,
      fileBytes: measuredBytes === null
        ? null
        : Number(clipped ? BigInt(MAX_REPORTED_FILE_BYTES) : measuredBytes),
      fileBytesClipped: clipped,
    };
  } catch {
    return {
      kind,
      path,
      nodeType: "unavailable",
      fileBytes: null,
      fileBytesClipped: false,
    };
  }
}

function inventory(
  runtimeDirectory: string,
  configPath: string,
  grouped: Map<string, RetainedDataEntry[]>,
  inspectedEntries: number,
  listedEntries: number,
  truncated: boolean,
): RetainedDataInventory {
  return {
    version: 1,
    runtimeDirectory,
    limits: {
      inspectedEntries: MAX_INSPECTED_RUNTIME_ENTRIES,
      classifiedEntries: MAX_CLASSIFIED_RUNTIME_ENTRIES,
      listedEntries: MAX_LISTED_RUNTIME_ENTRIES,
      reportedFileBytes: MAX_REPORTED_FILE_BYTES,
    },
    inspectedEntries,
    listedEntries,
    truncated,
    sessions: [...grouped]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([session, entries]) => ({
        session,
        entries: entries.sort((left, right) => left.kind.localeCompare(right.kind)),
        deleteCommand: `blop-browser data delete ${session}`,
      })),
    preserved: preservedRetainedData(configPath),
    measurement: "metadata-only; at most 1,024 entries are classified and one additional entry may be read to establish truncation; directories are not traversed",
  };
}

export function preservedRetainedData(configPath: string): PreservedRetainedData[] {
  return [
    {
      category: "global-config",
      location: configPath,
      reason: "Configuration is global and is not deleted with session data.",
    },
    {
      category: "browser-cache",
      location: null,
      reason: "Browser binaries and package-managed caches are not enumerated or deleted.",
    },
    {
      category: "docker-resources",
      location: null,
      reason: "Docker containers, images, and volumes are managed separately.",
    },
    {
      category: "external-browser-profile",
      location: null,
      reason: "Attached-browser profiles and their storage remain owned by that browser.",
    },
  ];
}
