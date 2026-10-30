import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { echo, startFakeServer } from "./fake-server.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

// 起一个真的 cli 进程：往 stdin 写完就关掉，收集 stdout 和 stderr。
function runCli(env: Record<string, string>, input: string) {
  const child = spawn(process.execPath, [CLI], {
    env: { PATH: process.env.PATH ?? "", ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdin.end(input);
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("从环境变量读端点和 key，stdin 关闭后处理完再退出", async (t) => {
  const server = await startFakeServer(echo);
  t.after(server.close);

  const result = await runCli(
    { JIAJIA_MCP_URL: server.url, JIAJIA_MCP_KEY: " jj_test_placeholder\n" },
    `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "server/discover" })}\n`,
  );

  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), { jsonrpc: "2.0", id: 1, result: { method: "server/discover" } });
  assert.equal(server.received[0]?.headers.authorization, "Bearer jj_test_placeholder");
  assert.match(server.received[0]?.headers["user-agent"] ?? "", /^jiajia-mcp\/\d+\.\d+\.\d+$/);
  assert.equal(result.stderr, "", "设置了 key 时不提醒");
});

test("没有 key 照样启动，在 stderr 提醒一次", async (t) => {
  const server = await startFakeServer(echo);
  t.after(server.close);

  const result = await runCli(
    { JIAJIA_MCP_URL: server.url },
    `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "server/discover" })}\n`,
  );

  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), { jsonrpc: "2.0", id: 1, result: { method: "server/discover" } });
  assert.equal(server.received[0]?.headers.authorization, undefined);
  const lines = result.stderr.trim().split("\n");
  assert.equal(lines.length, 1, result.stderr);
  assert.match(lines[0] ?? "", /没有设置 JIAJIA_MCP_KEY/);
});

test("带 key 时拒绝非 https 的远程地址", async () => {
  const result = await runCli({ JIAJIA_MCP_URL: "http://example.com/mcp", JIAJIA_MCP_KEY: "jj_test_placeholder" }, "");

  assert.equal(result.code, 1);
  assert.match(result.stderr, /https/);
  assert.equal(result.stdout, "");
});
