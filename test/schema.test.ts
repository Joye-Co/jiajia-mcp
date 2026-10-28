import assert from "node:assert/strict";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { ERROR_CODES, MEMBER_ONLY_TOOLS, PROMPTS, SAFETY_CASES, TOOLS } from "../src/index.ts";
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

test("工具名唯一、是 snake_case，群友专用工具都存在", () => {
  const names = TOOLS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
  for (const name of names) assert.match(name, /^[a-z][a-z_]*$/);
  for (const name of MEMBER_ONLY_TOOLS) assert.ok(names.includes(name), name);
  assert.deepEqual(
    PROMPTS.map((p) => p.name),
    ["daily_digest", "deep_dive"],
  );
});

test("所有工具都标成只读、幂等、非破坏、不访问外部世界", () => {
  for (const tool of TOOLS) {
    assert.deepEqual(
      tool.annotations,
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      tool.name,
    );
  }
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
  ];
  for (const [label, value] of cases) assert.ok(!output(JSON.parse(JSON.stringify(value))), label);
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
