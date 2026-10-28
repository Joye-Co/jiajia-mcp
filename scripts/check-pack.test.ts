import assert from "node:assert/strict";
import { test } from "node:test";
import { packProblems } from "./check-pack.ts";

const good = [
  "package.json",
  "README.md",
  "LICENSE",
  "dist/index.js",
  "dist/index.d.ts",
  "dist/cli.js",
  "schema/tools.json",
  "schema/prompts.json",
  "schema/compat.json",
  "schema/safety-cases.json",
];

test("包里只有发布需要的文件时通过", () => {
  assert.deepEqual(packProblems(good), []);
  assert.deepEqual(packProblems([...good, "LICENSE-CONTENT"]), []);
});

test("多带了源码、测试或 source map 会报", () => {
  assert.match(packProblems([...good, "scripts/check-pack.ts"]).join(), /不该有 scripts/);
  assert.match(packProblems([...good, "src/index.ts"]).join(), /不该有 src/);
  assert.match(packProblems([...good, "dist/index.js.map"]).join(), /source map/);
});

test("缺少入口或 schema 会报", () => {
  assert.match(packProblems(good.filter((p) => p !== "dist/cli.js")).join(), /缺少 dist\/cli\.js/);
  assert.match(packProblems(good.filter((p) => p !== "schema/tools.json")).join(), /缺少 schema\/tools\.json/);
});
