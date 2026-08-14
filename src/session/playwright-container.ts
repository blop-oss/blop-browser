import "./bun-ws-compat.js";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { chromium, type Browser } from "playwright";
import {
  createContainerIdentityCache,
  resolveInternetEgressProbe,
  type InternetEgressProbeDisclosure,
} from "./egress.js";

const execFileAsync = promisify(execFile);

// One long-lived server container is shared by every run: `playwright
// run-server` accepts many concurrent websocket clients and launches an
// separate browser per connection, so "stopping" a session only disconnects
// the client and leaves the container warm for the next run.
const DEFAULT_CONTAINER_NAME = "blop-playwright";
const SERVER_PORT = 3000;
const STARTUP_TIMEOUT_MS = 180_000;
const READY_POLL_INTERVAL_MS = 500;

export type PlaywrightContainerOptions = {
  image?: string;
  containerName?: string;
  /** Explicitly contact the fixed public endpoint disclosed by `internetEgressProbe`. */
  probeInternetEgress?: boolean;
};

export type PlaywrightContainerSession = {
  browser: Browser;
  containerId: string;
  containerName: string;
  wsEndpoint: string;
  /**
   * The explicit public-endpoint diagnostic result. `null` means no request
   * was made. An opted-in boolean result is cached for the container lifetime.
   */
  hasInternetEgress: boolean | null;
  internetEgressProbe: InternetEgressProbeDisclosure;
  /**
   * Whether the browser was launched with web-security disabled so the agent
   * can exercise cross-origin flows (OAuth redirects, third-party iframes,
   * cross-origin fetch/XHR) without the sandbox's own origin tripping CORS.
   * Always true for the containerized runner today.
   */
  corsBypassed: boolean;
  /** Disconnects this session's browser. The container keeps running for reuse. */
  stop: () => Promise<void>;
};

async function docker(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("docker", args, { maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
}

function installedPlaywrightVersion(): string {
  const require = createRequire(import.meta.url);
  return require("playwright/package.json").version as string;
}

function resolveImage(options: PlaywrightContainerOptions): { image: string; serverVersion: string } {
  const explicit = options.image ?? process.env.BLOP_PLAYWRIGHT_IMAGE;
  // The run-server version must match the client's playwright version: the
  // connect protocol is not compatible across minor releases. When no image is
  // forced we derive the tag from the installed client so they stay in lockstep.
  const clientVersion = installedPlaywrightVersion();
  if (explicit) {
    const tagVersion = explicit.split(":")[1]?.replace(/^v/, "").split("-")[0];
    return { image: explicit, serverVersion: tagVersion || clientVersion };
  }
  return { image: `mcr.microsoft.com/playwright:v${clientVersion}-noble`, serverVersion: clientVersion };
}

type ContainerState = { id: string; running: boolean; image: string } | null;

async function inspectContainer(name: string): Promise<ContainerState> {
  try {
    const out = await docker(["inspect", "--format", "{{.Id}}\t{{.State.Running}}\t{{.Config.Image}}", name]);
    const [id, running, image] = out.split("\t");
    return { id, running: running === "true", image };
  } catch {
    return null;
  }
}

async function mappedHostPort(name: string): Promise<{ host: string; port: number }> {
  // e.g. "127.0.0.1:49153" (possibly one line per IP family; take the first IPv4).
  const out = await docker(["port", name, `${SERVER_PORT}/tcp`]);
  const line = out.split("\n").find((entry) => entry.includes("127.0.0.1")) ?? out.split("\n")[0];
  const port = Number(line.slice(line.lastIndexOf(":") + 1));
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Could not resolve the published port for container "${name}" (docker port said: ${out || "<empty>"}).`);
  }
  return { host: "127.0.0.1", port };
}

/**
 * Optional shared docker network for the sandbox. Set it on networked deploys
 * (e.g. a Dokploy/Nixpacks app that is NOT host-networked): the caller then
 * reaches the server by container name on the fixed internal port instead of a
 * published loopback port, so no host networking is required. Unset keeps the
 * original published-port behaviour (host-networked / local dev).
 */
function playwrightNetwork(): string | undefined {
  return process.env.BLOP_PLAYWRIGHT_NETWORK?.trim() || undefined;
}

/** Create the shared network if absent (idempotent; race-safe across runs). */
async function ensureNetwork(network: string): Promise<void> {
  try {
    await docker(["network", "create", network]);
  } catch {
    // Already exists — nothing to do.
  }
}

/** Names of the docker networks a container is attached to. */
async function containerNetworks(name: string): Promise<string[]> {
  try {
    const out = await docker([
      "inspect",
      "--format",
      "{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}",
      name,
    ]);
    return out.split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
}

async function containerLogs(name: string, since?: string): Promise<string> {
  try {
    const args = ["logs", ...(since ? ["--since", since] : []), name];
    const { stdout, stderr } = await execFileAsync("docker", args, { maxBuffer: 8 * 1024 * 1024 });
    return `${stdout}${stderr}`;
  } catch {
    return "";
  }
}

// Docker's userland proxy accepts TCP on the published port before the server
// inside the container is listening, so a port probe gives false positives.
// The reliable readiness signal is run-server's "Listening on ws://..." log
// line — poll the container logs for it instead. Logs survive restarts, so
// only lines from the current boot (StartedAt) count.
async function waitForServer(name: string): Promise<void> {
  let since: string | undefined;
  try {
    since = await docker(["inspect", "--format", "{{.State.StartedAt}}", name]);
  } catch {}
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const logs = await containerLogs(name, since);
    if (/Listening on ws:\/\//i.test(logs)) return;
    const state = await inspectContainer(name);
    if (!state?.running) {
      const tail = logs.trim().split("\n").slice(-20).join("\n");
      throw new Error(`Playwright container "${name}" exited before the server became ready.${tail ? `\nLast container logs:\n${tail}` : ""}`);
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out after ${STARTUP_TIMEOUT_MS}ms waiting for the Playwright server in container "${name}" to accept connections.`);
}

// An explicitly requested result is cached for the shared container. Starting
// a container session does not contact the public probe endpoint by default.
const egressByContainer = createContainerIdentityCache<boolean>();

/**
 * When explicitly requested, probe whether the shared container can reach the public internet. Uses a
 * low-overhead HEAD request to a well-known, highly-available host (Cloudflare
 * DNS at 1.1.1.1) from inside the container via `docker exec`. Probed once per
 * container identity; concurrent sessions for that exact container share one
 * probe, while a recreated container gets a new result.
 *
 * Failure modes this distinguishes:
 *  - Egress allowed (default Docker bridge network): true → third-party
 *    failures are genuine CORS/app-config issues the agent should report.
 *  - Egress blocked (air-gapped, firewall, custom network with no gateway):
 *    false → third-party failures are environment limits; the agent prompt is
 *    told to treat them as caveats, not app bugs.
 */
async function probeInternetEgress(
  containerName: string,
  containerId: string,
): Promise<boolean> {
  // A single short HEAD request against Cloudflare's anycast DNS endpoint.
  // 1.1.1.1 is operated as a public anycast service with very high uptime, so
  // a failure here is a strong signal of blocked egress rather than a flaky
  // target. The 4s timeout keeps a blocked VM from stalling run startup.
  return await egressByContainer.getOrCreate(containerName, containerId, async () => {
    try {
      await execFileAsync(
        "docker",
        [
          "exec",
          containerName,
          "curl",
          "--silent",
          "--head",
          "--max-time", "4",
          "--output", "/dev/null",
          "https://1.1.1.1/",
        ],
        { timeout: 8_000 },
      );
      return true;
    } catch {
      return false;
    }
  });
}

/** Reset the cached egress result (used by tests that recreate the container). */
export function _resetEgressCacheForTests(): void {
  egressByContainer.clear();
}

/**
 * Ensures the shared Playwright server container exists and is ready, creating
 * or restarting it as needed, and returns its connection endpoint.
 */
export async function ensurePlaywrightContainer(options: PlaywrightContainerOptions = {}): Promise<{ containerId: string; containerName: string; wsEndpoint: string }> {
  const name = options.containerName ?? process.env.BLOP_PLAYWRIGHT_CONTAINER ?? DEFAULT_CONTAINER_NAME;
  const { image, serverVersion } = resolveImage(options);
  const network = playwrightNetwork();

  // On a shared network the caller connects by container name, so the network
  // must exist before we attach the container to it.
  if (network) await ensureNetwork(network);

  let state = await inspectContainer(name);
  if (state && state.image !== image) {
    // Image changed (e.g. playwright upgrade): replace the container so the
    // server version keeps matching the client.
    await docker(["rm", "-f", name]);
    state = null;
  }

  if (!state) {
    await docker([
      "run",
      "-d",
      "--name", name,
      "--init",
      "--restart", "unless-stopped",
      "--user", "pwuser",
      "--workdir", "/home/pwuser",
      // Lets in-container browsers reach servers on the host (e.g. a local
      // dev server under test) via http://host.docker.internal.
      "--add-host", "host.docker.internal:host-gateway",
      // Shared-network deploy: join the network and be reached by name.
      // Otherwise publish a random loopback port for a host-networked /
      // local-dev caller.
      ...(network ? ["--network", network] : ["-p", `127.0.0.1:0:${SERVER_PORT}`]),
      image,
      "/bin/sh", "-c",
      `npx -y playwright@${serverVersion} run-server --port ${SERVER_PORT} --host 0.0.0.0`,
    ]);
  } else if (!state.running) {
    await docker(["start", name]);
  }

  // A pre-existing container (created before the network existed, or in
  // published-port mode) won't be on the shared network yet — attach it so name
  // resolution works. No-op when we just created it with --network.
  if (network && !(await containerNetworks(name)).includes(network)) {
    await docker(["network", "connect", network, name]);
  }

  await waitForServer(name);

  const refreshed = await inspectContainer(name);
  if (!refreshed) {
    throw new Error(`Playwright container "${name}" disappeared while starting.`);
  }

  // On a shared network connect by name on the fixed internal port; otherwise
  // use the published loopback port discovered from docker.
  let wsEndpoint: string;
  if (network) {
    wsEndpoint = `ws://${name}:${SERVER_PORT}/`;
  } else {
    const { host, port } = await mappedHostPort(name);
    wsEndpoint = `ws://${host}:${port}/`;
  }

  return { containerId: refreshed.id, containerName: name, wsEndpoint };
}

/**
 * Connects a new browser session to the shared Playwright container. Multiple
 * sessions (sequential or concurrent) attach to the same container; each gets
 * its own browser instance inside it.
 *
 * The container's run-server launches a fresh browser per WebSocket client
 * using launch options it reads from the `x-playwright-launch-options` header
 * (see playwright-core's `PlaywrightServer`). We use that to start the
 * in-container chromium with web-security disabled, so the agent can drive
 * cross-origin flows (OAuth redirects, third-party iframes, cross-origin
 * fetch/XHR) without the sandbox's own origin tripping a CORS rejection that
 * the real app would never hit in production.
 */
export async function startPlaywrightContainer(options: PlaywrightContainerOptions = {}): Promise<PlaywrightContainerSession> {
  const { containerId, containerName, wsEndpoint } = await ensurePlaywrightContainer(options);
  const corsBypassed = !process.env.BLOP_CONTAINER_DISABLE_CORS_BYPASS;
  const connectOptions: Record<string, unknown> = { timeout: 30_000 };
  if (corsBypassed) {
    // The run-server filters launch options to a safe allowlist (args,
    // ignoreDefaultArgs, headless, ...). `args` survives the filter, so we can
    // pass chromium flags here without exposing the broader launch surface.
    connectOptions.headers = {
      "x-playwright-launch-options": JSON.stringify({
        args: [
          "--disable-web-security",
          "--disable-features=IsolateOrigins,site-per-process",
        ],
      }),
    };
  }
  const browser = await chromium.connect(wsEndpoint, connectOptions as any);
  const internetEgressProbe = resolveInternetEgressProbe(options.probeInternetEgress);
  const hasInternetEgress = internetEgressProbe.enabled
    ? await probeInternetEgress(containerName, containerId)
    : null;
  return {
    browser,
    containerId,
    containerName,
    wsEndpoint,
    hasInternetEgress,
    internetEgressProbe,
    corsBypassed,
    stop: async () => {
      try { await browser.close(); } catch {}
    },
  };
}

/** Removes the shared container entirely (explicit teardown; runs never call this). */
export async function stopPlaywrightContainer(containerName?: string): Promise<void> {
  const name = containerName ?? process.env.BLOP_PLAYWRIGHT_CONTAINER ?? DEFAULT_CONTAINER_NAME;
  try {
    await docker(["rm", "-f", name]);
  } catch {}
  egressByContainer.delete(name);
}
