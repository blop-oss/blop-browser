import { constants } from "node:fs";
import { access, copyFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL_DIRECTORY_NAME = "browser-harness";
export const SKILL_FILE_NAME = "SKILL.md";
export const SKILL_TARGETS = ["agents", "claude", "opencode", "all"] as const;
export const SKILL_SCOPES = ["project", "user"] as const;

export type SkillTarget = typeof SKILL_TARGETS[number];
export type SkillScope = typeof SKILL_SCOPES[number];

export function packageSkillPath() {
  return fileURLToPath(new URL("../../skills/browser-harness/SKILL.md", import.meta.url));
}

export function skillInstallRoots(
  target: SkillTarget,
  scope: SkillScope,
  projectDirectory: string,
  home = process.env.HOME ?? homedir(),
) {
  const agents = scope === "user"
    ? join(home, ".agents", "skills")
    : join(projectDirectory, ".agents", "skills");
  const claude = scope === "user"
    ? join(home, ".claude", "skills")
    : join(projectDirectory, ".claude", "skills");
  const opencode = scope === "user"
    ? join(home, ".config", "opencode", "skills")
    : join(projectDirectory, ".opencode", "skills");
  if (target === "claude") return [claude];
  if (target === "agents") return [agents];
  if (target === "opencode") return [opencode];
  return [agents, claude];
}

export function knownSkillDestinations(input: {
  home?: string;
  projectDirectory?: string;
}) {
  const home = input.home ?? process.env.HOME ?? homedir();
  const projectDirectory = resolve(input.projectDirectory ?? process.cwd());
  return [
    join(home, ".agents", "skills", SKILL_DIRECTORY_NAME, SKILL_FILE_NAME),
    join(home, ".claude", "skills", SKILL_DIRECTORY_NAME, SKILL_FILE_NAME),
    join(home, ".config", "opencode", "skills", SKILL_DIRECTORY_NAME, SKILL_FILE_NAME),
    join(projectDirectory, ".agents", "skills", SKILL_DIRECTORY_NAME, SKILL_FILE_NAME),
    join(projectDirectory, ".claude", "skills", SKILL_DIRECTORY_NAME, SKILL_FILE_NAME),
    join(projectDirectory, ".opencode", "skills", SKILL_DIRECTORY_NAME, SKILL_FILE_NAME),
  ];
}

export async function installSkills(input: {
  target: SkillTarget;
  scope: SkillScope;
  projectDirectory: string;
  force?: boolean;
  source?: string;
  home?: string;
}) {
  const source = input.source ?? packageSkillPath();
  const installed: string[] = [];
  for (const root of skillInstallRoots(input.target, input.scope, input.projectDirectory, input.home)) {
    const destination = join(root, SKILL_DIRECTORY_NAME, SKILL_FILE_NAME);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination, input.force ? 0 : constants.COPYFILE_EXCL);
    installed.push(destination);
  }
  return installed;
}

export async function refreshInstalledSkills(input: {
  source?: string;
  home?: string;
  projectDirectory?: string;
} = {}) {
  const source = input.source ?? packageSkillPath();
  const updated: string[] = [];
  for (const destination of knownSkillDestinations(input)) {
    if (!await pathExists(destination)) continue;
    await copyFile(source, destination);
    updated.push(destination);
  }
  return updated;
}

async function pathExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
