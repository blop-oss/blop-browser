#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const failures = [];
const manifest = JSON.parse(rawSource("package.json"));
const privateReportUrl =
  "https://github.com/blop-oss/blop-browser/security/advisories/new";

if (!manifest.files?.includes("SECURITY.md")) {
  failures.push("package.json: must include SECURITY.md in the npm package");
}

requireMatch(
  "SECURITY.md",
  new RegExp("`" + escapeRegex(manifest.version) + "`[^|]*[|] Supported"),
  `must identify package version ${manifest.version} as supported`,
);
requireMatch(
  "SECURITY.md",
  /earlier \| Not supported/i,
  "must identify older releases as unsupported",
);
requireMatch(
  "SECURITY.md",
  /Unreleased `master` \| Best effort/i,
  "must state the support level for unreleased master",
);

const policyRequirements = [
  [
    /private vulnerability report[^)]*security\/advisories\/new/i,
    "must link the private vulnerability-reporting form",
  ],
  [/Sign in to a GitHub account/i, "must state the GitHub sign-in requirement"],
  [/\[Security\]/, "must identify vulnerability reports with [Security]"],
  [/\[Abuse\]/, "must distinguish abuse reports with [Abuse]"],
  [/public support question/i, "must identify the public support channel"],
  [/public bug report/i, "must identify the public bug channel"],
  [
    /security triage maintainer/i,
    "must explicitly name the security triage maintainer role",
  ],
  [
    /first repository administrator to acknowledge[^.]*becomes[^.]*security triage maintainer/i,
    "must assign per-report triage ownership",
  ],
  [
    /CODEOWNERS[^.]*not a substitute/i,
    "must not confuse code review ownership with private advisory access",
  ],
  [/5 business days/i, "must state the acknowledgement target"],
  [/10 business days/i, "must state the initial-triage target"],
  [/14 calendar days/i, "must state the ongoing-update target"],
  [
    /not guaranteed service-level agreements/i,
    "must describe response windows as targets rather than SLAs",
  ],
  [/Coordinated disclosure/i, "must document coordinated disclosure"],
  [
    /gh api repos\/blop-oss\/blop-browser\/private-vulnerability-reporting --jq \.enabled/i,
    "must document the read-only GitHub configuration check",
  ],
  [
    /does not submit a report, test notification delivery, or prove/i,
    "must state what the configuration check does not test",
  ],
  [
    /Do not create a fabricated vulnerability report/i,
    "must forbid fake reports as routing tests",
  ],
];

for (const [pattern, message] of policyRequirements) {
  requireMatch("SECURITY.md", pattern, message);
}

requireLiteral(
  "SECURITY.md",
  privateReportUrl,
  "must use the canonical private-reporting URL",
);
rejectMatch(
  "SECURITY.md",
  /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i,
  "must not publish an unverified security email",
);

requireMatch(
  ".github/ISSUE_TEMPLATE/config.yml",
  /blank_issues_enabled: false/i,
  "must keep unstructured public issues disabled",
);
requireMatch(
  ".github/ISSUE_TEMPLATE/config.yml",
  /name: Security report[\s\S]*security\/advisories\/new[\s\S]*\[Security\] title prefix/i,
  "must route [Security] reports to the private advisory form",
);
requireMatch(
  ".github/ISSUE_TEMPLATE/config.yml",
  /name: Abuse report[\s\S]*security\/advisories\/new[\s\S]*\[Abuse\] title prefix/i,
  "must retain the private [Abuse] route",
);
rejectMatch(
  ".github/ISSUE_TEMPLATE/config.yml",
  /blop-browser\/discussions/i,
  "must not route support to disabled GitHub Discussions",
);

requireMatch(
  ".github/ISSUE_TEMPLATE/support-question.yml",
  /name: Support question[\s\S]*Support questions are public/i,
  "must provide a clearly public support form",
);
requireMatch(
  ".github/ISSUE_TEMPLATE/support-question.yml",
  /product vulnerabilities through SECURITY\.md[\s\S]*suspected misuse[\s\S]*ACCEPTABLE_USE\.md/i,
  "must redirect sensitive reports away from public support",
);
requireMatch(
  ".github/ISSUE_TEMPLATE/bug-report.yml",
  /Report security problems through SECURITY\.md instead/i,
  "must redirect vulnerabilities away from the public bug form",
);

const issueTemplateDirectory = resolve(
  repositoryRoot,
  ".github/ISSUE_TEMPLATE",
);
for (const filename of readdirSync(issueTemplateDirectory)) {
  if (filename === "config.yml" || !/\.ya?ml$/i.test(filename)) continue;
  rejectRawMatch(
    `.github/ISSUE_TEMPLATE/${filename}`,
    /name:\s*[^\n]*(?:security|vulnerability)/i,
    "must not expose a public vulnerability issue form",
  );
}

requireMatch(
  "ACCEPTABLE_USE.md",
  /product vulnerability[\s\S]*?\[Security\][\s\S]*?security policy[\s\S]*?not as abuse/i,
  "must separate product vulnerabilities from abuse reports",
);
requireMatch(
  "CONTRIBUTING.md",
  /\[Security policy\]\(SECURITY\.md\)[\s\S]*check:security-policy/i,
  "must link the policy and document its deterministic check",
);
requireMatch(
  "README.md",
  /\[Security policy\]\(SECURITY\.md\)/i,
  "must link the security policy from public onboarding",
);
requireMatch(
  "CODE_OF_CONDUCT.md",
  /does not publish a verified private conduct email[\s\S]*\[Security\][\s\S]*\[Abuse\]/i,
  "must not claim an unverified contact and must separate sensitive channels",
);

if (failures.length > 0) {
  process.stderr.write(
    `Security-policy documentation check failed:\n${failures
      .map((failure) => `- ${failure}`)
      .join("\n")}\n`,
  );
  process.stderr.write(
    "This static check does not query GitHub or submit a vulnerability report.\n",
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    "Checked the static security policy, reporting routes, and triage contract.\n",
  );
  process.stdout.write(
    "This check does not query GitHub or submit a vulnerability report.\n",
  );
}

function rawSource(file) {
  return readFileSync(resolve(repositoryRoot, file), "utf8");
}

function source(file) {
  return rawSource(file).replace(/\s+/g, " ");
}

function requireLiteral(file, value, message) {
  if (!rawSource(file).includes(value)) failures.push(`${file}: ${message}`);
}

function requireMatch(file, pattern, message) {
  if (!pattern.test(source(file))) failures.push(`${file}: ${message}`);
}

function rejectMatch(file, pattern, message) {
  if (pattern.test(source(file))) failures.push(`${file}: ${message}`);
}

function rejectRawMatch(file, pattern, message) {
  if (pattern.test(rawSource(file))) failures.push(`${file}: ${message}`);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
