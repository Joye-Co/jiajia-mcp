// 用户侧支持 Node 20，但开发和测试都在 Node 24 上跑。这个冒烟测试用纯 JavaScript 写，
// 在 Node 20 上运行构建好的 dist/：包入口能导入，CLI 能把一条请求转发到本地假服务端并写回 stdout。
// 先运行 npm run build。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

const pkg = await import("../dist/index.js");
assert.ok(pkg.TOOLS.length > 0, "dist/index.js 没有导出工具定义");
assert.ok(Array.isArray(pkg.COMPAT.protocolVersions), "dist/index.js 读不到 schema/compat.json");
assert.ok(pkg.SAFETY_CASES.length >= 10, "dist/index.js 读不到 schema/safety-cases.json");

const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
  });
  req.on("end", () => {
    const { id } = JSON.parse(raw);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id, result: { ok: true } }));
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/mcp`;

const child = spawn(process.execPath, [new URL("../dist/cli.js", import.meta.url).pathname], {
  env: { PATH: process.env.PATH ?? "", JIAJIA_MCP_URL: url },
  stdio: ["pipe", "pipe", "inherit"],
});
let stdout = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk;
});
child.stdin.end(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`);
const code = await new Promise((resolve) => child.on("close", resolve));
server.close();

assert.equal(code, 0);
assert.deepEqual(JSON.parse(stdout), { jsonrpc: "2.0", id: 1, result: { ok: true } });
console.log(`dist/ 在 Node ${process.versions.node} 上可以运行`);
