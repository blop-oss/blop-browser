import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const maintainedDocument = join(
  repositoryRoot,
  "docs",
  "capability-availability.md",
);
let temporaryDirectory: string | undefined;

afterEach(async () => {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  temporaryDirectory = undefined;
});

describe("capability availability", () => {
  test("accepts the maintained local and hosted availability contract", async () => {
    const result = await runChecker();

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Checked capability availability");
    expect(result.stderr).toBe("");
  });

  test("provisions Chromium in the fresh local workflow", async () => {
    const source = await readFile(maintainedDocument, "utf8");

    expect(source).toContain("npx playwright install chromium");
  });

  test("rejects a fresh local workflow without browser provisioning", async () => {
    const document = await mutatedDocument((source) =>
      source.replace(
        "npx playwright install chromium",
        "# browser provisioning omitted",
      ),
    );
    const result = await runChecker("--document", document);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "npx playwright install chromium",
    );
  });

  test("rejects a local workflow that omits session metrics inspection", async () => {
    const document = await mutatedDocument((source) =>
      source.replace(
        "blop-browser --session local-review metrics --json",
        "# session metrics omitted",
      ),
    );
    const result = await runChecker("--document", document);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "blop-browser --session local-review metrics --json",
    );
  });

  test("rejects wording that turns the separate QA plans into browser hosting", async () => {
    const document = await mutatedDocument((source) =>
      source.replace(
        "It does not identify these as Blop Browser hosting plans or define a numeric test-artifact retention window.",
        "These plans include hosted Blop Browser sessions.",
      ),
    );
    const result = await runChecker("--document", document);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Separate Blop QA pricing must preserve the product boundary",
    );
  });

  test("rejects stale separate-product plan and trial facts", async () => {
    const document = await mutatedDocument((source) =>
      source.replace(
        "a Free band at €0 and “Free forever”; paid Starter, Team, and Scale bands at €199, €599, and €1,499 per month, each with a 14-day trial; and Enterprise with custom pricing",
        "paid Base and Plus plans at $8 and $12 per month, each with a 7-day trial",
      ),
    );
    const result = await runChecker("--document", document);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Separate Blop QA pricing must preserve the current plan facts",
    );
  });

  test("rejects stale separate-product cancellation wording", async () => {
    const document = await mutatedDocument((source) =>
      source.replace(
        "a workspace moves to the Free band after the paid period and “Nothing is deleted.”",
        "data is retained for 30 days after the paid period",
      ),
    );
    const result = await runChecker("--document", document);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Separate Blop QA pricing must preserve the current cancellation finding",
    );
  });

  test("requires implementation or test evidence for a local capability", async () => {
    const document = await mutatedDocument((source) =>
      replaceTableCell(
        source,
        "Runtime and hosting",
        1,
        "See [general limitations](known-limitations.md#L1-L5).",
      ),
    );
    const result = await runChecker("--document", document);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Runtime and hosting must cite implementation or test evidence",
    );
  });

  test("rejects invented or unknown hosted availability", async () => {
    const document = await mutatedDocument((source) =>
      replaceTableCell(
        replaceTableCell(
          source,
          "Parallel sessions",
          2,
          "Free tier includes two hosted sessions.",
        ),
        "Parallel sessions",
        3,
        "Unknown.",
      ),
    );
    const result = await runChecker("--document", document);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Parallel sessions must mark Hosted free");
    expect(result.stderr).toContain("Parallel sessions must mark Hosted paid");
  });

  test("rejects a hosted pricing link used as local capability evidence", async () => {
    const document = await mutatedDocument((source) =>
      replaceTableCell(
        source,
        "Billing and accounts",
        1,
        "Included with the [Blop QA paid plan](https://blopai.com/pricing).",
      ),
    );
    const result = await runChecker("--document", document);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Billing and accounts uses non-local evidence",
    );
  });

  test("rejects a disposable-retention claim that hides the daemon log", async () => {
    const document = await mutatedDocument((source) =>
      source.replace(
        "Disposable close or idle shutdown removes the managed profile, downloads, and artifact directories, but the per-session daemon log remains in the runtime directory until `destroy`.",
        "Disposable state is fully removed on close.",
      ),
    );
    const result = await runChecker("--document", document);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "per-session daemon log remains in the runtime directory until `destroy`",
    );
  });

  test("requires every advertised capability category", async () => {
    const document = await mutatedDocument((source) =>
      removeTableRow(source, "Proxy service"),
    );
    const result = await runChecker("--document", document);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Missing capability: Proxy service");
  });

  test("requires availability for the advertised session metrics", async () => {
    const document = await mutatedDocument((source) =>
      removeTableRow(source, "Session metrics"),
    );
    const result = await runChecker("--document", document);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Missing capability: Session metrics");
  });

  test("rejects an unofficial or undated source snapshot", async () => {
    const document = await mutatedDocument((source) =>
      replaceTableCell(
        replaceTableCell(
          source,
          "[Separate Blop QA privacy page](https://blopai.com/privacy)",
          3,
          "Current",
        ),
        "[Separate Blop QA privacy page](https://blopai.com/privacy)",
        0,
        "[Separate Blop QA privacy page](https://example.com/privacy)",
      ),
    );
    const result = await runChecker("--document", document);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Separate Blop QA privacy page must link its reviewed first-party source",
    );
    expect(result.stderr).toContain(
      "Separate Blop QA privacy page must record an unambiguous review date",
    );
  });

  test("rejects invented browser retention derived from the QA privacy page", async () => {
    const document = await mutatedDocument((source) =>
      source.replace(
        "The page labels itself placeholder copy, says “Last updated: Not yet published,” and gives no numeric test-artifact retention period.",
        "Hosted Blop Browser sessions retain artifacts for 30 days.",
      ),
    );
    const result = await runChecker("--document", document);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Separate Blop QA privacy page must preserve its unpublished retention finding",
    );
  });

  test("does not let the privacy disclaimer hide an invented browser tier", async () => {
    const document = await mutatedDocument((source) =>
      source.replace(
        "and gives no numeric test-artifact retention period.",
        "and gives no numeric test-artifact retention period, but paid Blop Browser hosting retains profiles for 30 days.",
      ),
    );
    const result = await runChecker("--document", document);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Availability document invents a Blop Browser hosted entitlement",
    );
  });

  test("rejects a README that hides the no-hosted-tier boundary", async () => {
    const readme = await mutatedSurface("README.md", (source) =>
      source.replace(
        "Blop Browser has no hosted free or paid tier.",
        "Hosted Blop Browser plans are available separately.",
      ),
    );
    const result = await runChecker("--readme", readme);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "README must disclose that no hosted free or paid tier exists",
    );
  });

  test("rejects an installed skill that suggests a hosted browser tier", async () => {
    const skill = await mutatedSurface(
      "skills/browser-harness/SKILL.md",
      (source) =>
        source.replace(
          "Blop Browser has no hosted free or paid tier.",
          "Choose a free or paid hosted Blop Browser tier.",
        ),
    );
    const result = await runChecker("--skill", skill);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "installed skill must disclose that no hosted free or paid tier exists",
    );
  });

  test("requires local and no-hosted-service package metadata", async () => {
    const manifest = await mutatedSurface("package.json", (source) =>
      source.replace(
        "Local browser tools and session infrastructure for agent hosts; no hosted service and no model or agent loop.",
        "Browser platform for agent hosts.",
      ),
    );
    const result = await runChecker("--package", manifest);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Package description must identify the package as local",
    );
    expect(result.stderr).toContain(
      "Package description must disclose that no hosted service is included",
    );
  });

  test("requires the availability promise in the public claims ledger", async () => {
    const claims = await mutatedSurface("docs/public-claims.md", (source) =>
      source.replace("| `AVAILABILITY`", "| `REMOVED_AVAILABILITY`"),
    );
    const result = await runChecker("--claims", claims);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Public claims must register AVAILABILITY");
  });

  test("requires every material promise to identify local-only availability", async () => {
    const claims = await mutatedSurface("docs/public-claims.md", (source) =>
      source.replace(
        "Every material promise below is available only in the local open-source package.",
        "Availability varies by deployment.",
      ),
    );
    const result = await runChecker("--claims", claims);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Public claims must identify every material promise as local-only",
    );
  });

  test("requires the hosted boundary in known limitations", async () => {
    const limitations = await mutatedSurface(
      "docs/known-limitations.md",
      (source) =>
        source.replace(
          "## Availability and hosting",
          "## Deployment options",
        ),
    );
    const result = await runChecker("--limitations", limitations);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Known limitations must include the availability and hosting boundary",
    );
  });

  test("requires availability enforcement in CI", async () => {
    const workflow = await mutatedSurface(
      ".github/workflows/ci.yml",
      (source) =>
        source.replace(
          "run: bun run check:availability",
          "run: echo availability-check-omitted",
        ),
    );
    const result = await runChecker("--workflow", workflow);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("CI must run: bun run check:availability");
  });

  test("rejects a drifted local evidence line range", async () => {
    const document = await mutatedDocument((source) =>
      source.replace(
        "../src/session/scope.ts#L33-L67",
        "../src/session/scope.ts#L33-L9999",
      ),
    );
    const result = await runChecker("--document", document);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Profile persistence has an invalid evidence range",
    );
  });

  test("requires the unpublished terms boundary for the separate QA service", async () => {
    const document = await mutatedDocument((source) =>
      source.replace(
        "The page labels itself placeholder copy, says “Last updated: Not yet published,” and describes subscriptions without creating a Blop Browser hosting entitlement.",
        "The page grants a paid hosted Blop Browser tier.",
      ),
    );
    const result = await runChecker("--document", document);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Separate Blop QA terms page must preserve its unpublished product boundary",
    );
  });
});

async function mutatedDocument(mutate: (source: string) => string) {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "availability-check-"));
  const destination = join(temporaryDirectory, "capability-availability.md");
  const source = await readFile(maintainedDocument, "utf8");
  const mutated = mutate(source);
  if (mutated === source) throw new Error("Document mutation changed nothing.");
  await writeFile(destination, mutated);
  return destination;
}

async function mutatedSurface(
  relativePath: string,
  mutate: (source: string) => string,
) {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "availability-surface-"));
  const destination = join(
    temporaryDirectory,
    relativePath.replaceAll("/", "-"),
  );
  const source = await readFile(join(repositoryRoot, relativePath), "utf8");
  const mutated = mutate(source);
  if (mutated === source) {
    throw new Error(`Surface mutation changed nothing: ${relativePath}`);
  }
  await writeFile(destination, mutated);
  return destination;
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

async function runChecker(...args: string[]) {
  const process = Bun.spawn(
    ["node", "scripts/check-capability-availability.mjs", ...args],
    {
      cwd: repositoryRoot,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { stdout, stderr, exitCode };
}
