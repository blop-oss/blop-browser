import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const maintainedDocument = join(repositoryRoot, "docs", "positioning-proof.md");
let temporaryDirectory: string | undefined;

afterEach(async () => {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  temporaryDirectory = undefined;
});

describe("positioning proof documentation", () => {
  test("accepts the maintained evidence ledger and integration", async () => {
    const result = await runChecker(maintainedDocument);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Checked positioning proof");
    expect(result.stderr).toBe("");
  });

  test("rejects a differentiator without direct evidence", async () => {
    const document = await mutatedDocument((source) =>
      source.replace(
        /^(\| Bounded semantic observations\s+\| ).+?( \| The caller chooses)/m,
        "$1Unlinked claim$2",
      )
    );
    const result = await runChecker(document);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("must link to implementation or reproducible proof");
  });

  test("rejects missing Playwright-direct guidance", async () => {
    const document = await mutatedDocument((source) =>
      source.replace("## Choose Playwright directly when", "## General alternatives")
    );
    const result = await runChecker(document);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Choose Playwright directly when");
  });

  test("rejects universal or unsupported performance positioning", async () => {
    const document = await mutatedDocument((source) =>
      `${source}\nBlop Browser is always faster than Playwright.\n`
    );
    const result = await runChecker(document);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("unsupported superiority or performance claim");
  });

  test("rejects removal of the proof boundary", async () => {
    const document = await mutatedDocument((source) =>
      source.replace(
        "This is an architectural contract proof, not task-success, security, or performance evidence.",
        "This proves the architecture.",
      )
    );
    const result = await runChecker(document);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("architectural contract proof boundary");
  });

  test("rejects removal of the bounded harness trace contract", async () => {
    const document = await mutatedDocument((source) =>
      source.replace(
        "bounded ordered harness action trace",
        "standalone action count",
      )
    );
    const result = await runChecker(document);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("bounded harness trace contract");
  });
});

async function mutatedDocument(mutate: (source: string) => string) {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "positioning-proof-check-"));
  const destination = join(temporaryDirectory, "positioning-proof.md");
  const source = await readFile(maintainedDocument, "utf8");
  await writeFile(destination, mutate(source));
  return destination;
}

async function runChecker(document: string) {
  const process = Bun.spawn([
    "node",
    "scripts/check-positioning-proof.mjs",
    "--document",
    document,
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
