#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runLocalSignalProtocol, writeSignalReport } from "./core.mjs";

const detectionDirectory = fileURLToPath(new URL(".", import.meta.url));
const parsed = parseArguments(process.argv.slice(2));

if (parsed.help) {
  process.stdout.write(`Blop Browser local backend signal protocol

Usage:
  node benchmarks/detection/run.mjs [--backend all|chromium-headless|camoufox-headless] [--output PATH]

The runner always loads its built-in 127.0.0.1 fixture and performs the three
repetitions pinned in protocol.json. It has no live-URL option.
`);
  process.exit(0);
}

const outputPath = resolve(
  parsed.output ??
    `${detectionDirectory}/.results/local-signals-${new Date()
      .toISOString()
      .replaceAll(/[:.]/g, "-")}.json`,
);
const backendIds = parsed.backend === "all" ? undefined : [parsed.backend];
const report = await runLocalSignalProtocol({ backendIds });
const writtenPath = await writeSignalReport(report, outputPath);

process.stdout.write(
  `${JSON.stringify(
    {
      output: writtenPath,
      protocol_sha256: report.source.protocol_sha256,
      selected_backends: report.protocol.selected_backends,
      requested: report.summary.requested,
      collected: report.summary.collected,
      failed: report.summary.failed,
      limitations: report.limitations,
    },
    null,
    2,
  )}\n`,
);

if (report.summary.failed > 0) process.exitCode = 1;

function parseArguments(args) {
  let backend = "all";
  let output;
  let help = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }
    if (argument === "--backend") {
      backend = args[++index];
      if (!backend) throw new Error("--backend requires a value.");
      continue;
    }
    if (argument === "--output") {
      output = args[++index];
      if (!output) throw new Error("--output requires a path.");
      continue;
    }
    throw new Error(`Unknown option ${JSON.stringify(argument)}.`);
  }
  if (!["all", "chromium-headless", "camoufox-headless"].includes(backend)) {
    throw new Error(
      "--backend must be all, chromium-headless, or camoufox-headless.",
    );
  }
  return { backend, output, help };
}
