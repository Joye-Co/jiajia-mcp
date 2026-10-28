// docs/mcp.md 和 schema 必须说的是同一件事：
// - 「工具」一节的第一张表恰好列出 TOOLS 里的工具，每个参数都出现在该行，必填参数写成 `参数`（必填）。
// - 「prompt」一节列出的名字和 PROMPTS 一致。
// - 「兼容清单」列出的版本和 schema/compat.json 一致，清单为空时写「（空）」。
// 只做从 schema 到文档的单向核对：文档里多写的说明文字不检查。
import fs from "node:fs";
import { COMPAT, PROMPTS, TOOLS } from "../src/index.ts";

type Tool = { readonly name: string; readonly inputSchema: { readonly [key: string]: unknown } };
type Named = { readonly name: string };

function section(doc: string, heading: string): string[] {
  const lines = doc.split("\n");
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) return [];
  const level = heading.match(/^#+/)?.[0].length ?? 2;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => {
    const hashes = line.match(/^(#+)\s/)?.[1];
    return hashes !== undefined && hashes.length <= level;
  });
  return end < 0 ? rest : rest.slice(0, end);
}

function firstTable(lines: readonly string[]): string[] {
  const start = lines.findIndex((line) => line.startsWith("|"));
  if (start < 0) return [];
  const rest = lines.slice(start);
  const end = rest.findIndex((line) => !line.startsWith("|"));
  return end < 0 ? rest : rest.slice(0, end);
}

const backticked = (line: string) => [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? "");

export function contractProblems(input: {
  readonly doc: string;
  readonly tools: readonly Tool[];
  readonly prompts: readonly Named[];
  readonly protocolVersions: readonly string[];
}): string[] {
  const problems: string[] = [];
  const where = "docs/mcp.md";

  const rows = new Map<string, string>();
  for (const line of firstTable(section(input.doc, "## 工具")).slice(2)) {
    const [, first = "", params = ""] = line.split("|");
    const name = backticked(first)[0];
    if (name) rows.set(name, params);
  }
  if (!rows.size) problems.push(`${where}: 找不到「## 工具」一节的工具表`);
  for (const tool of input.tools) {
    const params = rows.get(tool.name);
    if (params === undefined) {
      problems.push(`${where}: 工具表里没有 ${tool.name}`);
      continue;
    }
    const properties = Object.keys((tool.inputSchema.properties as object | undefined) ?? {});
    const required = (tool.inputSchema.required as string[] | undefined) ?? [];
    for (const p of properties) {
      if (!backticked(params).includes(p)) problems.push(`${where}: ${tool.name} 的参数 ${p} 没写进工具表`);
    }
    for (const p of required) {
      if (!params.includes(`\`${p}\`（必填）`))
        problems.push(`${where}: ${tool.name} 的 ${p} 是必填，工具表里要写成 \`${p}\`（必填）`);
    }
  }
  for (const name of rows.keys()) {
    if (!input.tools.some((tool) => tool.name === name)) problems.push(`${where}: 工具表里的 ${name} 不在 schema 里`);
  }

  const promptNames = section(input.doc, "### prompt").flatMap((line) => line.match(/^- `([^`]+)`/)?.[1] ?? []);
  const expectedPrompts = input.prompts.map((p) => p.name);
  if (promptNames.join() !== expectedPrompts.join()) {
    problems.push(
      `${where}: 「### prompt」列出 ${promptNames.join("、") || "（无）"}，schema 是 ${expectedPrompts.join("、")}`,
    );
  }

  const compat = section(input.doc, "### 兼容清单");
  const listed = compat.flatMap((line) => line.match(/^- `([^`]+)`/)?.[1] ?? []);
  const expected = [...input.protocolVersions];
  if (!compat.length) problems.push(`${where}: 找不到「### 兼容清单」一节`);
  else if (listed.join() !== expected.join()) {
    problems.push(
      `${where}: 兼容清单是 ${listed.join("、") || "（空）"}，schema/compat.json 是 ${expected.join("、") || "（空）"}`,
    );
  } else if (!expected.length && !compat.some((line) => line.includes("（空）"))) {
    problems.push(`${where}: 兼容清单为空时写一行「（空）」`);
  }
  return problems;
}

if (import.meta.main) {
  const problems = contractProblems({
    doc: fs.readFileSync("docs/mcp.md", "utf8"),
    tools: TOOLS,
    prompts: PROMPTS,
    protocolVersions: COMPAT.protocolVersions,
  });
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log("docs/mcp.md 和 schema 一致");
}
