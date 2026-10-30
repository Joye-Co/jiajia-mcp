import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createBridge, encodeHeaderValue } from "../src/bridge.ts";
import { echo, replyJson, startFakeServer } from "./fake-server.ts";

const MODERN_META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "test", version: "0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};
const KEY = "jj_test_placeholder";

function harness(endpoint: string, key?: string) {
  const lines: unknown[] = [];
  const logs: string[] = [];
  const bridge = createBridge({
    endpoint,
    key,
    userAgent: "jiajia-mcp/test",
    write: (line) => lines.push(JSON.parse(line)),
    log: (message) => logs.push(message),
  });
  return {
    lines,
    logs,
    async send(...messages: unknown[]) {
      for (const message of messages) {
        bridge.handleLine(typeof message === "string" ? message : JSON.stringify(message));
      }
      await bridge.drain();
    },
  };
}

describe("正常转发", () => {
  test("JSON 响应原样写到 stdout，带上规范要求的请求头", async (t) => {
    const server = await startFakeServer(echo);
    t.after(server.close);
    const { lines, send } = harness(server.url);

    await send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: MODERN_META } });

    assert.deepEqual(lines, [{ jsonrpc: "2.0", id: 1, result: { method: "tools/list" } }]);
    const [request] = server.received;
    assert.equal(request?.headers["content-type"], "application/json");
    assert.equal(request?.headers.accept, "application/json, text/event-stream");
    assert.equal(request?.headers.authorization, undefined);
    assert.equal(request?.headers.origin, undefined);
    assert.deepEqual(request?.body, { jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: MODERN_META } });
  });

  test("SSE 响应里的通知和最终结果都按顺序转出", async (t) => {
    const server = await startFakeServer((request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(": keep-alive\n\n");
      response.write(
        `data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { progress: 1 } })}\r\n\r\n`,
      );
      // 一条事件拆成多行 data，中间切开写。
      response.write(`event: message\ndata: {"jsonrpc":"2.0",\ndata: "id":${JSON.stringify(request.body.id)},`);
      response.end(`"result":{"ok":true}}\n\n`);
    });
    t.after(server.close);
    const { lines, send } = harness(server.url);

    await send({ jsonrpc: "2.0", id: "a", method: "tools/call", params: { name: "search", _meta: MODERN_META } });

    assert.deepEqual(lines, [
      { jsonrpc: "2.0", method: "notifications/progress", params: { progress: 1 } },
      { jsonrpc: "2.0", id: "a", result: { ok: true } },
    ]);
  });

  test("通知收到 202 时不往 stdout 写任何东西", async (t) => {
    const server = await startFakeServer(echo);
    t.after(server.close);
    const { lines, send } = harness(server.url);

    await send({ jsonrpc: "2.0", method: "notifications/initialized" });

    assert.equal(server.received.length, 1);
    assert.deepEqual(lines, []);
  });
});

describe("协议请求头", () => {
  test("新一代请求从 _meta 推出 MCP-Protocol-Version、Mcp-Method 和 Mcp-Name", async (t) => {
    const server = await startFakeServer(echo);
    t.after(server.close);
    const { send } = harness(server.url);

    await send(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_answer", _meta: MODERN_META } },
      { jsonrpc: "2.0", id: 2, method: "prompts/get", params: { name: "深入", _meta: MODERN_META } },
      { jsonrpc: "2.0", id: 3, method: "tools/list", params: { _meta: MODERN_META } },
    );

    const byId = (id: number) => server.received.find((r) => r.body.id === id)?.headers;
    assert.equal(byId(1)?.["mcp-protocol-version"], "2026-07-28");
    assert.equal(byId(1)?.["mcp-method"], "tools/call");
    assert.equal(byId(1)?.["mcp-name"], "get_answer");
    assert.equal(byId(2)?.["mcp-name"], "=?base64?5rex5YWl?=");
    assert.equal(byId(3)?.["mcp-method"], "tools/list");
    assert.equal(byId(3)?.["mcp-name"], undefined);
  });

  test("旧一代请求在 initialize 之后带上协商出的版本，不带新一代的请求头", async (t) => {
    const server = await startFakeServer((request, response) => {
      if (request.body.method === "initialize") {
        replyJson(response, 200, { jsonrpc: "2.0", id: request.body.id, result: { protocolVersion: "2025-11-25" } });
      } else {
        echo(request, response);
      }
    });
    t.after(server.close);
    const { send } = harness(server.url);

    await send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } });
    await send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search" } });

    assert.equal(server.received[0]?.headers["mcp-protocol-version"], undefined);
    assert.equal(server.received[1]?.headers["mcp-protocol-version"], "2025-11-25");
    assert.equal(server.received[1]?.headers["mcp-method"], undefined);
    assert.equal(server.received[1]?.headers["mcp-name"], undefined);
  });

  test("请求头值按规范编码", () => {
    assert.equal(encodeHeaderValue("us-west1"), "us-west1");
    assert.equal(encodeHeaderValue("Hello, 世界"), "=?base64?SGVsbG8sIOS4lueVjA==?=");
    assert.equal(encodeHeaderValue(" padded "), "=?base64?IHBhZGRlZCA=?=");
    assert.equal(encodeHeaderValue("line1\nline2"), "=?base64?bGluZTEKbGluZTI=?=");
    assert.equal(encodeHeaderValue("=?base64?literal?="), "=?base64?PT9iYXNlNjQ/bGl0ZXJhbD89?=");
  });
});

describe("带 key", () => {
  test("设置了 key 时每个请求都带 Authorization", async (t) => {
    const server = await startFakeServer(echo);
    t.after(server.close);
    const { send } = harness(server.url, KEY);

    await send(
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: MODERN_META } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
    );

    assert.deepEqual(
      server.received.map((r) => r.headers.authorization),
      [`Bearer ${KEY}`, `Bearer ${KEY}`],
    );
  });

  test("key 被拒绝时返回带原 id 的错误，输出和日志里都不出现 key", async (t) => {
    const server = await startFakeServer((_request, response) => {
      response.writeHead(401, { "content-type": "text/plain" }).end("unauthorized");
    });
    t.after(server.close);
    const { lines, logs, send } = harness(server.url, KEY);

    await send({ jsonrpc: "2.0", id: 7, method: "tools/list", params: { _meta: MODERN_META } });

    assert.equal(lines.length, 1);
    const [line] = lines as [{ id: number; error: { code: number; message: string; data: unknown } }];
    assert.equal(line.id, 7);
    assert.equal(line.error.code, -32000);
    assert.match(line.error.message, /HTTP 401/);
    assert.deepEqual(line.error.data, { httpStatus: 401 });
    assert.ok(!JSON.stringify([lines, logs]).includes(KEY));
  });
});

describe("错误透传", () => {
  test("服务端带 JSON-RPC 正文的 401 原样交给客户端，并在日志里说明怎么设置 key", async (t) => {
    const denied = {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32001, message: "需要登录", data: { keyUrl: "https://jiajia.fun/login" } },
    };
    const server = await startFakeServer((_request, response) => replyJson(response, 401, denied));
    t.after(server.close);
    const { lines, logs, send } = harness(server.url, KEY);

    await send({ jsonrpc: "2.0", id: 3, method: "tools/list", params: { _meta: MODERN_META } });

    assert.deepEqual(lines, [{ ...denied, id: 3 }]);
    assert.equal(logs.length, 1);
    assert.match(logs[0] ?? "", /HTTP 401.*JIAJIA_MCP_KEY/);
    assert.ok(!JSON.stringify([lines, logs]).includes(KEY));
  });

  test("服务端返回的 JSON-RPC 错误原样交给客户端", async (t) => {
    const mismatch = { jsonrpc: "2.0", id: 1, error: { code: -32020, message: "Header mismatch" } };
    const server = await startFakeServer((_request, response) => replyJson(response, 400, mismatch));
    t.after(server.close);
    const { lines, send } = harness(server.url);

    await send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: MODERN_META } });

    assert.deepEqual(lines, [mismatch]);
  });

  test("不带 id 的 JSON-RPC 错误补上请求的 id", async (t) => {
    const server = await startFakeServer((_request, response) =>
      replyJson(response, 403, { jsonrpc: "2.0", error: { code: -32600, message: "Forbidden" } }),
    );
    t.after(server.close);
    const { lines, send } = harness(server.url);

    await send({ jsonrpc: "2.0", id: "x", method: "tools/list", params: { _meta: MODERN_META } });

    assert.deepEqual(lines, [{ jsonrpc: "2.0", id: "x", error: { code: -32600, message: "Forbidden" } }]);
  });

  test("不是 JSON-RPC 的错误响应合成为错误，带上 HTTP 状态", async (t) => {
    const server = await startFakeServer((_request, response) => response.writeHead(503).end("closed"));
    t.after(server.close);
    const { lines, logs, send } = harness(server.url);

    await send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: MODERN_META } });

    assert.deepEqual(lines, [
      {
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32000, message: "服务暂时不可用（HTTP 503），请稍后再试", data: { httpStatus: 503 } },
      },
    ]);
    assert.equal(logs.length, 1);
  });

  test("连不上端点时返回错误，不让客户端一直等", async () => {
    const server = await startFakeServer(echo);
    await server.close();
    const { lines, send } = harness(server.url);

    await send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: MODERN_META } });

    const [line] = lines as [{ id: number; error: { code: number; message: string } }];
    assert.equal(line.id, 1);
    assert.match(line.error.message, /无法连接/);
  });

  test("响应流没给结果就结束时返回错误", async (t) => {
    const server = await startFakeServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(": bye\n\n");
    });
    t.after(server.close);
    const { lines, send } = harness(server.url);

    await send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: MODERN_META } });

    const [line] = lines as [{ id: number; error: { message: string } }];
    assert.equal(line.id, 1);
    assert.match(line.error.message, /结束/);
  });

  test("通知的响应流结束时不报错", async (t) => {
    const server = await startFakeServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(": bye\n\n");
    });
    t.after(server.close);
    const { lines, logs, send } = harness(server.url);

    await send({ jsonrpc: "2.0", method: "notifications/initialized" });

    assert.deepEqual(lines, []);
    assert.deepEqual(logs, []);
  });

  test("无法解析的行和批量请求在本地就返回错误，不发到服务端", async (t) => {
    const server = await startFakeServer(echo);
    t.after(server.close);
    const { lines, send } = harness(server.url);

    await send("{not json", "[]");

    assert.equal(server.received.length, 0);
    assert.deepEqual(
      (lines as { error: { code: number } }[]).map((line) => line.error.code),
      [-32700, -32600],
    );
  });
});

describe("取消", () => {
  test("notifications/cancelled 断开对应请求的连接，不再返回结果", async (t) => {
    const server = await startFakeServer(() => {
      // 一直不回，等转发器自己断开。
    });
    t.after(server.close);
    const { lines, send } = harness(server.url);

    const request = send({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "search", _meta: MODERN_META },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 9 } });
    await request;

    assert.equal(server.received.length, 1);
    assert.deepEqual(lines, []);
  });
});
