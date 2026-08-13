#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MATRIX_START = "<!-- comparison-matrix:start -->";
const MATRIX_END = "<!-- comparison-matrix:end -->";
const SOURCES_START = "<!-- comparison-sources:start -->";
const SOURCES_END = "<!-- comparison-sources:end -->";
const UNKNOWN = "Unknown / not tested";

const EXPECTED_PRODUCTS = [
  "Blop Browser",
  "Playwright CLI",
  "Playwright MCP",
  "agent-browser",
  "Browser Use CLI + Browser Harness",
];

const FIRST_PARTY_GITHUB_REPOSITORIES = new Set([
  "microsoft/playwright-cli",
  "microsoft/playwright-mcp",
  "vercel-labs/agent-browser",
  "browser-use/browser-use",
  "browser-use/browser-harness",
]);

const REQUIRED_CAPABILITIES = [
  "Primary interface",
  "Observation and action model",
  "State and profile default",
  "Parallel-session isolation",
  "Existing browser or profile reuse",
  "Browser engines and fingerprinting",
  "Embedding and extension surface",
  "Warm or remote execution",
  "Traces and recordings",
  "Permissions and safety boundary",
  "Session inspection and cleanup",
  "Local and cloud requirements",
  "Documented best fit",
];

const REQUIRED_UNKNOWNS = [
  ["Browser engines and fingerprinting", "Playwright CLI"],
  ["Browser engines and fingerprinting", "Playwright MCP"],
  ["Browser engines and fingerprinting", "agent-browser"],
  ["Browser engines and fingerprinting", "Browser Use CLI + Browser Harness"],
  ["Embedding and extension surface", "Playwright CLI"],
  ["Embedding and extension surface", "Playwright MCP"],
  ["Warm or remote execution", "Playwright CLI"],
  ["Traces and recordings", "Blop Browser"],
  ["Session inspection and cleanup", "Playwright MCP"],
  ["Session inspection and cleanup", "Browser Use CLI + Browser Harness"],
  ["Local and cloud requirements", "Blop Browser"],
  ["Local and cloud requirements", "Playwright CLI"],
];

const VAGUE_UNKNOWN =
  /\b(?:unclear|unknown|unverified|not documented|not tested)\b/i;
const MARKDOWN_LINK = /\[[^\]]+\]\(([^)\s]+)\)/g;
const PINNED_GITHUB_BLOB =
  /^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\/[0-9a-f]{40}\/.+#L\d+(?:-L\d+)?$/;
const LOCAL_LINE_LINK = /^\.\.\/.+#L\d+(?:-L\d+)?$/;

export function validateComparisonDocument(source, options = {}) {
  const failures = [];
  const matrix = section(
    source,
    MATRIX_START,
    MATRIX_END,
    "comparison matrix",
    failures,
  );
  const sourceTable = section(
    source,
    SOURCES_START,
    SOURCES_END,
    "source snapshot",
    failures,
  );

  if (matrix) validateMatrix(matrix, failures);
  if (sourceTable)
    validateSourceSnapshot(sourceTable, failures, options.blopVersion);
  if (options.documentPath) {
    failures.push(...validateLocalEvidenceLinks(source, options.documentPath));
  }

  return failures;
}

function validateMatrix(source, failures) {
  const rows = tableRows(source);
  if (rows.length < 3) {
    failures.push(
      "comparison matrix must contain a header and capability rows",
    );
    return;
  }

  const expectedHeader = ["Capability", ...EXPECTED_PRODUCTS];
  if (!sameArray(rows[0], expectedHeader)) {
    failures.push(
      `comparison matrix header must be: ${expectedHeader.join(" | ")}`,
    );
    return;
  }

  const capabilities = rows.slice(2).map((row) => row[0]);
  for (const capability of REQUIRED_CAPABILITIES) {
    if (!capabilities.includes(capability))
      failures.push(`missing capability row: ${capability}`);
  }

  const cellsByCapability = new Map(rows.slice(2).map((row) => [row[0], row]));
  for (const [capability, product] of REQUIRED_UNKNOWNS) {
    const row = cellsByCapability.get(capability);
    const column = EXPECTED_PRODUCTS.indexOf(product) + 1;
    if (row && !row[column]?.includes(UNKNOWN)) {
      failures.push(
        `${capability} / ${product}: required uncertainty marker "${UNKNOWN}" is missing`,
      );
    }
  }

  for (const row of rows.slice(2)) {
    if (row.length !== expectedHeader.length) {
      failures.push(
        `row "${row[0] ?? "<empty>"}" has ${row.length} cells; expected ${expectedHeader.length}`,
      );
      continue;
    }

    for (let column = 1; column < row.length; column += 1) {
      const cell = row[column];
      const location = `${row[0]} / ${EXPECTED_PRODUCTS[column - 1]}`;
      const links = [...cell.matchAll(MARKDOWN_LINK)].map((match) => match[1]);

      if (links.length === 0)
        failures.push(`${location}: missing direct evidence link`);
      if (VAGUE_UNKNOWN.test(cell) && !cell.includes(UNKNOWN)) {
        failures.push(
          `${location}: use the exact marker "${UNKNOWN}" for uncertainty`,
        );
      }

      for (const link of links) {
        validateEvidenceLink(link, location, failures);
      }
    }
  }
}

function validateSourceSnapshot(source, failures, blopVersion) {
  const rows = tableRows(source);
  const expectedHeader = [
    "Product",
    "Reviewed source",
    "Version or commit",
    "Reviewed on",
  ];
  if (rows.length < 3 || !sameArray(rows[0], expectedHeader)) {
    failures.push(
      `source snapshot header must be: ${expectedHeader.join(" | ")}`,
    );
    return;
  }

  const products = rows.slice(2).map((row) => row[0]);
  for (const product of EXPECTED_PRODUCTS) {
    if (!products.includes(product))
      failures.push(`source snapshot is missing: ${product}`);
  }

  for (const row of rows.slice(2)) {
    if (row.length !== expectedHeader.length) {
      failures.push(
        `source snapshot row "${row[0] ?? "<empty>"}" has ${row.length} cells; expected ${expectedHeader.length}`,
      );
      continue;
    }
    if (!/\[[^\]]+\]\([^)]+\)/.test(row[1]))
      failures.push(`${row[0]}: reviewed source must be linked`);
    for (const link of [...row[1].matchAll(MARKDOWN_LINK)].map(
      (match) => match[1],
    )) {
      validateEvidenceLink(link, `${row[0]} source snapshot`, failures);
    }
    if (
      !/\b(?:\d+\.\d+\.\d+|[0-9a-f]{40}|this document's commit)\b/.test(row[2])
    ) {
      failures.push(`${row[0]}: version or full commit is missing`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row[3]))
      failures.push(`${row[0]}: reviewed date must use YYYY-MM-DD`);
  }

  if (blopVersion) {
    const blopRow = rows.slice(2).find((row) => row[0] === "Blop Browser");
    if (blopRow && !blopRow[2].startsWith(`${blopVersion};`)) {
      failures.push(
        `Blop Browser: source snapshot version must match package.json (${blopVersion})`,
      );
    }
  }
}

export function validateLocalEvidenceLinks(source, documentPath) {
  const failures = [];
  const repositoryRoot = resolve(dirname(documentPath), "..");
  const links = [...source.matchAll(MARKDOWN_LINK)]
    .map((match) => match[1])
    .filter((link) => LOCAL_LINE_LINK.test(link));

  for (const link of new Set(links)) {
    const match = link.match(/^(\.\.\/.+)#L(\d+)(?:-L(\d+))?$/);
    if (!match) continue;
    const target = resolve(dirname(documentPath), match[1]);
    const targetRelative = relative(repositoryRoot, target);
    if (targetRelative.startsWith("..") || targetRelative === "") {
      failures.push(`local evidence escapes the repository: ${link}`);
      continue;
    }
    if (!existsSync(target)) {
      failures.push(`local evidence target does not exist: ${link}`);
      continue;
    }

    const lineCount = readFileSync(target, "utf8").split(/\r?\n/).length;
    const start = Number(match[2]);
    const end = Number(match[3] ?? match[2]);
    if (start < 1 || end < start || end > lineCount) {
      failures.push(
        `local evidence line range is invalid (${lineCount} lines): ${link}`,
      );
    }
  }

  return failures;
}

function validateEvidenceLink(link, location, failures) {
  if (link.startsWith("https://github.com/")) {
    const repository = link.match(
      /^https:\/\/github\.com\/([^/]+\/[^/]+)\//,
    )?.[1];
    if (!repository || !FIRST_PARTY_GITHUB_REPOSITORIES.has(repository)) {
      failures.push(
        `${location}: evidence is not from a reviewed first-party repository: ${link}`,
      );
    } else if (!PINNED_GITHUB_BLOB.test(link)) {
      failures.push(
        `${location}: GitHub evidence must use a 40-character commit and line anchor: ${link}`,
      );
    }
  } else if (link.startsWith("https://")) {
    failures.push(
      `${location}: external evidence must use a reviewed first-party GitHub repository: ${link}`,
    );
  } else if (!LOCAL_LINE_LINK.test(link)) {
    failures.push(
      `${location}: local evidence must be a parent-relative path with a line anchor: ${link}`,
    );
  }
}

function section(source, start, end, name, failures) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end);
  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    failures.push(`missing or invalid ${name} markers`);
    return "";
  }
  return source.slice(startIndex + start.length, endIndex);
}

function tableRows(source) {
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .map(splitMarkdownRow);
}

function splitMarkdownRow(line) {
  return line
    .slice(1, -1)
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replaceAll("\\|", "|"));
}

function sameArray(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function run() {
  const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const documentPath = resolve(
    repositoryRoot,
    process.argv[2] ?? "docs/browser-tool-comparison.md",
  );
  const packageManifest = JSON.parse(
    readFileSync(resolve(repositoryRoot, "package.json"), "utf8"),
  );
  const failures = validateComparisonDocument(
    readFileSync(documentPath, "utf8"),
    {
      blopVersion: packageManifest.version,
      documentPath,
    },
  );
  if (failures.length > 0) {
    process.stderr.write(
      `Invalid browser comparison evidence:\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`Checked comparison evidence in ${documentPath}.\n`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  run();
