import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SESSION_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export type BrowserProfileMode = "persistent" | "disposable";

export type BrowserSessionScope = {
  mode: BrowserProfileMode | "existing-profile";
  storageScope: "session" | "external-browser";
  profileDirectory: string | null;
  downloadsDirectory: string | null;
  artifactDirectory: string;
  owner: string;
  expiresAt: string | null;
  destroyable: boolean;
};

export type BrowserSessionDirectories = {
  runtimeDirectory: string;
  profileDirectory: string;
  downloadsDirectory: string;
  artifactDirectory: string;
};

export function validateBrowserSessionName(session: string) {
  if (!SESSION_PATTERN.test(session)) {
    throw new Error("Session names must use 1-64 letters, numbers, underscores, or hyphens.");
  }
  return session;
}

export function browserSessionDirectories(
  session: string,
  runtimeDirectory = defaultBrowserRuntimeDirectory(),
): BrowserSessionDirectories {
  validateBrowserSessionName(session);
  const root = resolve(runtimeDirectory);
  return {
    runtimeDirectory: root,
    profileDirectory: join(root, `${session}-profile`),
    downloadsDirectory: join(root, `${session}-downloads`),
    artifactDirectory: join(root, `${session}-artifacts`),
  };
}

export function getBrowserSessionScope(
  session: string,
  options: {
    runtimeDirectory?: string;
    existingProfile?: boolean;
    profileMode?: BrowserProfileMode;
    expiresAt?: string | null;
  } = {},
): BrowserSessionScope {
  const paths = browserSessionDirectories(session, options.runtimeDirectory);
  const existingProfile = options.existingProfile === true;
  return {
    mode: existingProfile ? "existing-profile" : options.profileMode ?? "persistent",
    storageScope: existingProfile ? "external-browser" : "session",
    profileDirectory: existingProfile ? null : paths.profileDirectory,
    downloadsDirectory: existingProfile ? null : paths.downloadsDirectory,
    artifactDirectory: paths.artifactDirectory,
    owner: browserSessionOwner(),
    expiresAt: existingProfile || options.profileMode !== "disposable" ? null : options.expiresAt ?? null,
    destroyable: !existingProfile,
  };
}

export function defaultBrowserRuntimeDirectory() {
  const uid = typeof process.getuid === "function" ? process.getuid() : "user";
  return process.env.BLOP_BROWSER_RUNTIME_DIR || join(tmpdir(), `blop-browser-${uid}`);
}

function browserSessionOwner() {
  if (typeof process.getuid === "function") return `uid:${process.getuid()}`;
  return `user:${process.env.USER ?? process.env.USERNAME ?? "unknown"}`;
}
