#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const documentPath = resolveDocumentPath(process.argv.slice(2));
const source = readFile(documentPath);
const failures = [];

const requiredHeadings = [
  "## Run the local proof",
  "## Choose Blop Browser when",
  "## Choose Playwright directly when",
  "## Choose another agent interface when",
  "## Proof boundaries",
];
for (const heading of requiredHeadings) {
  if (!source.includes(heading))
    failures.push(`Missing required heading: ${heading}`);
}

const proofBoundary =
  "This is an architectural contract proof, not task-success, security, or performance evidence.";
if (!source.includes(proofBoundary)) {
  failures.push("Missing the architectural contract proof boundary.");
}

if (!source.includes("[acceptable-use policy](../ACCEPTABLE_USE.md)")) {
  failures.push("Positioning proof must link to the acceptable-use policy.");
}
if (
  !source.includes(
    "[evidence-backed browser tool comparison](browser-tool-comparison.md)",
  )
) {
  failures.push(
    "Positioning proof must link to the canonical browser comparison.",
  );
}
if (!source.includes("bun run demo:positioning")) {
  failures.push("Positioning proof must include the supported demo command.");
}
if (!source.includes("[action trace contract](action-traces.md#L1-L21)")) {
  failures.push("Positioning proof must link to the action trace contract.");
}
if (!source.includes("bounded ordered harness action trace")) {
  failures.push(
    "Positioning proof must describe the bounded harness trace contract.",
  );
}
if (!source.includes("not native Playwright tracing, video")) {
  failures.push(
    "Positioning proof must distinguish harness traces from native Playwright artifacts.",
  );
}

const directSection = sectionAfter(
  source,
  "## Choose Playwright directly when",
);
for (const criterion of [
  "Playwright Test",
  "page.evaluate",
  "raw CDP",
  "Firefox",
  "WebKit",
  "one-off script",
]) {
  if (!directSection.includes(criterion)) {
    failures.push(`Playwright-direct guidance must cover: ${criterion}`);
  }
}

for (const pattern of [
  /\bBlop Browser is always\b/i,
  /\bBlop Browser is universally\b/i,
  /\bBlop Browser is (?:better|faster|safer|more secure|superior) than\b/i,
  /\b(?:the )?(?:best|fastest|safest|most secure) browser (?:tool|automation|interface)\b/i,
  /\bguarantees? (?:task success|security|safety|performance|speed)\b/i,
]) {
  if (pattern.test(source)) {
    failures.push(
      `Found unsupported superiority or performance claim: ${pattern}`,
    );
  }
}

const ledger = delimitedSection(
  source,
  "<!-- positioning-proof:start -->",
  "<!-- positioning-proof:end -->",
);
const rows = parseTable(ledger);
const expectedHeader = ["Differentiator", "Evidence", "Boundary"];
if (rows.length === 0 || !sameRow(rows[0], expectedHeader)) {
  failures.push(
    `Evidence ledger header must be: ${expectedHeader.join(" | ")}`,
  );
}

const requiredDifferentiators = [
  "Bounded semantic observations",
  "Warm cross-process sessions",
  "Parallel managed isolation",
  "Profile lifecycle and scope",
  "Explicit existing-Chrome reuse",
  "Chromium and Camoufox portability",
  "Inspectable action evidence",
  "Safety and provenance boundary",
  "Framework-neutral embedding",
];
const capabilityRows = rows.slice(1);
for (const differentiator of requiredDifferentiators) {
  if (!capabilityRows.some((row) => row[0] === differentiator)) {
    failures.push(`Missing differentiator: ${differentiator}`);
  }
}
for (const row of capabilityRows) {
  const [differentiator, evidence, boundary] = row;
  if (!differentiator || !evidence || !boundary) {
    failures.push(`Malformed evidence-ledger row: ${row.join(" | ")}`);
    continue;
  }
  const links = markdownLinks(evidence);
  if (links.length === 0) {
    failures.push(
      `${differentiator} must link to implementation or reproducible proof.`,
    );
    continue;
  }
  if (!links.some((destination) => isDirectEvidence(destination))) {
    failures.push(
      `${differentiator} must include direct src, test, or demo evidence.`,
    );
  }
  for (const destination of links)
    validateLocalEvidence(destination, differentiator);
}

validateRepositoryIntegration();

if (failures.length > 0) {
  process.stderr.write(
    `Positioning proof check failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Checked positioning proof with ${capabilityRows.length} evidence-led differentiators.\n`,
  );
}

function resolveDocumentPath(args) {
  const option = args.indexOf("--document");
  if (option >= 0) {
    if (!args[option + 1]) throw new Error("--document requires a path.");
    return resolve(args[option + 1]);
  }
  if (args.length > 0) throw new Error(`Unknown argument: ${args[0]}`);
  return joinRoot("docs", "positioning-proof.md");
}

function readFile(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Positioning proof check failed: ${message}\n`);
    process.exit(1);
  }
}

function sectionAfter(markdown, heading) {
  const start = markdown.indexOf(heading);
  if (start < 0) return "";
  const rest = markdown.slice(start + heading.length);
  const end = rest.search(/^## /m);
  return end < 0 ? rest : rest.slice(0, end);
}

function delimitedSection(markdown, startMarker, endMarker) {
  const start = markdown.indexOf(startMarker);
  const end = markdown.indexOf(endMarker);
  if (start < 0 || end < 0 || end <= start) {
    failures.push(`Missing or invalid ${startMarker} / ${endMarker} markers.`);
    return "";
  }
  return markdown.slice(start + startMarker.length, end);
}

function parseTable(markdown) {
  const tableLines = markdown
    .split("\n")
    .filter((line) => line.trim().startsWith("|"));
  return tableLines
    .map((line) =>
      line
        .trim()
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim()),
    )
    .filter((row) => !row.every((cell) => /^:?-{3,}:?$/.test(cell)));
}

function sameRow(actual, expected) {
  return (
    actual.length === expected.length &&
    actual.every((cell, index) => cell === expected[index])
  );
}

function markdownLinks(markdown) {
  return [...markdown.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)].map(
    (match) => match[1],
  );
}

function isDirectEvidence(destination) {
  return /^(?:\.\.\/)+(?:src|test|scripts)\//.test(destination);
}

function validateLocalEvidence(destination, differentiator) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(destination) || destination.startsWith("#")) {
    failures.push(`${differentiator} uses non-local evidence: ${destination}`);
    return;
  }
  const [rawPath, fragment = ""] = destination.split("#", 2);
  // Mutated fixtures may live in a temporary directory, but their relative
  // evidence links retain the maintained docs/positioning-proof.md context.
  const target = resolve(joinRoot("docs"), decodeURIComponent(rawPath));
  const relativeTarget = relative(repositoryRoot, target);
  if (
    relativeTarget.startsWith("..") ||
    resolve(repositoryRoot, relativeTarget) !== target
  ) {
    failures.push(
      `${differentiator} evidence escapes the repository: ${destination}`,
    );
    return;
  }
  if (!existsSync(target)) {
    failures.push(`${differentiator} evidence does not exist: ${destination}`);
    return;
  }
  if (!fragment) {
    failures.push(
      `${differentiator} evidence must use a line anchor: ${destination}`,
    );
    return;
  }
  const lineRange = fragment.match(/^L(\d+)(?:-L(\d+))?$/);
  if (!lineRange) {
    failures.push(
      `${differentiator} evidence has an unsupported anchor: ${destination}`,
    );
    return;
  }
  const start = Number(lineRange[1]);
  const end = Number(lineRange[2] ?? lineRange[1]);
  const lineCount = readFileSync(target, "utf8").split("\n").length;
  if (start < 1 || end < start || end > lineCount) {
    failures.push(
      `${differentiator} evidence line range is invalid for ${relativeTarget}: ${fragment}`,
    );
  }
}

function validateRepositoryIntegration() {
  const packageSource = readFile(joinRoot("package.json"));
  let manifest;
  try {
    manifest = JSON.parse(packageSource);
  } catch {
    failures.push("package.json is not valid JSON.");
    return;
  }
  if (
    manifest.scripts?.["check:positioning"] !==
    "node scripts/check-positioning-proof.mjs"
  ) {
    failures.push("package.json must expose check:positioning.");
  }
  if (
    manifest.scripts?.["demo:positioning"] !==
    "bun run build && node scripts/demo-positioning-proof.mjs"
  ) {
    failures.push(
      "package.json must expose the build-backed demo:positioning command.",
    );
  }
  if (!manifest.files?.includes("scripts/demo-positioning-proof.mjs")) {
    failures.push("The published package must include the positioning demo.");
  }

  const workflow = readFile(joinRoot(".github", "workflows", "ci.yml"));
  for (const command of [
    "bun run check:positioning",
    "bun run demo:positioning",
  ]) {
    if (!workflow.includes(command)) failures.push(`CI must run: ${command}`);
  }

  const readme = readFile(joinRoot("README.md"));
  if (
    !readme.includes(
      "[positioning and local contract proof](docs/positioning-proof.md)",
    )
  ) {
    failures.push(
      "README must link to the positioning and local contract proof.",
    );
  }

  const demo = readFile(joinRoot("scripts", "demo-positioning-proof.mjs"));
  for (const marker of [
    'server.listen(0, "127.0.0.1"',
    'network: "loopback-only"',
    'evidence: "architectural-contract"',
    'notEvidenceFor: ["task-success", "security", "performance"]',
    'recordCheck(checks, "inspectable-action-trace"',
    "MAX_PERSISTED_TRACE_BYTES",
  ]) {
    if (!demo.includes(marker))
      failures.push(`Demo is missing fail-closed marker: ${marker}`);
  }
}

function joinRoot(...parts) {
  return resolve(repositoryRoot, ...parts);
}
