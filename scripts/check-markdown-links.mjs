#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const repositoryRoot = resolve(new URL("..", import.meta.url).pathname);
const ignoredDirectories = new Set([
  ".git",
  ".mind2web",
  ".blop-test-screenshots",
  ".blop-test-screenshots-only-first",
  ".blop-test-screenshots-scope",
  "dist",
  "node_modules",
]);
const markdownFiles = collectMarkdownFiles(repositoryRoot);

const failures = [];

for (const relativeFile of markdownFiles) {
  const absoluteFile = resolve(repositoryRoot, relativeFile);
  const source = readFileSync(absoluteFile, "utf8");
  const destinations = [
    ...source.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^)]*["'])?\)/g),
  ].map((match) => match[1]);

  for (const htmlMatch of source.matchAll(
    /<(?:img|source)\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi,
  )) {
    destinations.push(htmlMatch[1]);
  }

  for (const rawDestination of destinations) {
    const destination = rawDestination.replace(/^<|>$/g, "");
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(destination)) continue;

    const path = decodeURIComponent(destination.split("#", 1)[0]);
    if (!path) continue;
    const target = path.startsWith("/")
      ? resolve(repositoryRoot, `.${path}`)
      : resolve(dirname(absoluteFile), path);
    if (!existsSync(target)) failures.push(`${relativeFile}: ${destination}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(
    `Broken local Markdown links:\n${failures.map((item) => `- ${item}`).join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Checked local links and image sources in ${markdownFiles.length} Markdown files.\n`,
  );
}

function collectMarkdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (
      entry.name.startsWith(".") &&
      entry.name !== ".github" &&
      entry.name !== ".opencode"
    ) {
      return [];
    }
    if (ignoredDirectories.has(entry.name)) return [];
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) return collectMarkdownFiles(absolutePath);
    return entry.isFile() && entry.name.endsWith(".md")
      ? [relative(repositoryRoot, absolutePath)]
      : [];
  });
}
