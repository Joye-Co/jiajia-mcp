import assert from "node:assert/strict";
import { test } from "node:test";
import { TOOLS } from "../src/index.ts";
import { breakingChanges, type Removal } from "./schema-compat.ts";

type Tool = (typeof TOOLS)[number];
const clone = (): Tool[] => structuredClone(TOOLS) as Tool[];
// biome-ignore lint/suspicious/noExplicitAny: 测试要直接改深层的 schema 字段来构造违规样例
type Editable = { -readonly [K in keyof Tool]: any };
const tool = (tools: Tool[], name: string) => tools.find((t) => t.name === name) as Editable;
const today = "2026-12-01";

test("没有改动时没有不兼容变更", () => {
  assert.deepEqual(breakingChanges(TOOLS, clone(), [], today), []);
});

test("兼容变更放行：新增可选参数、新增返回字段、新增工具、返回枚举加值", () => {
  const next = clone();
  tool(next, "search").inputSchema.properties.limit = { type: "integer" };
  tool(next, "get_answer").outputSchema.oneOf[0].properties.answer.properties.extra = { type: "string" };
  tool(next, "get_answer").outputSchema.oneOf[1].properties.error.properties.code.enum.push("new_code");
  next.push({ ...tool(next, "get_answer"), name: "get_answer_v2" });
  assert.deepEqual(breakingChanges(TOOLS, next, [], today), []);
});

test("契约列出的不兼容变更都会被拦下", () => {
  const edits: [string, (t: Tool[]) => void, RegExp][] = [
    ["删参数", (t) => delete tool(t, "search").inputSchema.properties.topic, /search\.input\.topic: 删掉了/],
    ["新增必填参数", (t) => tool(t, "list_updates").inputSchema.required.push("since"), /新增必填/],
    ["收紧取值", (t) => tool(t, "search").inputSchema.properties.kind.enum.pop(), /去掉了取值 all/],
    ["改默认行为", (t) => (tool(t, "search").inputSchema.properties.kind.default = "answer"), /default 变了/],
    ["改参数类型", (t) => (tool(t, "get_answer").inputSchema.properties.id.type = "integer"), /参数类型收窄/],
    [
      "删返回字段",
      (t) => delete tool(t, "get_answer").outputSchema.oneOf[0].properties.answer.properties.mayExpire,
      /mayExpire: 删掉了/,
    ],
    [
      "返回字段变成可选",
      (t) => tool(t, "get_answer").outputSchema.oneOf[0].properties.answer.required.pop(),
      /不再保证返回/,
    ],
    [
      "返回字段可以为 null",
      (t) => (tool(t, "list_topics").outputSchema.oneOf[0].properties.topics.type = ["array", "null"]),
      /返回类型放宽/,
    ],
    ["工具改名", (t) => (tool(t, "get_topic").name = "read_topic"), /get_topic: 删除了工具/],
  ];
  for (const [label, edit, expected] of edits) {
    const next = clone();
    edit(next);
    const problems = breakingChanges(TOOLS, next, [], today);
    assert.ok(
      problems.some((p) => expected.test(p)),
      `${label}: ${problems.join("\n") || "没有报"}`,
    );
  }
});

test("删工具要登记、满 30 天、替代者存在且写在旧说明里", () => {
  const prev = clone();
  tool(prev, "get_topic").description += " 已由 get_topic_v2 替代。";
  const next = clone().filter((t) => t.name !== "get_topic");
  next.push({ ...tool(prev, "get_topic"), name: "get_topic_v2" });
  const removal = (deprecatedSince: string, replacement = "get_topic_v2"): Removal[] => [
    { tool: "get_topic", replacement, deprecatedSince },
  ];

  assert.deepEqual(breakingChanges(prev, next, removal("2026-10-01"), today), []);
  assert.match(breakingChanges(prev, next, removal("2026-11-15"), today).join(), /之后才能删/);
  assert.match(breakingChanges(prev, next, removal("2026-10-01", "nope"), today).join(), /替代者 nope 不存在/);
  assert.match(breakingChanges(TOOLS, next, removal("2026-10-01"), today).join(), /说明里没有写出替代者/);
});
