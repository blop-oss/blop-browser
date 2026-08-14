#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(new URL("..", import.meta.url).pathname);
const failures = [];

const onboardingFiles = [
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "PRIVACY.md",
  "skills/browser-harness/SKILL.md",
  "docs/demo-recording.md",
  "docs/launch-checklist.md",
  "docs/assets/demo/README.md",
  "benchmarks/README.md",
  "benchmarks/mind2web/README.md",
];

const packageManifest = JSON.parse(source("package.json"));
if (!packageManifest.files?.includes("ACCEPTABLE_USE.md")) {
  failures.push(
    "package.json: must include ACCEPTABLE_USE.md in the published package",
  );
}

for (const file of onboardingFiles) {
  requireMatch(
    file,
    /\[[^\]]*acceptable[- ]use[^\]]*\]\([^)]*ACCEPTABLE_USE\.md\)/i,
    "must link to ACCEPTABLE_USE.md with descriptive text",
  );
}

requireMatch(
  "skills/browser-harness/SKILL.md",
  /\[acceptable-use policy\]\(https:\/\/github\.com\/blop-oss\/blop-browser\/blob\/master\/ACCEPTABLE_USE\.md\)/i,
  "must use the canonical policy URL because the skill is installed standalone",
);
rejectMatch(
  "skills/browser-harness/SKILL.md",
  /\]\(\.\.\/\.\.\/ACCEPTABLE_USE\.md\)/,
  "must not use a repository-relative policy link after standalone install",
);

const policyRequirements = [
  [
    /not legal advice/i,
    "must distinguish operational guidance from legal advice",
  ],
  [/website's terms/i, "must address website terms"],
  [/rate-limit|request rate/i, "must address rate limits"],
  [
    /personal, confidential, and authentication data/i,
    "must address sensitive data",
  ],
  [/employment, housing, credit, insurance/i, "must address sensitive domains"],
  [/prohibited uses/i, "must identify prohibited abuse"],
  [
    /private GitHub security advisory/i,
    "must provide a private project reporting process",
  ],
  [/\[Abuse\]/, "must identify abuse reports for triage"],
];

for (const [pattern, message] of policyRequirements) {
  requireMatch("ACCEPTABLE_USE.md", pattern, message);
}

const browserCaveats = {
  "README.md": [
    /CDP access doesn't grant permission/i,
    /doesn't grant permission[\s\S]*does not establish anonymity[\s\S]*avoidance of bot protections/i,
  ],
  "skills/browser-harness/SKILL.md": [
    /CDP access doesn't grant permission/i,
    /doesn't grant permission[\s\S]*does not establish anonymity[\s\S]*avoidance of bot protection/i,
  ],
  "SECURITY.md": [
    /CDP access isn't evidence[\s\S]*authorized/i,
    /fingerprint changes do not establish anonymity[\s\S]*must not be used to bypass/i,
  ],
};

for (const [file, patterns] of Object.entries(browserCaveats)) {
  for (const pattern of patterns) {
    requireMatch(
      file,
      pattern,
      "must retain CDP, Camoufox permission, and evidence-boundary caveats",
    );
  }
}

requireMatch(
  "docs/demo-recording.md",
  /BLOP_DEMO_URL="file:\/\/\$PWD\/docs\/assets\/demo\/authorized-fixture\.html"/,
  "must use the bundled local fixture",
);
requireMatch(
  "docs/demo-recording.md",
  /--attach-existing[\s\S]*CDP grants broad control/i,
  "must require explicit approval before attaching to the demo profile",
);
rejectMatch(
  "docs/demo-recording.md",
  /export BLOP_DEMO_URL="https?:|real authenticated test account|sign in manually/i,
  "must not direct launch recordings to live or authenticated targets",
);
requireMatch(
  "docs/launch-checklist.md",
  /authorized-fixture\.html[\s\S]*no[\s\S]*live website or authenticated account/i,
  "must gate launch media on the local fixture",
);
requireMatch(
  "docs/assets/demo/authorized-fixture.html",
  /Local fixture - authorized demo[\s\S]*Mark reviewed[\s\S]*Review complete/i,
  "must remain an explicit, non-consequential local workflow",
);
rejectMatch(
  "docs/assets/demo/authorized-fixture.html",
  /https?:|<form\b|password|checkout|purchase|sign[ -]?in/i,
  "must not depend on live targets, credentials, or consequential actions",
);
requireMatch(
  ".github/ISSUE_TEMPLATE/config.yml",
  /name: Abuse report[\s\S]*security\/advisories\/new[\s\S]*\[Abuse\] title prefix/i,
  "must expose the private abuse-reporting path in the issue chooser",
);

for (const file of ["README.md", "skills/browser-harness/SKILL.md"]) {
  requireMatch(
    file,
    /--attach-existing[\s\S]*(?:explicit approval|never infer permission)/i,
    "must retain the explicit existing-profile attachment gate",
  );
  requireMatch(
    file,
    /anti-bot mode is off by default/i,
    "must document optional anti-bot mode as off by default",
  );
  rejectMatch(
    file,
    /anti-detect browser|sites that reject automated Chromium|repeated bot checks is one reason|--session google|https:\/\/www\.google\.com|bypass (?:a )?(?:CAPTCHA|bot)|evade (?:a )?(?:CAPTCHA|rate limit)|lets? you avoid bot (?:detection|protections?)/i,
    "must not market browser modes as bot-control bypasses",
  );
}

if (failures.length > 0) {
  process.stderr.write(
    `Acceptable-use documentation check failed:\n${failures
      .map((failure) => `- ${failure}`)
      .join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Checked acceptable-use guidance and ${onboardingFiles.length} onboarding paths.\n`,
  );
}

function source(file) {
  return readFileSync(resolve(repositoryRoot, file), "utf8").replace(
    /\s+/g,
    " ",
  );
}

function requireMatch(file, pattern, message) {
  if (!pattern.test(source(file))) failures.push(`${file}: ${message}`);
}

function rejectMatch(file, pattern, message) {
  if (pattern.test(source(file))) failures.push(`${file}: ${message}`);
}
