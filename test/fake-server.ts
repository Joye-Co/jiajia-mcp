import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface Received {
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
}

type Handler = (request: Received, response: ServerResponse) => void;

// 本地假服务端：记录收到的每个请求，按测试给的 handler 回应。
export async function startFakeServer(handler: Handler) {
  const received: Received[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      raw += chunk;
    });
    req.on("end", () => {
      const request = { headers: req.headers, body: JSON.parse(raw) as Record<string, unknown> };
      received.push(request);
      handler(request, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export function replyJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

// 回显请求的 id，结果里带上方法名，方便断言。
export function echo(request: Received, response: ServerResponse): void {
  if (!("id" in request.body)) {
    response.writeHead(202).end();
    return;
  }
  replyJson(response, 200, { jsonrpc: "2.0", id: request.body.id, result: { method: request.body.method } });
}
