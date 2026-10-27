#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createBridge, DEFAULT_ENDPOINT } from "./bridge.ts";

// src/ 和 dist/ 都在仓库根目录下一层，同一个相对路径能找到 package.json。
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};

const log = (message: string) => process.stderr.write(`jiajia-mcp: ${message}\n`);

const key = process.env.JIAJIA_MCP_KEY?.trim() || undefined;
const endpoint = process.env.JIAJIA_MCP_URL?.trim() || DEFAULT_ENDPOINT;

let url: URL;
try {
  url = new URL(endpoint);
} catch {
  log(`JIAJIA_MCP_URL 不是有效的地址：${endpoint}`);
  process.exit(1);
}
// key 只走 https，本机调试除外。
const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
if (key && url.protocol !== "https:" && !local) {
  log("带 key 时 JIAJIA_MCP_URL 必须是 https 地址");
  process.exit(1);
}

const bridge = createBridge({
  endpoint,
  key,
  userAgent: `jiajia-mcp/${version}`,
  write: (line) => process.stdout.write(`${line}\n`),
  log,
});

const input = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
input.on("line", (line) => bridge.handleLine(line));
input.on("close", () => void bridge.drain());
