// 对比上一个发布 tag 的 schema/tools.json，按 docs/mcp.md「版本规则」找出不兼容变更。
// 不兼容的改动不在原工具上做：新增一个工具，旧工具保留至少 30 天，在它的说明里写出替代者，
// 到期后才能删，删的时候在 scripts/tool-removals.json 登记。
// 检查不了的：默认行为变了但 schema 没变（例如「不传 kind」查的范围），这类靠评审。
import { execFileSync } from "node:child_process";
import fs from "node:fs";

type Schema = { readonly [key: string]: unknown };
type Tool = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Schema;
  readonly outputSchema: Schema;
};
export type Removal = { readonly tool: string; readonly replacement: string; readonly deprecatedSince: string };

const DEPRECATION_DAYS = 30;

const types = (s: Schema): string[] =>
  s.type === undefined ? [] : ([] as string[]).concat(s.type as string | string[]);
const record = (v: unknown): Record<string, Schema> =>
  v && typeof v === "object" ? (v as Record<string, Schema>) : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function compare(a: Schema, b: Schema, path: string, mode: "input" | "output", out: string[]): void {
  const [ta, tb] = [types(a), types(b)];
  if (mode === "input" && ta.some((t) => !tb.includes(t))) out.push(`${path}: 参数类型收窄（${ta} → ${tb}）`);
  if (mode === "output" && tb.some((t) => !ta.includes(t)) && ta.length)
    out.push(`${path}: 返回类型放宽（${ta} → ${tb}）`);
  if (!same(a.const, b.const)) out.push(`${path}: const 变了`);

  // 返回里的枚举只能加值：调用方要能容忍不认识的值，比如以后新增的错误码。
  const [ea, eb] = [list(a.enum), list(b.enum)];
  if (ea.length && ea.some((v) => !eb.includes(v)))
    out.push(`${path}: 去掉了取值 ${ea.filter((v) => !eb.includes(v)).join("、")}`);

  if (mode === "input") {
    for (const key of [
      "pattern",
      "minLength",
      "maxLength",
      "minimum",
      "maximum",
      "default",
      "additionalProperties",
    ] as const) {
      if (!same(a[key], b[key])) out.push(`${path}: ${key} 变了（参数的取值范围和默认行为不能改）`);
    }
  }

  const [pa, pb] = [record(a.properties), record(b.properties)];
  const [ra, rb] = [list(a.required) as string[], list(b.required) as string[]];
  for (const [name, before] of Object.entries(pa)) {
    const after = pb[name];
    if (!after) out.push(`${path}.${name}: 删掉了`);
    else compare(before, after, `${path}.${name}`, mode, out);
  }
  if (mode === "input")
    for (const name of rb.filter((n) => !ra.includes(n))) out.push(`${path}.${name}: 新增必填或改成必填`);
  if (mode === "output")
    for (const name of ra.filter((n) => !rb.includes(n))) out.push(`${path}.${name}: 不再保证返回`);

  if (a.items && typeof a.items === "object")
    compare(a.items as Schema, (b.items as Schema | undefined) ?? {}, `${path}[]`, mode, out);
  for (const [i, branch] of list(a.oneOf).entries()) {
    compare(branch as Schema, (list(b.oneOf)[i] as Schema | undefined) ?? {}, `${path}<${i}>`, mode, out);
  }
}

export function breakingChanges(
  prev: readonly Tool[],
  next: readonly Tool[],
  removals: readonly Removal[],
  today: string,
): string[] {
  const out: string[] = [];
  for (const old of prev) {
    const now = next.find((t) => t.name === old.name);
    if (now) {
      compare(old.inputSchema, now.inputSchema, `${old.name}.input`, "input", out);
      compare(old.outputSchema, now.outputSchema, `${old.name}.output`, "output", out);
      continue;
    }
    const removal = removals.find((r) => r.tool === old.name);
    if (!removal) {
      out.push(`${old.name}: 删除了工具，没有在 tool-removals.json 登记`);
      continue;
    }
    const due = new Date(Date.parse(removal.deprecatedSince) + DEPRECATION_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    if (today < due) out.push(`${old.name}: ${removal.deprecatedSince} 才标记替代，${due} 之后才能删`);
    if (!next.some((t) => t.name === removal.replacement))
      out.push(`${old.name}: 替代者 ${removal.replacement} 不存在`);
    if (!old.description.includes(removal.replacement))
      out.push(`${old.name}: 删除前的说明里没有写出替代者 ${removal.replacement}`);
  }
  return out;
}

if (import.meta.main) {
  let tag: string;
  try {
    // 从 HEAD^ 往回找：推送 tag 发版时 HEAD 自己就带着新 tag，和自己比永远通过。
    // 只和正式 tag 比，跳过 v0.1.0-rc.1 这类预发布 tag：预发布期间字段名还会改（docs/mcp.md「版本规则」）。
    tag = execFileSync("git", ["describe", "--tags", "--abbrev=0", "--match", "v*", "--exclude", "v*-*", "HEAD^"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    console.log("还没有发布过的正式 v* tag，跳过 schema 兼容检查");
    process.exit(0);
  }
  const prev = JSON.parse(execFileSync("git", ["show", `${tag}:schema/tools.json`], { encoding: "utf8" }))
    .tools as Tool[];
  const next = JSON.parse(fs.readFileSync("schema/tools.json", "utf8")).tools as Tool[];
  const removals = JSON.parse(fs.readFileSync("scripts/tool-removals.json", "utf8")).removals as Removal[];
  const problems = breakingChanges(prev, next, removals, new Date().toISOString().slice(0, 10));
  if (problems.length) {
    console.error(`和 ${tag} 相比有不兼容变更（docs/mcp.md「版本规则」）：\n${problems.join("\n")}`);
    process.exit(1);
  }
  console.log(`和 ${tag} 相比没有不兼容变更`);
}
