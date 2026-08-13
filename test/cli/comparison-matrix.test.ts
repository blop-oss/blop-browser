import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { validateComparisonDocument } from "../../scripts/check-comparison-matrix.mjs";

const documentUrl = new URL("../../docs/browser-tool-comparison.md", import.meta.url);

describe("browser-tool comparison evidence", () => {
  test("accepts the maintained comparison matrix", async () => {
    const source = await readFile(documentUrl, "utf8");
    expect(validateComparisonDocument(source)).toEqual([]);
  });

  test("rejects a capability cell with no direct evidence", async () => {
    const source = await readFile(documentUrl, "utf8");
    const broken = source.replace(
      /\[CLI designed for coding agents, with an installable skill\]\(https:\/\/github\.com\/microsoft\/playwright-cli\/blob\/[^)]+\)/,
      "CLI designed for coding agents, with an installable skill",
    );
    expect(validateComparisonDocument(broken)).toContain(
      "Primary interface / Playwright CLI: missing direct evidence link",
    );
  });

  test("rejects vague uncertainty instead of the explicit marker", async () => {
    const source = await readFile(documentUrl, "utf8");
    const broken = source.replace(
      "Camoufox is Unknown / not tested in the reviewed docs",
      "Camoufox is not documented in the reviewed docs",
    );
    expect(validateComparisonDocument(broken)).toContainEqual(
      expect.stringContaining('use the exact marker "Unknown / not tested"'),
    );
  });
});
