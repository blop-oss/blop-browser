import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export type FixtureRoute = {
  path: string;
  body: string;
  contentType?: string;
  status?: number;
  headers?: Record<string, string>;
  method?: string;
  onRequest?: (request: IncomingMessage, body: string) => void | Promise<void>;
};

export async function startFixtureServer(routes: FixtureRoute[]) {
  const server = createServer((request, response) => {
    respond(request, response, routes);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fixture server did not expose a TCP address.");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => {
      try { server.closeAllConnections(); } catch {}
      try { server.close(() => resolve()); } catch { resolve(); }
    }),
  };
}

async function respond(request: IncomingMessage, response: ServerResponse, routes: FixtureRoute[]) {
  const url = new URL(request.url ?? "/", "http://fixture.local");
  const route = routes.find((candidate) => candidate.path === url.pathname && (!candidate.method || candidate.method === request.method));

  if (!route) {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("Not found");
    return;
  }

  const body = await readRequestBody(request);
  await route.onRequest?.(request, body);
  response.writeHead(route.status ?? 200, {
    "content-type": route.contentType ?? "text/html; charset=utf-8",
    ...route.headers,
  });
  response.end(route.body);
}

async function readRequestBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
