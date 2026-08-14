#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runSessionMetricsProtocol,
  writeSessionMetricsReport,
} from "./core.mjs";

const benchmarkDirectory = fileURLToPath(new URL(".", import.meta.url));
const parsed = parseArguments(process.argv.slice(2));

if (parsed.help) {
  process.stdout.write(`Blop Browser local session metrics protocol

Usage:
  node benchmarks/session-metrics/run.mjs [--output PATH]

The runner always uses the built dist/cli.js, a fresh temporary runtime root,
and its internal 127.0.0.1 fixture. It has no live-URL or repetition override.
`);
  process.exit(0);
}

const outputPath = resolve(
  parsed.output ??
    `${benchmarkDirectory}/.results/local-session-metrics-${new Date()
      .toISOString()
      .replaceAll(/[:.]/g, "-")}.json`,
);
const report = await runSessionMetricsProtocol();
const writtenPath = await writeSessionMetricsReport(report, outputPath);

process.stdout.write(
  `${JSON.stringify(
    {
      output: writtenPath,
      protocol_sha256: report.source.protocol_sha256,
      cli_build_sha256: report.source.cli_build_sha256,
      requested_repetitions: report.summary.requested_repetitions,
      completed_pairs: report.summary.completed_pairs,
      failed_pairs: report.summary.failed_pairs,
      cold_start_ms: report.summary.cold_start_ms,
      warm_resume_ms: report.summary.warm_resume_ms,
      limitations: report.limitations,
    },
    null,
    2,
  )}\n`,
);

if (report.summary.failed_pairs > 0) process.exitCode = 1;

function parseArguments(args) {
  let output;
  let help = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }
    if (argument === "--output") {
      output = args[++index];
      if (!output) throw new Error("--output requires a path.");
      continue;
    }
    throw new Error(`Unknown option ${JSON.stringify(argument)}.`);
  }
  return { output, help };
}
