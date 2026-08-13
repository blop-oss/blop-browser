import { createServer, createConnection, type Server } from "node:net";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import {
  browserSessionDirectories,
  validateBrowserSessionName,
} from "../session/scope.js";

const MAX_MESSAGE_BYTES = 1_048_576;

export type RpcMethod = "ping" | "status" | "list_tools" | "describe_tool" | "call_tool" | "shutdown";

export type RpcRequest = {
  id: string;
  token: string;
  method: RpcMethod;
  params?: Record<string, unknown>;
};

export type RpcResponse = {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
};

export type DaemonEndpoint = {
  version: 1;
  session: string;
  pid: number;
  port: number;
  token: string;
  startedAt: string;
};

export type RuntimePaths = {
  directory: string;
  endpoint: string;
  startup: string;
  log: string;
  artifacts: string;
  profile: string;
  downloads: string;
};

export function validateSessionName(session: string) {
  return validateBrowserSessionName(session);
}

export function pathsForSession(session: string): RuntimePaths {
  const sessionDirectories = browserSessionDirectories(session);
  const directory = sessionDirectories.runtimeDirectory;
  return {
    directory,
    endpoint: join(directory, `${session}.json`),
    startup: join(directory, `${session}.starting`),
    log: join(directory, `${session}.log`),
    artifacts: sessionDirectories.artifactDirectory,
    profile: sessionDirectories.profileDirectory,
    downloads: sessionDirectories.downloadsDirectory,
  };
}

export async function ensureRuntimeDirectory(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700).catch(() => undefined);
}

export async function readEndpoint(session: string): Promise<DaemonEndpoint | null> {
  const paths = pathsForSession(session);
  try {
    const endpoint = JSON.parse(await readFile(paths.endpoint, "utf8")) as DaemonEndpoint;
    if (endpoint.version !== 1 || endpoint.session !== session || !endpoint.port || !endpoint.token) return null;
    return endpoint;
  } catch {
    return null;
  }
}

export async function removeEndpoint(session: string) {
  await rm(pathsForSession(session).endpoint, { force: true });
}

export async function requestDaemon(
  endpoint: DaemonEndpoint,
  method: RpcMethod,
  params: Record<string, unknown> = {},
  timeoutMs = 120_000,
): Promise<RpcResponse> {
  const request: RpcRequest = {
    id: randomUUID(),
    token: endpoint.token,
    method,
    params,
  };
  return await new Promise<RpcResponse>((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port: endpoint.port });
    let settled = false;
    let buffer = "";
    const finish = (error?: Error, response?: RpcResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(response!);
    };
    const timer = setTimeout(() => finish(new Error(`Daemon request timed out after ${timeoutMs}ms.`)), timeoutMs);
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > MAX_MESSAGE_BYTES) {
        finish(new Error("Daemon response exceeded the 1 MiB limit."));
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try {
        finish(undefined, JSON.parse(buffer.slice(0, newline)) as RpcResponse);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.once("error", (error) => finish(error));
    socket.once("end", () => {
      if (!settled) finish(new Error("Daemon closed the connection without a response."));
    });
  });
}

export async function daemonIsHealthy(endpoint: DaemonEndpoint) {
  try {
    const response = await requestDaemon(endpoint, "ping", {}, 1_500);
    return response.ok && (response.result as { pid?: number } | undefined)?.pid === endpoint.pid;
  } catch {
    return false;
  }
}

export type RpcServer = {
  endpoint: DaemonEndpoint;
  server: Server;
  close: () => Promise<void>;
};

export async function startRpcServer(
  session: string,
  handler: (request: RpcRequest) => Promise<RpcResponse>,
): Promise<RpcServer> {
  const paths = pathsForSession(session);
  await ensureRuntimeDirectory(paths.directory);
  const token = randomBytes(32).toString("hex");
  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", async (chunk) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > MAX_MESSAGE_BYTES) {
        socket.end(`${JSON.stringify(errorResponse("unknown", "request_too_large", "Request exceeded the 1 MiB limit."))}\n`);
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      socket.pause();
      let request: RpcRequest;
      try {
        request = JSON.parse(buffer.slice(0, newline)) as RpcRequest;
      } catch {
        socket.end(`${JSON.stringify(errorResponse("unknown", "invalid_json", "Request was not valid JSON."))}\n`);
        return;
      }
      if (request.token !== token) {
        socket.end(`${JSON.stringify(errorResponse(request.id, "unauthorized", "Invalid daemon token."))}\n`);
        return;
      }
      try {
        socket.end(`${JSON.stringify(await handler(request))}\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        socket.end(`${JSON.stringify(errorResponse(request.id, "internal_error", message))}\n`);
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Daemon failed to bind a TCP port.");
  const endpoint: DaemonEndpoint = {
    version: 1,
    session,
    pid: process.pid,
    port: address.port,
    token,
    startedAt: new Date().toISOString(),
  };
  const temporary = `${paths.endpoint}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(endpoint)}\n`, { mode: 0o600 });
  await rename(temporary, paths.endpoint);
  await chmod(paths.endpoint, 0o600).catch(() => undefined);
  let closed = false;
  return {
    endpoint,
    server,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await removeEndpoint(session);
    },
  };
}

export function okResponse(id: string, result: unknown): RpcResponse {
  return { id, ok: true, result };
}

export function errorResponse(id: string, code: string, message: string): RpcResponse {
  return { id, ok: false, error: { code, message } };
}
