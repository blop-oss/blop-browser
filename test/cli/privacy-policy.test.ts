import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const maintainedPolicy = join(repositoryRoot, "PRIVACY.md");
let temporaryDirectory: string | undefined;

afterEach(async () => {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  temporaryDirectory = undefined;
});

describe("privacy data-flow policy", () => {
  test("accepts the maintained policy, onboarding links, and reviewed source sinks", async () => {
    const result = await runChecker();

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Checked privacy data-flow declarations");
    expect(result.stdout).toContain("does not capture packets or prove deletion");
    expect(result.stderr).toBe("");
  });

  test("rejects removal of the local and attached-browser distinction", async () => {
    const policy = await mutatedPolicy((source) =>
      source.replace("## Local managed sessions", "## Browser sessions")
    );
    const result = await runChecker("--policy", policy);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Local managed sessions");
  });

  test("rejects a missing first-party telemetry boundary", async () => {
    const policy = await mutatedPolicy((source) =>
      source.replace(
        "First-party harness telemetry is off",
        "Telemetry depends on your setup",
      )
    );
    const result = await runChecker("--policy", policy);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("first-party harness telemetry is off");
  });

  test("rejects an unreviewed network-bearing source sink", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "privacy-source-check-"));
    const runtime = join(temporaryDirectory, "runtime.ts");
    await writeFile(
      runtime,
      `${await readFile(join(repositoryRoot, "src/cli/runtime.ts"), "utf8")}\nfetch("https://collector.invalid");\n`,
    );
    const result = await runChecker("--runtime-source", runtime);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("unreviewed network-bearing signature");
  });

  test("bounds proof startup failures without echoing unexpected input", async () => {
    const secret = `https://user:password@example.invalid/private?token=${"x".repeat(16_384)}`;
    const process = Bun.spawn([
      "node",
      "scripts/demo-privacy-data-flows.mjs",
      secret,
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

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(Buffer.byteLength(stderr)).toBeLessThanOrEqual(2_048);
    expect(stderr).toContain("Privacy lifecycle proof failed");
    expect(stderr).not.toContain("password");
    expect(stderr).not.toContain("token=");
  });
});

async function mutatedPolicy(mutate: (source: string) => string) {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "privacy-policy-check-"));
  const destination = join(temporaryDirectory, "PRIVACY.md");
  await writeFile(destination, mutate(await readFile(maintainedPolicy, "utf8")));
  return destination;
}

async function runChecker(...args: string[]) {
  const process = Bun.spawn([
    "node",
    "scripts/check-privacy-data-flows.mjs",
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
