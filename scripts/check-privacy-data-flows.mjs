#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const options = parseArgs(process.argv.slice(2));
const failures = [];

const policy = source(options.policy);
const normalizedPolicy = normalize(policy);
const manifest = JSON.parse(source(options.package));

if (!manifest.files?.includes("PRIVACY.md")) {
  failures.push(
    "package.json: must include PRIVACY.md in the published package",
  );
}

const policyRequirements = [
  ["## Local managed sessions", "must document Local managed sessions"],
  [
    "## Attached and remote browser sessions",
    "must document attached and remote browser sessions separately",
  ],
  [
    "First-party harness telemetry is off",
    "must state first-party harness telemetry is off",
  ],
  [
    "Cookies are not included as a public tool result",
    "must explain cookie transmission boundaries",
  ],
  [
    "Raw caller commands, typed text, and upload paths",
    "must disclose unredacted caller data over IPC and in action callbacks",
  ],
  [
    "before the separate trace recorder redacts",
    "must distinguish live action input from persisted trace redaction",
  ],
  [
    "complete CDP endpoint through the child process environment",
    "must disclose the attached-daemon secret transport boundary",
  ],
  [
    "Host and model-provider flows",
    "must explain host and model-provider transmission",
  ],
  [
    "The host owns the browser-access UI, operator notification, identity checks",
    "must assign takeover UI, notification, identity, and coordination-data ownership",
  ],
  [
    "it does not record the person's keystrokes or direct browser actions",
    "must distinguish ownership traces from direct human browser activity",
  ],
  ["blop-browser data list --json", "must document retained-data listing"],
  ["blop-browser data delete SESSION", "must document retained-data deletion"],
  [
    "Filesystem removal is not verified secure erasure",
    "must bound deletion claims",
  ],
  [
    "does not capture packets or prove deletion",
    "must state the checker evidence boundary",
  ],
  [
    "It is a review index, not a complete runtime network observation",
    "must introduce the reviewed ledger boundary",
  ],
  [
    "probeInternetEgress: true",
    "must disclose the opt-in public container diagnostic",
  ],
];
for (const [required, message] of policyRequirements) {
  if (!normalizedPolicy.includes(normalize(required)))
    failures.push(`PRIVACY.md: ${message}`);
}

const requiredFlows = [
  "LOCAL_IPC",
  "TARGET_NETWORK",
  "CDP_TRANSPORT",
  "HOST_OUTPUT",
  "HUMAN_CONTROL",
  "LOCAL_RECORDING",
  "SCREENCAST_CALLBACK",
  "CONTAINER_TRANSPORT",
  "CAMOUFOX_INSTALL",
  "BENCHMARK_SERVICES",
  "SESSION_RETENTION",
];
const ledger = delimitedSection(
  policy,
  "<!-- privacy-data-flows:start -->",
  "<!-- privacy-data-flows:end -->",
);
for (const flow of requiredFlows) {
  if (!ledger.includes(`\`${flow}\``))
    failures.push(`PRIVACY.md: missing reviewed flow ${flow}`);
}

for (const file of options.onboarding) {
  const linked =
    /\[[^\]]*(?:privacy|data.flow)[^\]]*\]\([^)]*PRIVACY\.md[^)]*\)/i.test(
      source(file),
    );
  if (!linked)
    failures.push(
      `${relative(repositoryRoot, file)}: must link to PRIVACY.md with descriptive text`,
    );
}
const skill = source(options.skill);
if (
  !skill.includes(
    "https://github.com/blop-oss/blop-browser/blob/master/PRIVACY.md",
  )
) {
  failures.push(
    "skills/browser-harness/SKILL.md: must use the canonical privacy URL after standalone install",
  );
}
if (/\]\(\.\.\/\.\.\/PRIVACY\.md\)/.test(skill)) {
  failures.push(
    "skills/browser-harness/SKILL.md: must not use a repository-relative privacy link",
  );
}

validateReviewedSourceSinks(options);

if (failures.length > 0) {
  process.stderr.write(
    `Privacy data-flow check failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`,
  );
  process.stderr.write(
    "This declaration check does not capture packets or prove deletion.\n",
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Checked privacy data-flow declarations across ${requiredFlows.length} reviewed flows; this check does not capture packets or prove deletion.\n`,
  );
}

function validateReviewedSourceSinks(paths) {
  const overrides = new Map([["src/cli/runtime.ts", paths.runtimeSource]]);
  const TypeScriptFiles = collectFiles(resolve(repositoryRoot, "src"), ".ts");
  const sources = new Map(
    TypeScriptFiles.map((file) => {
      const relativePath = relative(repositoryRoot, file);
      return [relativePath, source(overrides.get(relativePath) ?? file)];
    }),
  );
  const signatures = [
    {
      label: "node:net",
      pattern: /["']node:net["']/g,
      allowed: new Set(["src/cli/ipc.ts"]),
    },
    {
      label: "connectOverCDP",
      pattern: /\bconnectOverCDP\s*\(/g,
      allowed: new Set(["src/cli/runtime.ts"]),
    },
    {
      label: "chromium.connect",
      pattern: /\bchromium\.connect\s*\(/g,
      allowed: new Set([
        "src/session/playwright-container.ts",
        "src/session/bun-ws-compat.ts",
      ]),
    },
    {
      label: "firefox.connect",
      pattern: /\bfirefox\.connect\s*\(/g,
      allowed: new Set(["src/session/camoufox-container.ts"]),
    },
    {
      label: "page.goto",
      pattern: /\b(?:context\.)?page\.goto\s*\(/g,
      allowed: new Set(["src/tools/navigation.ts"]),
    },
    { label: "fetch", pattern: /\bfetch\s*\(/g, allowed: new Set() },
    {
      label: "Bun WebSocket",
      pattern: /\bnew BunWs\s*\(/g,
      allowed: new Set(["src/session/bun-ws-compat.ts"]),
    },
    {
      label: "public egress endpoint",
      pattern: /https:\/\/1\.1\.1\.1(?::443)?\//g,
      allowed: new Set([
        "src/session/playwright-container.ts",
        "src/session/camoufox-container.ts",
      ]),
    },
  ];
  for (const [file, fileSource] of sources) {
    for (const signature of signatures) {
      signature.pattern.lastIndex = 0;
      if (signature.pattern.test(fileSource) && !signature.allowed.has(file)) {
        failures.push(
          `${file}: unreviewed network-bearing signature ${signature.label}`,
        );
      }
    }
  }
  const exactEvidence = [
    ["src/cli/ipc.ts", 'server.listen(0, "127.0.0.1"'],
    ["src/cli.ts", 'spawn(nodeExecutable, [cliPath, "fetch"]'],
    ["src/session/playwright-container.ts", "internetEgressProbe.enabled"],
    ["src/session/camoufox-container.ts", "internetEgressProbe.enabled"],
    ["src/session/bun-ws-compat.ts", "new BunWs(url"],
    ["src/session/control.ts", "createBrowserControlSession"],
    ["src/cli/data-store.ts", "MAX_LISTED_RUNTIME_ENTRIES"],
  ];
  for (const [file, text] of exactEvidence) {
    if (!sources.get(file)?.includes(text))
      failures.push(`${file}: missing reviewed source-sink evidence ${text}`);
  }
}

function parseArgs(args) {
  const paths = {
    policy: resolve(repositoryRoot, "PRIVACY.md"),
    package: resolve(repositoryRoot, "package.json"),
    skill: resolve(repositoryRoot, "skills/browser-harness/SKILL.md"),
    runtimeSource: resolve(repositoryRoot, "src/cli/runtime.ts"),
  };
  const onboarding = [
    "README.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "skills/browser-harness/SKILL.md",
    "docs/action-traces.md",
    "docs/session-metrics.md",
    "docs/known-limitations.md",
    "docs/demo-recording.md",
    "docs/launch-checklist.md",
    "benchmarks/README.md",
    "benchmarks/mind2web/README.md",
  ].map((file) => resolve(repositoryRoot, file));
  const names = new Map([
    ["--policy", "policy"],
    ["--package", "package"],
    ["--skill", "skill"],
    ["--runtime-source", "runtimeSource"],
  ]);
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const name = names.get(option);
    if (!name) throw new Error(`Unknown argument: ${option}`);
    if (!args[index + 1]) throw new Error(`${option} requires a path.`);
    paths[name] = resolve(args[index + 1]);
  }
  return { ...paths, onboarding };
}

function collectFiles(directory, extension) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(path, extension);
    return entry.isFile() && entry.name.endsWith(extension) ? [path] : [];
  });
}

function delimitedSection(value, startMarker, endMarker) {
  const start = value.indexOf(startMarker);
  const end = value.indexOf(endMarker);
  if (start < 0 || end <= start) {
    failures.push(`PRIVACY.md: missing ${startMarker} / ${endMarker}`);
    return "";
  }
  return value.slice(start + startMarker.length, end);
}

function normalize(value) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function source(path) {
  if (!existsSync(path)) {
    failures.push(`${path}: file does not exist`);
    return "";
  }
  return readFileSync(path, "utf8");
}
