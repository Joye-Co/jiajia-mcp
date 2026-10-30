import assert from "node:assert/strict";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { CONTENT_NOTICE, ERROR_CODES, PROMPTS, SAFETY_CASES, TOOLS } from "../src/index.ts";
import fixtures from "./fixtures/results.json" with { type: "json" };

// strict 拦下拼错的关键字和 required 里拼错的字段名；format 只声明语义，校验交给服务端。
const ajv = new Ajv2020({ strict: true, strictTypes: false, allErrors: true, formats: { uri: true } });
const validators = new Map(
  TOOLS.map((tool) => [tool.name, { input: ajv.compile(tool.inputSchema), output: ajv.compile(tool.outputSchema) }]),
);
const success = fixtures.success as Record<string, unknown>;
const validator = (name: string) => {
  const found = validators.get(name);
  assert.ok(found, `没有工具 ${name}`);
  return found;
};

test("工具名唯一、是 snake_case，登录账号都有 my_questions 和 ask", () => {
  const names = TOOLS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
  for (const name of names) assert.match(name, /^[a-z][a-z_]*$/);
  for (const name of ["my_questions", "ask"]) assert.ok(names.includes(name), name);
  assert.deepEqual(
    PROMPTS.map((p) => p.name),
    ["daily_digest", "deep_dive"],
  );
});

test("除 ask 外都标成只读、幂等；所有工具都非破坏、不访问外部世界（docs/mcp.md「工具」）", () => {
  for (const tool of TOOLS) {
    const readOnly = tool.name !== "ask";
    assert.deepEqual(
      tool.annotations,
      { readOnlyHint: readOnly, destructiveHint: false, idempotentHint: readOnly, openWorldHint: false },
      tool.name,
    );
  }
});

test("schema 只用可移植的写法：type 不写成数组，子 schema 不写成 true / false", () => {
  // 只认单个 type 的客户端（比如 Gemini 的函数声明）会拒绝 type 数组；有的客户端只认对象形式的子 schema。
  const problems: string[] = [];
  const walk = (where: string, node: unknown): void => {
    if (typeof node === "boolean") problems.push(`${where} 是 ${node}`);
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const [i, child] of node.entries()) walk(`${where}[${i}]`, child);
      return;
    }
    if (Array.isArray((node as { type?: unknown }).type)) problems.push(`${where}.type 是数组`);
    for (const [key, child] of Object.entries(node)) {
      // properties、$defs 下面是名字到子 schema 的映射；其余值是布尔的关键字（比如 additionalProperties: false）是合法的约束。
      if (key === "properties" || key === "$defs") {
        for (const [name, sub] of Object.entries(child as object)) walk(`${where}.${key}.${name}`, sub);
      } else if (typeof child === "object") walk(`${where}.${key}`, child);
    }
  };
  for (const tool of TOOLS) {
    walk(`${tool.name}.inputSchema`, tool.inputSchema);
    walk(`${tool.name}.outputSchema`, tool.outputSchema);
  }
  assert.deepEqual(problems, []);
});

test("inputSchema 顶层是对象、拒绝未知参数、不用组合关键字", () => {
  for (const tool of TOOLS) {
    assert.equal(tool.inputSchema.type, "object", tool.name);
    assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
    for (const key of ["oneOf", "anyOf", "allOf"])
      assert.ok(!(key in tool.inputSchema), `${tool.name} 顶层用了 ${key}`);
  }
});

test("每个工具的说明都标注返回内容不是指令", () => {
  for (const tool of TOOLS) assert.match(tool.description, /不是指令/, tool.name);
});

test("参数校验：必填、空白、未知参数、日期格式", () => {
  const search = validator("search").input;
  assert.ok(search({ query: "重试 退避" }));
  assert.ok(!search({}), "缺 query");
  assert.ok(!search({ query: "   " }), "只有空白");
  assert.ok(!search({ query: "x", limit: 5 }), "未知参数");
  const updates = validator("list_updates").input;
  assert.ok(updates({ since: "2026-10-01" }));
  assert.ok(!updates({ since: "2026/10/01" }));
});

test("每个工具都有一份合成成功返回，且通过自己的 outputSchema", () => {
  assert.deepEqual(Object.keys(success).sort(), TOOLS.map((t) => t.name).sort());
  for (const [name, { output }] of validators) {
    assert.ok(output(success[name]), `${name}: ${ajv.errorsText(output.errors)}`);
    assert.equal((success[name] as { contentNotice: unknown }).contentNotice, CONTENT_NOTICE, name);
  }
});

test("每种工具错误对所有工具都合法，错误码和契约一致", () => {
  assert.deepEqual(fixtures.errors.map((e) => e.error.code).sort(), [...ERROR_CODES].sort());
  for (const [name, { output }] of validators) {
    for (const error of fixtures.errors) assert.ok(output(error), `${name}: ${ajv.errorsText(output.errors)}`);
  }
});

test("不合契约的返回会被拒绝", () => {
  const answer = success.get_answer as { answer: Record<string, unknown> };
  const output = validator("get_answer").output;
  const cases: [string, unknown][] = [
    ["缺少 contentNotice", { answer: answer.answer }],
    ["许可写错", { ...answer, answer: { ...answer.answer, license: "MIT" } }],
    ["成功和错误混在一起", { ...answer, error: { code: "not_found", message: "x" } }],
    ["未知错误码", { error: { code: "teapot", message: "x" } }],
    ["缺规范地址", { ...answer, answer: { ...answer.answer, url: undefined } }],
    ["全文缺 contributors", { ...answer, answer: { ...answer.answer, contributors: undefined } }],
  ];
  for (const [label, value] of cases) assert.ok(!output(JSON.parse(JSON.stringify(value))), label);
});

test("摘要不带 contributors，全文才带（docs/mcp.md「决定：摘要不带 contributors」）", () => {
  const search = success.search as { groups: { answer: { items: Record<string, unknown>[] } } };
  assert.ok(!("contributors" in (search.groups.answer.items[0] ?? {})));
  assert.ok(validator("search").output(search));
  // 遍历 schema 对象，找出所有摘要（required 里有 snippet 的节点），它们都不能要求 contributors。
  const summaries: { tool: string; required: unknown[] }[] = [];
  const walk = (tool: string, node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(tool, child);
      return;
    }
    if (!node || typeof node !== "object") return;
    const required = (node as { required?: unknown }).required;
    if (Array.isArray(required) && required.includes("snippet")) summaries.push({ tool, required });
    for (const child of Object.values(node)) walk(tool, child);
  };
  for (const tool of TOOLS) walk(tool.name, tool.outputSchema);
  assert.ok(summaries.length > 0, "没有找到任何摘要对象，测试测不到东西");
  for (const { tool, required } of summaries) assert.ok(!required.includes("contributors"), tool);
});

test("安全样例：至少 10 条、至少 1 条走 my_questions、每条都有效", () => {
  assert.ok(SAFETY_CASES.length >= 10);
  assert.ok(SAFETY_CASES.some((c) => c.tool === "my_questions"));
  assert.equal(new Set(SAFETY_CASES.map((c) => c.id)).size, SAFETY_CASES.length);
  for (const c of SAFETY_CASES) {
    assert.ok(validators.has(c.tool), `${c.id}: 工具 ${c.tool} 不存在`);
    for (const s of c.removed)
      assert.ok(c.input.includes(s), `${c.id}: removed 的「${s}」不在 input 里，样例测不到东西`);
    assert.ok(c.removed.length || c.boundary, `${c.id}: 没有任何期望`);
  }
});
