import "./bun-ws-compat.js";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { firefox, type Browser } from "playwright";
import {
  createContainerIdentityCache,
  resolveInternetEgressProbe,
  type InternetEgressProbeDisclosure,
} from "./egress.js";

const execFileAsync = promisify(execFile);

const DEFAULT_CONTAINER_NAME = "blop-camoufox";
const SERVER_PORT = 3000;
const STARTUP_TIMEOUT_MS = 180_000;
const READY_POLL_INTERVAL_MS = 500;
const WS_PATH_LABEL = "com.blop.camoufox.ws-path";

export type CamoufoxContainerOptions = {
  image?: string;
  containerName?: string;
  /** Explicitly contact the fixed public endpoint disclosed by `internetEgressProbe`. */
  probeInternetEgress?: boolean;
};

export type CamoufoxContainerSession = {
  browser: Browser;
  containerId: string;
  containerName: string;
  wsEndpoint: string;
  /** `null` unless the fixed public-endpoint diagnostic was explicitly requested. */
  hasInternetEgress: boolean | null;
  internetEgressProbe: InternetEgressProbeDisclosure;
  corsBypassed: false;
  /** Disconnects this browser session while keeping the warm container alive. */
  stop: () => Promise<void>;
};

async function docker(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("docker", args, { maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
}

function dependencyVersion(name: string): string {
  const require = createRequire(import.meta.url);
  return require(`${name}/package.json`).version as string;
}

function defaultImage(): string {
  const require = createRequire(import.meta.url);
  const harnessVersion = (require("../../package.json") as { version: string }).version;
  const playwrightVersion = dependencyVersion("playwright");
  const camoufoxVersion = dependencyVersion("camoufox-js");
  return `blop-camoufox:h${harnessVersion}-pw${playwrightVersion}-cf${camoufoxVersion}`;
}

async function imageExists(image: string): Promise<boolean> {
  try {
    await docker(["image", "inspect", image]);
    return true;
  } catch {
    return false;
  }
}

async function ensureDefaultImage(image: string, explicit: boolean): Promise<void> {
  if (await imageExists(image)) return;
  if (explicit) {
    await docker(["pull", image]);
    return;
  }
  const context = fileURLToPath(new URL("../../docker/camoufox", import.meta.url));
  await docker([
    "build",
    "--build-arg", `PLAYWRIGHT_VERSION=${dependencyVersion("playwright")}`,
    "--build-arg", `CAMOUFOX_JS_VERSION=${dependencyVersion("camoufox-js")}`,
    "--tag", image,
    context,
  ]);
}

type ContainerState = { id: string; running: boolean; image: string; wsPath: string } | null;

async function inspectContainer(name: string): Promise<ContainerState> {
  try {
    const out = await docker([
      "inspect",
      "--format",
      `{{.Id}}\t{{.State.Running}}\t{{.Config.Image}}\t{{index .Config.Labels "${WS_PATH_LABEL}"}}`,
      name,
    ]);
    const [id, running, image, wsPath] = out.split("\t");
    return { id, running: running === "true", image, wsPath };
  } catch {
    return null;
  }
}

async function mappedHostPort(name: string): Promise<{ host: string; port: number }> {
  const out = await docker(["port", name, `${SERVER_PORT}/tcp`]);
  const line = out.split("\n").find((entry) => entry.includes("127.0.0.1")) ?? out.split("\n")[0];
  const port = Number(line.slice(line.lastIndexOf(":") + 1));
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Could not resolve the published port for container "${name}" (docker port said: ${out || "<empty>"}).`);
  }
  return { host: "127.0.0.1", port };
}

function camoufoxNetwork(): string | undefined {
  return process.env.BLOP_CAMOUFOX_NETWORK?.trim()
    || process.env.BLOP_PLAYWRIGHT_NETWORK?.trim()
    || undefined;
}

async function ensureNetwork(network: string): Promise<void> {
  try {
    await docker(["network", "create", network]);
  } catch {
    // Already exists.
  }
}

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
      throw new Error(`Camoufox container "${name}" exited before its server became ready.${tail ? `\nLast container logs:\n${tail}` : ""}`);
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out after ${STARTUP_TIMEOUT_MS}ms waiting for the Camoufox server in container "${name}".`);
}

const egressByContainer = createContainerIdentityCache<boolean>();

async function probeInternetEgress(
  containerName: string,
  containerId: string,
): Promise<boolean> {
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

async function launchOptions(containerName: string): Promise<Record<string, unknown>> {
  const output = await docker(["exec", containerName, "node", "/srv/camoufox/options.mjs"]);
  try {
    return JSON.parse(output) as Record<string, unknown>;
  } catch {
    throw new Error(`Camoufox container "${containerName}" returned invalid launch options.`);
  }
}

/** Ensure the warm, separate Camoufox server container exists and is ready. */
export async function ensureCamoufoxContainer(
  options: CamoufoxContainerOptions = {},
): Promise<{ containerId: string; containerName: string; wsEndpoint: string }> {
  const name = options.containerName ?? process.env.BLOP_CAMOUFOX_CONTAINER ?? DEFAULT_CONTAINER_NAME;
  const explicitImage = options.image ?? process.env.BLOP_CAMOUFOX_IMAGE;
  const image = explicitImage ?? defaultImage();
  const network = camoufoxNetwork();

  await ensureDefaultImage(image, Boolean(explicitImage));
  if (network) await ensureNetwork(network);

  let state = await inspectContainer(name);
  if (state && (state.image !== image || !state.wsPath)) {
    await docker(["rm", "-f", name]);
    state = null;
  }

  if (!state) {
    const wsPath = `/${randomBytes(24).toString("hex")}`;
    await docker([
      "run",
      "-d",
      "--name", name,
      "--init",
      "--restart", "unless-stopped",
      "--label", `${WS_PATH_LABEL}=${wsPath}`,
      "--add-host", "host.docker.internal:host-gateway",
      ...(network ? ["--network", network] : ["-p", `127.0.0.1:0:${SERVER_PORT}`]),
      image,
      "/srv/camoufox/node_modules/.bin/playwright",
      "run-server",
      "--port", String(SERVER_PORT),
      "--host", "0.0.0.0",
      "--path", wsPath,
      "--unsafe",
    ]);
  } else if (!state.running) {
    await docker(["start", name]);
  }

  if (network && !(await containerNetworks(name)).includes(network)) {
    await docker(["network", "connect", network, name]);
  }

  await waitForServer(name);
  const refreshed = await inspectContainer(name);
  if (!refreshed) throw new Error(`Camoufox container "${name}" disappeared while starting.`);

  if (network) {
    return {
      containerId: refreshed.id,
      containerName: name,
      wsEndpoint: `ws://${name}:${SERVER_PORT}${refreshed.wsPath}`,
    };
  }
  const { host, port } = await mappedHostPort(name);
  return {
    containerId: refreshed.id,
    containerName: name,
    wsEndpoint: `ws://${host}:${port}${refreshed.wsPath}`,
  };
}

/** Connect a fresh Camoufox browser through the warm container. */
export async function startCamoufoxContainer(
  options: CamoufoxContainerOptions = {},
): Promise<CamoufoxContainerSession> {
  const { containerId, containerName, wsEndpoint } = await ensureCamoufoxContainer(options);
  const generatedLaunchOptions = await launchOptions(containerName);
  const browser = await firefox.connect(wsEndpoint, {
    timeout: 30_000,
    headers: {
      "x-playwright-launch-options": JSON.stringify(generatedLaunchOptions),
    },
  });
  const internetEgressProbe = resolveInternetEgressProbe(options.probeInternetEgress);
  return {
    browser,
    containerId,
    containerName,
    wsEndpoint,
    hasInternetEgress: internetEgressProbe.enabled
      ? await probeInternetEgress(containerName, containerId)
      : null,
    internetEgressProbe,
    corsBypassed: false,
    stop: async () => {
      try { await browser.close(); } catch {}
    },
  };
}

/** Remove the shared Camoufox container; ordinary sessions leave it warm. */
export async function stopCamoufoxContainer(containerName?: string): Promise<void> {
  const name = containerName ?? process.env.BLOP_CAMOUFOX_CONTAINER ?? DEFAULT_CONTAINER_NAME;
  try {
    await docker(["rm", "-f", name]);
  } catch {}
  egressByContainer.delete(name);
}
