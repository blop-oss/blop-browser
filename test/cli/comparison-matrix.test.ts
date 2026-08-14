import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validateComparisonDocument } from "../../scripts/check-comparison-matrix.mjs";

const documentUrl = new URL("../../docs/browser-tool-comparison.md", import.meta.url);
const packageUrl = new URL("../../package.json", import.meta.url);

async function comparisonFixture() {
  const [source, packageSource] = await Promise.all([
    readFile(documentUrl, "utf8"),
    readFile(packageUrl, "utf8"),
  ]);
  const version = JSON.parse(packageSource).version as string;
  return {
    source,
    version,
    options: {
      blopVersion: version,
      documentPath: fileURLToPath(documentUrl),
    },
  };
}

describe("browser-tool comparison evidence", () => {
  test("accepts the maintained comparison matrix", async () => {
    const { source, options } = await comparisonFixture();
    expect(validateComparisonDocument(source, options)).toEqual([]);
  });

  test("rejects a capability cell with no direct evidence", async () => {
    const { source, options } = await comparisonFixture();
    const broken = source.replace(
      /\[CLI designed for coding agents, with an installable skill\]\(https:\/\/github\.com\/microsoft\/playwright-cli\/blob\/[^)]+\)/,
      "CLI designed for coding agents, with an installable skill",
    );
    expect(validateComparisonDocument(broken, options)).toContain(
      "Primary interface / Playwright CLI: missing direct evidence link",
    );
  });

  test("rejects vague uncertainty instead of the explicit marker", async () => {
    const { source, options } = await comparisonFixture();
    const broken = source.replace(
      "Camoufox is Unknown / not tested in the reviewed docs",
      "Camoufox is not documented in the reviewed docs",
    );
    expect(validateComparisonDocument(broken, options)).toContainEqual(
      expect.stringContaining('use the exact marker "Unknown / not tested"'),
    );
  });

  test("keeps Blop's reviewed version aligned with package.json", async () => {
    const { source, version, options } = await comparisonFixture();
    const broken = source.replace(
      `${version}; this document's commit`,
      "9.9.9; this document's commit",
    );
    expect(validateComparisonDocument(broken, options)).toContain(
      `Blop Browser: source snapshot version must match package.json (${version})`,
    );
  });

  test("rejects an invalid parent-relative evidence line range", async () => {
    const { source, options } = await comparisonFixture();
    const broken = source.replace(
      "../README.md#L37-L48",
      "../README.md#L99999-L100000",
    );
    expect(validateComparisonDocument(broken, options)).toContainEqual(
      expect.stringContaining("local evidence line range is invalid"),
    );
  });
});
