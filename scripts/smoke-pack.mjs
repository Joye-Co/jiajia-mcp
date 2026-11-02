// 发布前的最后一道冒烟：把 npm pack 打出的 tarball 放进一个干净目录，用 npx 启动 jiajia-mcp，
// 对本地假服务端转发一次 tools/list。不连任何真实服务，不用任何 key。
// 先运行 npm run build。在 Node 20 上也要通过（用户侧 engines 是 >=20）。
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const work = mkdtempSync(join(tmpdir(), "jiajia-mcp-pack-"));
const seen = [];
const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
  });
  req.on("end", () => {
    const message = JSON.parse(raw);
    seen.push({ method: message.method, authorization: req.headers.authorization ?? null });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "fake_tool" }] } }));
  });
});

try {
  execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", work], { stdio: ["ignore", "ignore", "inherit"] });
  const tarball = readdirSync(work).find((name) => name.endsWith(".tgz"));
  assert.ok(tarball, "npm pack 没有生成 tarball");

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;

  const run = join(work, "run");
  execFileSync("mkdir", [run]);
  const child = spawn("npx", ["-y", "--package", join(work, tarball), "jiajia-mcp"], {
    cwd: run,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: work,
      npm_config_cache: join(work, "cache"),
      JIAJIA_MCP_URL: url,
    },
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
  child.stdin.end(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`);
  const code = await new Promise((resolve) => child.on("close", resolve));

  assert.equal(code, 0, stderr);
  assert.deepEqual(JSON.parse(stdout), { jsonrpc: "2.0", id: 1, result: { tools: [{ name: "fake_tool" }] } });
  assert.deepEqual(seen, [{ method: "tools/list", authorization: null }]);
  console.log(`tarball ${tarball} 经 npx 在 Node ${process.versions.node} 上启动，转发了一次 tools/list`);
} finally {
  server.close();
  rmSync(work, { recursive: true, force: true });
}
