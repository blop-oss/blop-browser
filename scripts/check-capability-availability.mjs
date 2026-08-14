#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const options = parseArgs(process.argv.slice(2));
const document = readFile(options.document);
const normalizedDocument = document.replace(/\s+/g, " ");
const failures = [];
const notOffered = "Not offered by this project (N/A).";

const officialSources = new Map([
  [
    "GitHub repository metadata",
    /^https:\/\/api\.github\.com\/repos\/blop-oss\/blop-browser$/,
  ],
  [
    "GitHub organization metadata",
    /^https:\/\/api\.github\.com\/orgs\/blop-oss$/,
  ],
  [
    "Published npm package",
    /^https:\/\/registry\.npmjs\.org\/@blopai%2Fbrowser-harness\/latest$/,
  ],
  ["Blop Browser documentation", /^https:\/\/docs\.blopai\.com\/harness\/$/],
  ["Separate Blop QA pricing", /^https:\/\/blopai\.com\/pricing$/],
  ["Separate Blop QA privacy page", /^https:\/\/blopai\.com\/privacy$/],
  ["Separate Blop QA terms page", /^https:\/\/blopai\.com\/terms$/],
]);
const requiredCapabilities = [
  "Runtime and hosting",
  "Profile persistence",
  "Parallel sessions",
  "Chrome and CDP",
  "Camoufox",
  "Recordings and traces",
  "Session metrics",
  "Privacy and telemetry",
  "Human takeover",
  "Proxy service",
  "Retention and deletion",
  "Limits and quotas",
  "Billing and accounts",
  "Support",
];

const sourceRows = parseTable(
  section(
    document,
    "<!-- availability-sources:start -->",
    "<!-- availability-sources:end -->",
  ),
);
validateHeader(
  sourceRows,
  ["Source", "Reviewed finding", "Snapshot", "Reviewed on"],
  "official source ledger",
);
const reviewedSources = new Set();
for (const row of sourceRows.slice(1)) {
  const [source, finding, snapshot, reviewedOn] = row;
  const sourceLink = markdownLinkEntries(source ?? "")[0];
  const sourceName = sourceLink?.label;
  if (!sourceName || !finding || !snapshot || !reviewedOn) {
    failures.push(`Malformed official source row: ${row.join(" | ")}`);
    continue;
  }
  if (reviewedSources.has(sourceName)) {
    failures.push(`Duplicate official source: ${sourceName}`);
  }
  reviewedSources.add(sourceName);
  const expectedUrl = officialSources.get(sourceName);
  if (!expectedUrl) {
    failures.push(`Unregistered official source: ${sourceName}`);
  } else if (!expectedUrl.test(sourceLink.destination)) {
    failures.push(`${sourceName} must link its reviewed first-party source.`);
  }
  if (!/^[A-Z][a-z]+ \d{1,2}, \d{4}$/.test(reviewedOn)) {
    failures.push(`${sourceName} must record an unambiguous review date.`);
  }
  if (
    sourceName === "Separate Blop QA pricing" &&
    ![
      "a Free band at €0 and “Free forever”",
      "paid Starter, Team, and Scale bands at €199, €599, and €1,499 per month",
      "each with a 14-day trial",
      "Enterprise with custom pricing",
    ].every((required) => finding.includes(required))
  ) {
    failures.push(
      "Separate Blop QA pricing must preserve the current plan facts.",
    );
  }
  if (
    sourceName === "Separate Blop QA pricing" &&
    ![
      "a workspace moves to the Free band after the paid period",
      "Nothing is deleted",
    ].every((required) => finding.includes(required))
  ) {
    failures.push(
      "Separate Blop QA pricing must preserve the current cancellation finding.",
    );
  }
  if (
    sourceName === "Separate Blop QA pricing" &&
    ![
      "It does not identify these as Blop Browser hosting plans",
      "or define a numeric test-artifact retention window",
    ].every((required) => finding.includes(required))
  ) {
    failures.push(
      "Separate Blop QA pricing must preserve the product boundary.",
    );
  }
  if (
    sourceName === "Separate Blop QA privacy page" &&
    ![
      "labels itself placeholder copy",
      "Last updated: Not yet published",
      "no numeric test-artifact retention period",
    ].every((required) => finding.includes(required))
  ) {
    failures.push(
      "Separate Blop QA privacy page must preserve its unpublished retention finding.",
    );
  }
  if (
    sourceName === "Separate Blop QA terms page" &&
    ![
      "labels itself placeholder copy",
      "Last updated: Not yet published",
      "without creating a Blop Browser hosting entitlement",
    ].every((required) => finding.includes(required))
  ) {
    failures.push(
      "Separate Blop QA terms page must preserve its unpublished product boundary.",
    );
  }
}
for (const sourceName of officialSources.keys()) {
  if (!reviewedSources.has(sourceName)) {
    failures.push(`Missing official source: ${sourceName}`);
  }
}

const matrixRows = parseTable(
  section(
    document,
    "<!-- availability-matrix:start -->",
    "<!-- availability-matrix:end -->",
  ),
);
validateHeader(
  matrixRows,
  ["Capability", "Local open source", "Hosted free", "Hosted paid"],
  "capability matrix",
);
const capabilities = new Set();
for (const row of matrixRows.slice(1)) {
  const [capability, local, hostedFree, hostedPaid] = row;
  if (!capability || !local || !hostedFree || !hostedPaid) {
    failures.push(`Malformed capability row: ${row.join(" | ")}`);
    continue;
  }
  if (capabilities.has(capability)) {
    failures.push(`Duplicate capability: ${capability}`);
  }
  capabilities.add(capability);
  if (!requiredCapabilities.includes(capability)) {
    failures.push(`Unregistered capability: ${capability}`);
  }

  const evidenceLinks = markdownLinkEntries(local);
  if (evidenceLinks.length === 0) {
    failures.push(
      `${capability} must link local implementation or test evidence.`,
    );
  }
  if (
    !evidenceLinks.some(({ destination }) => isDirectLocalEvidence(destination))
  ) {
    failures.push(`${capability} must cite implementation or test evidence.`);
  }
  for (const { destination } of evidenceLinks) {
    validateLocalEvidence(destination, capability);
  }
  if (hostedFree !== notOffered) {
    failures.push(`${capability} must mark Hosted free as ${notOffered}`);
  }
  if (hostedPaid !== notOffered) {
    failures.push(`${capability} must mark Hosted paid as ${notOffered}`);
  }
}
for (const capability of requiredCapabilities) {
  if (!capabilities.has(capability)) {
    failures.push(`Missing capability: ${capability}`);
  }
}

for (const required of [
  "Blop Browser has no hosted free or paid tier.",
  "That product is not a hosting tier for this package.",
  "It does not mean that a hosted feature exists but has an unknown limit.",
  "It needs no Blop account, hosted API key, subscription, or payment.",
  "npx playwright install chromium",
  "blop-browser --session local-review status --json",
  "blop-browser --session local-review trace --json",
  "blop-browser --session local-review metrics --json",
  "blop-browser data list --json",
  "The CLI emits a structured privacy summary before the first browser command and through `status` and `doctor`.",
  "First-party harness telemetry is off and has no collection backend",
  "this is not a claim about browser/site, CDP, diagnostic, host/provider, or other network flows",
  "blop-browser --session local-review close",
  "blop-browser --session local-review destroy",
  "Disposable close or idle shutdown removes the managed profile, downloads, artifacts, and daemon log after shutdown is confirmed; a cleanup timeout preserves managed data and reports failure.",
]) {
  if (!normalizedDocument.includes(required)) {
    failures.push(
      `Availability document is missing required contract: ${required}`,
    );
  }
}

for (const pattern of [
  /\b(?:free|paid|hosted) Blop Browser (?:hosting|sessions?|tiers?)\b/i,
  /\bBlop Browser (?:free|paid|hosted) (?:hosting|sessions?|tiers?)\b/i,
]) {
  if (pattern.test(document)) {
    failures.push(
      "Availability document invents a Blop Browser hosted entitlement.",
    );
  }
}

validateIntegration(options);

if (failures.length > 0) {
  process.stderr.write(
    `Capability availability check failed:\n${failures
      .map((failure) => `- ${failure}`)
      .join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Checked capability availability across ${matrixRows.length - 1} capabilities and ${sourceRows.length - 1} official sources.\n`,
  );
}

function parseArgs(args) {
  const paths = {
    document: resolve(repositoryRoot, "docs", "capability-availability.md"),
    readme: resolve(repositoryRoot, "README.md"),
    skill: resolve(repositoryRoot, "skills", "browser-harness", "SKILL.md"),
    package: resolve(repositoryRoot, "package.json"),
    claims: resolve(repositoryRoot, "docs", "public-claims.md"),
    limitations: resolve(repositoryRoot, "docs", "known-limitations.md"),
    workflow: resolve(repositoryRoot, ".github", "workflows", "ci.yml"),
  };
  const names = new Map([
    ["--document", "document"],
    ["--readme", "readme"],
    ["--skill", "skill"],
    ["--package", "package"],
    ["--claims", "claims"],
    ["--limitations", "limitations"],
    ["--workflow", "workflow"],
  ]);
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const key = names.get(option);
    if (!key) throw new Error(`Unknown argument: ${option}`);
    if (!args[index + 1]) throw new Error(`${option} requires a path.`);
    paths[key] = resolve(args[index + 1]);
  }
  return paths;
}

function readFile(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Capability availability check failed: ${message}\n`);
    process.exit(1);
  }
}

function section(markdown, startMarker, endMarker) {
  const start = markdown.indexOf(startMarker);
  const end = markdown.indexOf(endMarker);
  if (start < 0 || end < 0 || end <= start) {
    failures.push(`Missing or invalid ${startMarker} / ${endMarker} markers.`);
    return "";
  }
  return markdown.slice(start + startMarker.length, end);
}

function parseTable(markdown) {
  return markdown
    .split("\n")
    .filter((line) => line.trim().startsWith("|"))
    .map((line) =>
      line
        .trim()
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim()),
    )
    .filter((row) => !row.every((cell) => /^:?-{3,}:?$/.test(cell)));
}

function validateHeader(rows, expected, label) {
  if (
    rows.length === 0 ||
    rows[0].length !== expected.length ||
    !rows[0].every((cell, index) => cell === expected[index])
  ) {
    failures.push(`${label} header must be: ${expected.join(" | ")}`);
  }
}

function markdownLinkEntries(markdown) {
  return [...markdown.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)].map((match) => ({
    label: match[1],
    destination: match[2],
  }));
}

function isDirectLocalEvidence(destination) {
  return (
    /^(?:\.\.\/)+(?:src|test|\.github)\//.test(destination) ||
    /^(?:\.\.\/)+(?:package\.json|LICENSE|SECURITY\.md)#/.test(destination)
  );
}

function validateLocalEvidence(destination, capability) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(destination) || destination.startsWith("#")) {
    failures.push(`${capability} uses non-local evidence: ${destination}`);
    return;
  }
  const [rawPath, fragment = ""] = destination.split("#", 2);
  const target = resolve(repositoryRoot, "docs", decodeURIComponent(rawPath));
  const relativeTarget = relative(repositoryRoot, target);
  if (
    relativeTarget.startsWith("..") ||
    resolve(repositoryRoot, relativeTarget) !== target
  ) {
    failures.push(
      `${capability} evidence escapes the repository: ${destination}`,
    );
    return;
  }
  if (!existsSync(target)) {
    failures.push(`${capability} evidence does not exist: ${destination}`);
    return;
  }
  const lineRange = fragment.match(/^L(\d+)(?:-L(\d+))?$/);
  if (!lineRange) {
    failures.push(`${capability} evidence needs a line anchor: ${destination}`);
    return;
  }
  const start = Number(lineRange[1]);
  const end = Number(lineRange[2] ?? lineRange[1]);
  const lineCount = readFileSync(target, "utf8").split("\n").length;
  if (start < 1 || end < start || end > lineCount) {
    failures.push(
      `${capability} has an invalid evidence range: ${destination}`,
    );
  }
}

function validateIntegration(paths) {
  const readmeEntry = readFile(paths.readme)
    .split("\n")
    .slice(0, 35)
    .join("\n");
  if (!readmeEntry.includes("Blop Browser has no hosted free or paid tier.")) {
    failures.push(
      "README must disclose that no hosted free or paid tier exists before the quickstart.",
    );
  }
  if (
    !readmeEntry.includes(
      "[capability availability](docs/capability-availability.md)",
    )
  ) {
    failures.push(
      "README must link capability availability before the quickstart.",
    );
  }

  const skillEntry = readFile(paths.skill).split("\n").slice(0, 40).join("\n");
  if (!skillEntry.includes("Blop Browser has no hosted free or paid tier.")) {
    failures.push(
      "The installed skill must disclose that no hosted free or paid tier exists near its introduction.",
    );
  }
  if (!skillEntry.includes("/docs/capability-availability.md")) {
    failures.push(
      "The installed skill must link capability availability near its introduction.",
    );
  }

  let manifest;
  try {
    manifest = JSON.parse(readFile(paths.package));
  } catch {
    failures.push("Package availability surface is not valid JSON.");
    manifest = {};
  }
  const description = String(manifest.description ?? "");
  if (!description.startsWith("Local browser tools")) {
    failures.push("Package description must identify the package as local.");
  }
  if (!description.includes("no hosted service")) {
    failures.push(
      "Package description must disclose that no hosted service is included.",
    );
  }
  if (
    manifest.scripts?.["check:availability"] !==
    "node scripts/check-capability-availability.mjs"
  ) {
    failures.push("package.json must expose check:availability.");
  }

  const claims = readFile(paths.claims);
  if (!claims.includes("| `AVAILABILITY`")) {
    failures.push("Public claims must register AVAILABILITY.");
  }
  if (
    !claims.includes(
      "Every material promise below is available only in the local open-source package.",
    )
  ) {
    failures.push(
      "Public claims must identify every material promise as local-only.",
    );
  }
  if (
    !claims.includes("[capability availability](capability-availability.md)")
  ) {
    failures.push(
      "Public claims must link the capability availability contract.",
    );
  }

  const limitations = readFile(paths.limitations);
  const normalizedLimitations = limitations.replace(/\s+/g, " ");
  if (!limitations.includes("## Availability and hosting")) {
    failures.push(
      "Known limitations must include the availability and hosting boundary.",
    );
  }
  if (
    !limitations.includes(
      "[capability availability](capability-availability.md)",
    )
  ) {
    failures.push("Known limitations must link capability availability.");
  }
  if (
    !normalizedLimitations.includes(
      "reports `cleanup_timeout` and preserves the relevant managed paths instead of claiming deletion",
    )
  ) {
    failures.push(
      "Known limitations must disclose cleanup-timeout preservation.",
    );
  }

  if (!readFile(paths.workflow).includes("bun run check:availability")) {
    failures.push("CI must run: bun run check:availability");
  }
}
