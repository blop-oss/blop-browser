#!/usr/bin/env node
import { createServer } from "node:http";
import { chromium } from "playwright";
import { startScreencast } from "../dist/index.js";

const cdpEndpoint =
  process.env.BLOP_DEMO_CDP_ENDPOINT ?? "http://127.0.0.1:9222";
const pageUrlFragment = process.env.BLOP_DEMO_PAGE_URL_CONTAINS ?? "";
const port = parsePort(process.env.BLOP_DEMO_DASHBOARD_PORT ?? "4173");

const browser = await chromium.connectOverCDP(cdpEndpoint);
const pages = browser.contexts().flatMap((context) => context.pages());
const page = pageUrlFragment
  ? pages.findLast((candidate) => candidate.url().includes(pageUrlFragment))
  : pages.at(-1);

if (!page) {
  throw new Error(
    pageUrlFragment
      ? `No Chrome tab URL contains ${JSON.stringify(pageUrlFragment)}.`
      : "The connected Chrome instance has no open page.",
  );
}

let latestFrame = null;
const screencast = await startScreencast({
  page,
  quality: 70,
  maxWidth: 1440,
  maxHeight: 900,
  onFrame(frame) {
    latestFrame = frame.data;
  },
});

if (!screencast) {
  throw new Error(
    "The selected page does not support the Chromium screencast API.",
  );
}

const server = createServer((request, response) => {
  if (request.url?.startsWith("/frame.jpg")) {
    if (!latestFrame) {
      response.writeHead(503, { "cache-control": "no-store" });
      response.end("Waiting for the first frame.");
      return;
    }
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "image/jpeg",
    });
    response.end(latestFrame);
    return;
  }

  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": "text/html; charset=utf-8",
  });
  response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Blop Browser screencast</title>
    <style>
      :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; }
      body { margin: 0; background: #0b0d12; color: #f4f6fa; }
      header { display: flex; align-items: baseline; gap: 1rem; padding: 1rem 1.25rem; }
      h1 { margin: 0; font-size: 1rem; }
      p { margin: 0; color: #9aa4b2; font-size: .85rem; }
      main { padding: 0 1.25rem 1.25rem; }
      img { display: block; width: 100%; max-height: calc(100vh - 5rem); object-fit: contain; background: #151922; border: 1px solid #2a3140; border-radius: .5rem; }
    </style>
  </head>
  <body>
    <header><h1>Blop Browser screencast</h1><p>${escapeHtml(page.url())}</p></header>
    <main><img id="frame" alt="Live browser viewport" /></main>
    <script>
      const frame = document.querySelector("#frame");
      const refresh = () => {
        const next = new Image();
        next.onload = () => { frame.src = next.src; setTimeout(refresh, 120); };
        next.onerror = () => setTimeout(refresh, 250);
        next.src = "/frame.jpg?t=" + Date.now();
      };
      refresh();
    </script>
  </body>
</html>`);
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(
    `Screencasting ${page.url()} at http://127.0.0.1:${port}\n` +
      "Press Ctrl+C to stop. Frames remain in memory and are not written to disk.\n",
  );
});

let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await screencast.stop();
  server.close(() => process.exit(0));
};

process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());

function parsePort(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(
      "BLOP_DEMO_DASHBOARD_PORT must be an integer from 1 to 65535.",
    );
  }
  return parsed;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
