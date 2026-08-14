import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const maintainedDocument = join(repositoryRoot, "docs", "public-claims.md");
let temporaryDirectory: string | undefined;

afterEach(async () => {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  temporaryDirectory = undefined;
});

describe("public claims evidence", () => {
  test("accepts the maintained claims inventory and ledger", async () => {
    const result = await runChecker();

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Checked public claims");
    expect(result.stderr).toBe("");
  });

  test("rejects an unsupported universal promise in the claim ledger", async () => {
    const document = await mutatedDocument((source) =>
      source.replace(
        "The managed CLI launches Chromium by default and can launch optional Firefox-based Camoufox after its separate installation.",
        "Blop Browser completes any browser task and is always faster than Playwright.",
      ),
    );
    const result = await runChecker("--document", document);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("unsupported universal or superiority claim");
  });

  test("scans non-promise copy in the public claims ledger", async () => {
    const document = await mutatedDocument((source) =>
      source.replace(
        "The API is Chromium/CDP-specific and repaint-driven.",
        "This is the fastest browser and is always better than Playwright.",
      ),
    );
    const result = await runChecker("--document", document);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Public claims ledger contains unsupported public claim",
    );
  });

  test("publishes the host-agent boundary and limitations at each entry point", async () => {
    const [readme, skill, limitations, manifestSource] = await Promise.all([
      readFile(join(repositoryRoot, "README.md"), "utf8"),
      readFile(join(repositoryRoot, "skills", "browser-harness", "SKILL.md"), "utf8"),
      readFile(join(repositoryRoot, "docs", "known-limitations.md"), "utf8"),
      readFile(join(repositoryRoot, "package.json"), "utf8"),
    ]);
    const manifest = JSON.parse(manifestSource) as { description?: string };

    expect(readme.split("\n").slice(0, 25).join("\n")).toContain(
      "browser infrastructure, not a complete browser agent",
    );
    expect(readme.split("\n").slice(0, 25).join("\n")).toContain(
      "[known limitations](docs/known-limitations.md)",
    );
    expect(skill.split("\n").slice(0, 30).join("\n")).toContain(
      "browser infrastructure, not a complete browser agent",
    );
    expect(skill.split("\n").slice(0, 30).join("\n")).toContain(
      "/docs/known-limitations.md",
    );
    expect(limitations).toContain("no model, planner, or autonomous agent loop");
    expect(manifest.description).toContain("no model or agent loop");
  });

  test("rejects unsupported marketing added to the actual README surface", async () => {
    const readme = await mutatedSurface("README.md", (source) =>
      source.replace(
        "**Browser infrastructure for coding agents.**",
        "Blop Browser completes any browser task and is always faster than Playwright.",
      ),
    );
    const result = await runChecker("--readme", readme);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("README contains unsupported public claim");
  });

  test("rejects quoted marketing on the actual README surface", async () => {
    const readme = await mutatedSurface("README.md", (source) =>
      source.replace(
        "**Browser infrastructure for coding agents.**",
        "**The “undetectable” browser for coding agents.**",
      ),
    );
    const result = await runChecker("--readme", readme);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("README contains unsupported public claim");
  });

  test("does not let an unrelated earlier negation hide a banned claim", async () => {
    const readme = await mutatedSurface("README.md", (source) =>
      source.replace(
        "**Browser infrastructure for coding agents.**",
        "Blop Browser does not merely integrate with agents, it is the fastest browser.",
      ),
    );
    const result = await runChecker("--readme", readme);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("README contains unsupported public claim");
  });

  test("does not let an earlier disclaimer hide a later banned claim", async () => {
    const readme = await mutatedSurface("README.md", (source) =>
      source.replace(
        "**Browser infrastructure for coding agents.**",
        "The unsupported phrase is old wording, but Blop Browser is the fastest browser.",
      ),
    );
    const result = await runChecker("--readme", readme);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("README contains unsupported public claim");
  });

  test("rejects unsupported marketing inside a shipped TypeScript string", async () => {
    const cli = await mutatedSurface("src/cli.ts", (source) =>
      source.replace(
        "Select a named managed browser session",
        "Select the \"undetectable\" and always better browser session",
      ),
    );
    const result = await runChecker("--cli-source", cli);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("CLI help contains unsupported public claim");
  });

  test("rejects an entry point that hides the limitations document", async () => {
    const readme = await mutatedSurface("README.md", (source) =>
      source.replace(
        "[known limitations](docs/known-limitations.md)",
        "known limitations",
      ),
    );
    const result = await runChecker("--readme", readme);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("README must link known limitations before the quickstart");
  });

  test("requires the Chromium and new-page domain-policy limitations", async () => {
    const limitations = await mutatedSurface(
      "docs/known-limitations.md",
      (source) =>
        source
          .replace(
            "top-level HTTP and HTTPS documents in Chromium",
            "browser destinations",
          )
          .replace(
            "rejects every new page or popup document",
            "checks new pages",
          ),
    );
    const result = await runChecker("--limitations", limitations);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Known limitations are missing required boundary: top-level HTTP and HTTPS documents in Chromium",
    );
    expect(result.stderr).toContain(
      "Known limitations are missing required boundary: rejects every new page or popup document",
    );
  });

  test("rejects an unregistered claim in the public-surface inventory", async () => {
    const document = await mutatedDocument((source) =>
      replaceTableCell(source, "GitHub repository details", 2, "`MAGIC`"),
    );
    const result = await runChecker("--document", document);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("references unregistered claim: MAGIC");
  });

  test("rejects a material promise without direct evidence", async () => {
    const document = await mutatedDocument((source) =>
      replaceTableCell(source, "`SCREENCAST`", 3, "No direct evidence"),
    );
    const result = await runChecker("--document", document);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("SCREENCAST must link direct evidence");
  });

  test("requires the bounded local backend signal evidence contract", async () => {
    const source = await readFile(maintainedDocument, "utf8");

    expect(source).toContain("| `BACKEND_SIGNAL_EVIDENCE`");

    const document = await mutatedDocument((current) =>
      removeTableRow(current, "`BACKEND_SIGNAL_EVIDENCE`"),
    );
    const result = await runChecker("--document", document);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Missing material promise: BACKEND_SIGNAL_EVIDENCE",
    );
  });

  test("scans the shipped backend signal guide as a public claim surface", async () => {
    const guide = await mutatedSurface(
      "benchmarks/detection/README.md",
      (source) =>
        source.replace(
          "This protocol records reproducible, bounded evidence",
          "This undetectable browser is always better than Playwright and records evidence",
        ),
    );
    const result = await runChecker("--detection-guide", guide);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Backend signal guide contains unsupported public claim",
    );
  });

  test("rejects a direct evidence link whose line range drifted", async () => {
    const document = await mutatedDocument((source) =>
      source.replace(
        "../src/screencast.ts#L25-L113",
        "../src/screencast.ts#L25-L9999",
      ),
    );
    const result = await runChecker("--document", document);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("SCREENCAST has an invalid evidence range");
  });

  test("allows explicit negation, issue quotations, and historical critique", async () => {
    const readme = await mutatedSurface("README.md", (source) =>
      `${source}\nThe phrase “undetectable” is an unsupported issue quotation.\n\n“Fastest browser” is a historical phrase, not evidence.\n\nThe package does not claim or guarantee anonymity.\n`,
    );
    const result = await runChecker("--readme", readme);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });
});

async function mutatedDocument(mutate: (source: string) => string) {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "public-claims-check-"));
  const destination = join(temporaryDirectory, "public-claims.md");
  const source = await readFile(maintainedDocument, "utf8");
  const mutated = mutate(source);
  if (mutated === source) throw new Error("Document mutation changed nothing.");
  await writeFile(destination, mutated);
  return destination;
}

async function mutatedSurface(relativePath: string, mutate: (source: string) => string) {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "public-claims-surface-"));
  const destination = join(temporaryDirectory, relativePath.replaceAll("/", "-"));
  const source = await readFile(join(repositoryRoot, relativePath), "utf8");
  const mutated = mutate(source);
  if (mutated === source) throw new Error(`Surface mutation changed nothing: ${relativePath}`);
  await writeFile(destination, mutated);
  return destination;
}

async function runChecker(...args: string[]) {
  const process = Bun.spawn([
    "node",
    "scripts/check-public-claims.mjs",
    ...args,
  ], {
    cwd: repositoryRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function replaceTableCell(
  source: string,
  rowKey: string,
  cellIndex: number,
  replacement: string,
) {
  let replaced = false;
  const result = source
    .split("\n")
    .map((line) => {
      if (!line.trimStart().startsWith("|") || !line.includes(rowKey)) {
        return line;
      }
      const cells = line.trim().slice(1, -1).split("|");
      if (cells[0]?.trim() !== rowKey) return line;
      if (cellIndex < 0 || cellIndex >= cells.length) {
        throw new Error(`Missing table cell ${cellIndex} for ${rowKey}`);
      }
      cells[cellIndex] = ` ${replacement} `;
      replaced = true;
      return `|${cells.join("|")}|`;
    })
    .join("\n");
  if (!replaced) throw new Error(`Missing table row: ${rowKey}`);
  return result;
}

function removeTableRow(source: string, rowKey: string) {
  let removed = false;
  const result = source
    .split("\n")
    .filter((line) => {
      if (!line.trimStart().startsWith("|") || !line.includes(rowKey)) {
        return true;
      }
      const firstCell = line.trim().slice(1, -1).split("|")[0]?.trim();
      if (firstCell !== rowKey) return true;
      removed = true;
      return false;
    })
    .join("\n");
  if (!removed) throw new Error(`Missing table row: ${rowKey}`);
  return result;
}
