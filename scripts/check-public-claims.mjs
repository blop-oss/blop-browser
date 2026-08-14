#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const options = parseArgs(process.argv.slice(2));
const documentPath = options.document;
const source = readFile(documentPath);
const failures = [];

const requiredSurfaces = [
  "README and npm landing page",
  "Package metadata",
  "GitHub repository details",
  "GitHub releases and release workflow",
  "Installable agent skill",
  "CLI help, tool schemas, and exported API comments",
  "Positioning and comparison docs",
  "Operational and policy docs",
  "Examples and demo material",
  "Launch and community files",
  "Benchmark docs and historical experiment log",
];
const requiredClaims = [
  "BOUNDARY",
  "TOOL_CONTRACT",
  "SESSION_REUSE",
  "SESSION_SCOPE",
  "CHROME_ATTACHMENT",
  "BROWSER_MODES",
  "INTERFACES",
  "ACTION_TRACE",
  "SESSION_METRICS",
  "SAFETY_CONTROLS",
  "CONTAINER_SERVICES",
  "SCREENCAST",
  "BACKEND_SIGNAL_EVIDENCE",
  "BENCHMARK_EVIDENCE",
  "DISTRIBUTION",
];

const surfaceRows = parseTable(
  delimitedSection(
    source,
    "<!-- claim-surfaces:start -->",
    "<!-- claim-surfaces:end -->",
  ),
);
validateHeader(
  surfaceRows,
  ["Surface", "Reviewed public copy", "Claim IDs", "Disposition"],
  "surface inventory",
);
const inventoriedSurfaces = surfaceRows.slice(1);
const inventoriedClaimIds = new Set();
const seenSurfaces = new Set();
for (const surface of requiredSurfaces) {
  if (!inventoriedSurfaces.some((row) => row[0] === surface)) {
    failures.push(`Missing public claim surface: ${surface}`);
  }
}
for (const row of inventoriedSurfaces) {
  const [surface, publicCopy, claimIds, disposition] = row;
  if (!surface || !publicCopy || !claimIds || !disposition) {
    failures.push(`Malformed public claim surface row: ${row.join(" | ")}`);
    continue;
  }
  if (seenSurfaces.has(surface))
    failures.push(`Duplicate public claim surface: ${surface}`);
  seenSurfaces.add(surface);
  const ids = [...claimIds.matchAll(/`([A-Z][A-Z0-9_]*)`/g)].map(
    (match) => match[1],
  );
  if (ids.length === 0)
    failures.push(`${surface} must map to at least one registered claim.`);
  for (const claimId of ids) {
    inventoriedClaimIds.add(claimId);
    if (!requiredClaims.includes(claimId)) {
      failures.push(`${surface} references unregistered claim: ${claimId}`);
    }
  }
}

const claimRows = parseTable(
  delimitedSection(
    source,
    "<!-- public-claims:start -->",
    "<!-- public-claims:end -->",
  ),
);
validateHeader(
  claimRows,
  [
    "Claim ID",
    "Testable promise",
    "Public surfaces",
    "Direct evidence",
    "Boundary",
  ],
  "material promise ledger",
);
const claims = claimRows.slice(1);
const seenClaimIds = new Set();
for (const row of claims) {
  const [rawId, promise, publicSurfaces, evidence, boundary] = row;
  const claimId = rawId?.replaceAll("`", "");
  if (!claimId || !promise || !publicSurfaces || !evidence || !boundary) {
    failures.push(`Malformed material promise row: ${row.join(" | ")}`);
    continue;
  }
  if (seenClaimIds.has(claimId))
    failures.push(`Duplicate material promise: ${claimId}`);
  seenClaimIds.add(claimId);
  if (!requiredClaims.includes(claimId))
    failures.push(`Unregistered material promise: ${claimId}`);
  validateClaimLanguage(promise, claimId);

  const publicLinks = markdownLinks(publicSurfaces);
  if (publicLinks.length === 0)
    failures.push(`${claimId} must identify a public surface.`);
  for (const destination of publicLinks)
    validateLocalLink(destination, claimId, false);

  const evidenceLinks = markdownLinks(evidence);
  if (evidenceLinks.length === 0)
    failures.push(`${claimId} must link direct evidence.`);
  if (!evidenceLinks.some(isDirectEvidence)) {
    failures.push(
      `${claimId} must cite implementation, test, or demo evidence.`,
    );
  }
  for (const destination of evidenceLinks)
    validateLocalLink(destination, claimId, true);
}
for (const claimId of requiredClaims) {
  if (!seenClaimIds.has(claimId))
    failures.push(`Missing material promise: ${claimId}`);
  if (!inventoriedClaimIds.has(claimId))
    failures.push(`No public surface maps to: ${claimId}`);
}

validatePublicClaimSurfaces(options);

if (failures.length > 0) {
  process.stderr.write(
    `Public claims check failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Checked public claims across ${inventoriedSurfaces.length} surfaces and ${claims.length} material promises.\n`,
  );
}

function parseArgs(args) {
  const paths = {
    document: resolve(repositoryRoot, "docs", "public-claims.md"),
    readme: resolve(repositoryRoot, "README.md"),
    skill: resolve(repositoryRoot, "skills", "browser-harness", "SKILL.md"),
    package: resolve(repositoryRoot, "package.json"),
    limitations: resolve(repositoryRoot, "docs", "known-limitations.md"),
    cli: resolve(repositoryRoot, "src", "cli.ts"),
    screencast: resolve(repositoryRoot, "src", "screencast.ts"),
    detectionGuide: resolve(
      repositoryRoot,
      "benchmarks",
      "detection",
      "README.md",
    ),
    detectionResults: resolve(
      repositoryRoot,
      "benchmarks",
      "detection",
      "RESULTS.md",
    ),
    sessionMetricsGuide: resolve(
      repositoryRoot,
      "benchmarks",
      "session-metrics",
      "README.md",
    ),
    sessionMetricsResults: resolve(
      repositoryRoot,
      "benchmarks",
      "session-metrics",
      "RESULTS.md",
    ),
  };
  const names = new Map([
    ["--document", "document"],
    ["--readme", "readme"],
    ["--skill", "skill"],
    ["--package", "package"],
    ["--limitations", "limitations"],
    ["--cli-source", "cli"],
    ["--screencast-source", "screencast"],
    ["--detection-guide", "detectionGuide"],
    ["--detection-results", "detectionResults"],
    ["--session-metrics-guide", "sessionMetricsGuide"],
    ["--session-metrics-results", "sessionMetricsResults"],
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
    process.stderr.write(`Public claims check failed: ${message}\n`);
    process.exit(1);
  }
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

function markdownLinks(markdown) {
  return [...markdown.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)].map(
    (match) => match[1],
  );
}

function isDirectEvidence(destination) {
  return (
    /^(?:\.\.\/)+(?:src|test|scripts|benchmarks)\//.test(destination) ||
    /^(?:\.\.\/)+(?:package\.json|\.github\/workflows\/)/.test(destination)
  );
}

function validateClaimLanguage(promise, claimId) {
  for (const pattern of unsupportedClaimPatterns()) {
    if (pattern.test(promise)) {
      failures.push(
        `${claimId} contains an unsupported universal or superiority claim: ${pattern}`,
      );
    }
  }
}

function validatePublicClaimSurfaces(paths) {
  const manifestSource = readFile(paths.package);
  let manifest;
  try {
    manifest = JSON.parse(manifestSource);
  } catch {
    failures.push("Package claim surface is not valid JSON.");
    manifest = {};
  }
  const cliSource = readFile(paths.cli);
  const cliHelp = cliSource.match(/const HELP = `([\s\S]*?)`;\n/)?.[1];
  if (!cliHelp)
    failures.push(
      "CLI claim surface does not contain the installed HELP text.",
    );

  const surfaces = [
    ["Public claims ledger", withoutFencedCode(source)],
    ["README", withoutFencedCode(readFile(paths.readme))],
    [
      "Package metadata",
      [
        manifest.description,
        ...(Array.isArray(manifest.keywords) ? manifest.keywords : []),
      ]
        .filter((value) => typeof value === "string")
        .join("\n"),
    ],
    ["Installed skill", withoutFencedCode(readFile(paths.skill))],
    ["CLI help", cliHelp ?? ""],
    [
      "Public screencast API documentation",
      publicTypeScriptCopy(readFile(paths.screencast)),
    ],
    ["Backend signal guide", withoutFencedCode(readFile(paths.detectionGuide))],
    [
      "Published backend signal result",
      withoutFencedCode(readFile(paths.detectionResults)),
    ],
    [
      "Session metrics protocol guide",
      withoutFencedCode(readFile(paths.sessionMetricsGuide)),
    ],
    [
      "Published session metrics result",
      withoutFencedCode(readFile(paths.sessionMetricsResults)),
    ],
  ];
  const publicMarkdownPaths = [
    "ACCEPTABLE_USE.md",
    "CODE_OF_CONDUCT.md",
    "CONTRIBUTING.md",
    "ROADMAP.md",
    "SECURITY.md",
    "docs/action-traces.md",
    "docs/assets/demo/README.md",
    "docs/browser-tool-comparison.md",
    "docs/demo-recording.md",
    "docs/good-first-issues.md",
    "docs/known-limitations.md",
    "docs/launch-checklist.md",
    "docs/positioning-proof.md",
    "docs/session-metrics.md",
    "benchmarks/README.md",
    "benchmarks/mind2web/README.md",
    "benchmarks/mind2web/PROGRESS.md",
    ".github/PULL_REQUEST_TEMPLATE.md",
  ];
  for (const relativePath of publicMarkdownPaths) {
    surfaces.push([
      `Public claim surface (${relativePath})`,
      withoutFencedCode(readFile(resolve(repositoryRoot, relativePath))),
    ]);
  }
  const publicYamlPaths = [
    ".github/ISSUE_TEMPLATE/bug-report.yml",
    ".github/ISSUE_TEMPLATE/config.yml",
    ".github/ISSUE_TEMPLATE/feature-request.yml",
    ".github/ISSUE_TEMPLATE/support-question.yml",
    ".github/workflows/release.yml",
  ];
  for (const relativePath of publicYamlPaths) {
    surfaces.push([
      `Public claim surface (${relativePath})`,
      readFile(resolve(repositoryRoot, relativePath)),
    ]);
  }
  const publicApiPaths = [
    "src/index.ts",
    "src/types.ts",
    "src/create-tools.ts",
    "src/session-metrics.ts",
    "src/trace-recorder.ts",
    "src/session/scope.ts",
    "src/session/playwright-container.ts",
    "src/session/camoufox-container.ts",
    "src/tools/types.ts",
    ...readdirSync(resolve(repositoryRoot, "src", "tools"))
      .filter((name) => name.endsWith(".ts") && name !== "types.ts")
      .map((name) => `src/tools/${name}`),
  ];
  for (const relativePath of publicApiPaths) {
    surfaces.push([
      `Shipped API copy (${relativePath})`,
      publicTypeScriptCopy(readFile(resolve(repositoryRoot, relativePath))),
    ]);
  }
  for (const [label, content] of surfaces) {
    for (const block of claimBlocks(content)) {
      for (const pattern of unsupportedClaimPatterns(true)) {
        for (const match of block.matchAll(pattern)) {
          if (isSafeContext(block, match.index ?? 0)) continue;
          failures.push(
            `${label} contains unsupported public claim: ${match[0]}`,
          );
        }
      }
    }
  }
  validateRepositoryIntegration(paths, manifest);
}

function validateRepositoryIntegration(paths, manifest) {
  const readme = readFile(paths.readme);
  const readmeEntry = readme.split("\n").slice(0, 25).join("\n");
  if (
    !readmeEntry.includes(
      "browser infrastructure, not a complete browser agent",
    )
  ) {
    failures.push(
      "README must state the infrastructure-versus-agent boundary before the quickstart.",
    );
  }
  if (!readmeEntry.includes("[known limitations](docs/known-limitations.md)")) {
    failures.push("README must link known limitations before the quickstart.");
  }
  if (!readme.includes("[public claims and evidence](docs/public-claims.md)")) {
    failures.push("README must link the public claims ledger.");
  }

  const skillEntry = readFile(paths.skill).split("\n").slice(0, 30).join("\n");
  if (
    !skillEntry.includes("browser infrastructure, not a complete browser agent")
  ) {
    failures.push(
      "The installed skill must state the infrastructure-versus-agent boundary near its introduction.",
    );
  }
  if (!skillEntry.includes("/docs/known-limitations.md")) {
    failures.push(
      "The installed skill must link known limitations near its introduction.",
    );
  }

  if (!String(manifest.description ?? "").includes("no model or agent loop")) {
    failures.push(
      "The package description must disclose that no model or agent loop is included.",
    );
  }
  if (
    manifest.scripts?.["check:claims"] !==
    "node scripts/check-public-claims.mjs"
  ) {
    failures.push("package.json must expose check:claims.");
  }
  const workflow = readFile(
    resolve(repositoryRoot, ".github", "workflows", "ci.yml"),
  );
  if (!workflow.includes("bun run check:claims"))
    failures.push("CI must run: bun run check:claims");

  const limitations = readFile(paths.limitations);
  const normalizedLimitations = limitations.replace(/\s+/g, " ");
  for (const required of [
    "# Known limitations",
    "no model, planner, or autonomous agent loop",
    "not operating-system,",
    "not native Playwright tracing",
    "loopback-only backend signal protocol",
    "Provider token counts remain",
    "sum of active recorder segments",
    "loopback-only session metrics protocol",
    "assign `allow`, `deny`, or `ask`",
    "top-level HTTP and HTTPS documents in Chromium",
    "rejects every new page or popup document",
    "do not filter iframes",
    "standalone CLI exposes only read-only mode",
    "does not claim universal correctness, reliability, speed",
    "[positioning proof](positioning-proof.md)",
  ]) {
    if (!normalizedLimitations.includes(required.replace(/\s+/g, " "))) {
      failures.push(
        `Known limitations are missing required boundary: ${required}`,
      );
    }
  }
}

function unsupportedClaimPatterns(global = false) {
  const flags = global ? "gi" : "i";
  return [
    new RegExp("\\bcompletes? (?:any|every) browser task\\b", flags),
    new RegExp(
      "\\b(?:always|universally) (?:faster|better|safer|more secure|works?|succeeds?|completes?)\\b",
      flags,
    ),
    new RegExp(
      "\\b(?:world(?:'s|’s) (?:best|fastest|safest|most secure)|best (?:(?:browser|tool|product|interface|automation)\\b|for (?:all|any|every)\\b)|fastest|safest|most secure|undetectable|unbeatable|superior)\\b",
      flags,
    ),
    new RegExp(
      "\\bnever (?:use|need) (?:a |the |your )?browser again\\b",
      flags,
    ),
    new RegExp(
      "\\b(?:guarantees?|ensures?) (?:task success|security|safety|performance|anonymity|undetectability)\\b",
      flags,
    ),
    new RegExp(
      "\\b(?:can|will|lets? you|helps? you) (?:bypass|evade|avoid) (?:a |the )?(?:captcha|rate limit|bot protection|bot detection|site control|access control)\\b",
      flags,
    ),
    new RegExp(
      "\\bworks? (?:on|with) (?:any|every|all) (?:site|website|browser)\\b",
      flags,
    ),
    new RegExp(
      "\\b(?:faster|safer|more reliable|more secure) than (?:playwright|other|every|any)\\b",
      flags,
    ),
    new RegExp("\\bessentially for free\\b", flags),
  ];
}

function withoutFencedCode(markdown) {
  return markdown.replace(/```[\s\S]*?```/g, "");
}

function publicTypeScriptCopy(source) {
  const blocks = [...source.matchAll(/\/\*\*[\s\S]*?\*\//g)].map(
    (match) => match[0],
  );
  const descriptions = [
    ...source.matchAll(
      /\bdescription\s*:\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/gs,
    ),
  ].map((match) => match[0]);
  return [...blocks, ...descriptions].join("\n\n");
}

function claimBlocks(content) {
  return content
    .split(/\n\s*\n/)
    .map((block) => block.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function isSafeContext(block, matchIndex) {
  const before = block.slice(0, matchIndex);
  const after = block.slice(matchIndex);
  const sentenceStart = Math.max(
    before.lastIndexOf("."),
    before.lastIndexOf("!"),
    before.lastIndexOf("?"),
    before.lastIndexOf(";"),
  );
  const suffixBoundary = after.search(/[.!?;]/);
  const prefix = before.slice(sentenceStart + 1).toLowerCase();
  const suffix = after
    .slice(0, suffixBoundary < 0 ? undefined : suffixBoundary + 1)
    .toLowerCase();
  const attributionPrefix = prefix.replace(
    /^.*\b(?:but|however|yet|although|though)\b/,
    "",
  );
  const directlyNegated =
    /\b(?:does not|doesn't|do not|don't|cannot|can't|never)\s*$/.test(prefix) ||
    /\b(?:does not|doesn't|do not|don't)\s+(?:claim|promise|guarantee|support)(?:\s+(?:or|nor)\s*)?$/.test(
      prefix,
    );
  return (
    directlyNegated ||
    /(?:does not|doesn't|do not|don't|cannot|can't|is not|isn't|no) (?:claim|promise|guarantee)|(?:reject|remove|avoid)(?:s|ed|ing)? (?:the )?(?:claim|phrase|promise)|unsupported (?:claim|phrase|promise)|historical(?:ly)? (?:claim|record|result)|not evidence/.test(
      attributionPrefix,
    ) ||
    /(?:is|are) (?:never |not )?(?:claimed|promised|guaranteed|supported)|(?:is|are) (?:an? )?(?:explicitly )?(?:unsupported|historical) (?:issue )?(?:quotation|example|phrase|claim)s?/.test(
      suffix,
    )
  );
}

function validateLocalLink(destination, claimId, requireAnchor) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(destination) || destination.startsWith("#")) {
    failures.push(`${claimId} uses non-local claim evidence: ${destination}`);
    return;
  }
  const [rawPath, fragment = ""] = destination.split("#", 2);
  // Mutation fixtures keep the canonical docs directory as their link base.
  const target = resolve(repositoryRoot, "docs", decodeURIComponent(rawPath));
  const relativeTarget = relative(repositoryRoot, target);
  if (
    relativeTarget.startsWith("..") ||
    resolve(repositoryRoot, relativeTarget) !== target
  ) {
    failures.push(`${claimId} evidence escapes the repository: ${destination}`);
    return;
  }
  if (!existsSync(target)) {
    failures.push(`${claimId} evidence does not exist: ${destination}`);
    return;
  }
  if (!fragment) {
    if (requireAnchor)
      failures.push(
        `${claimId} direct evidence needs a line anchor: ${destination}`,
      );
    return;
  }
  const lineRange = fragment.match(/^L(\d+)(?:-L(\d+))?$/);
  if (!lineRange) {
    failures.push(
      `${claimId} uses an unsupported evidence anchor: ${destination}`,
    );
    return;
  }
  const start = Number(lineRange[1]);
  const end = Number(lineRange[2] ?? lineRange[1]);
  const lineCount = readFileSync(target, "utf8").split("\n").length;
  if (start < 1 || end < start || end > lineCount) {
    failures.push(`${claimId} has an invalid evidence range: ${destination}`);
  }
}
