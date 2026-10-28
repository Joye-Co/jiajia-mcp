// 从 src/contract 写出 schema/tools.json 和 schema/prompts.json。
// --check 只比对、不写，生成文件过期时失败（CI 的 schema job）。
// 生成文件要提交：评审时能看到契约的 diff，check:compat 也靠它取到上一个版本。
import fs from "node:fs";
import { MEMBER_ONLY_TOOLS, PROMPTS, TOOLS } from "../src/index.ts";

const outputs: Record<string, unknown> = {
  "schema/tools.json": { tools: TOOLS, memberOnly: MEMBER_ONLY_TOOLS },
  "schema/prompts.json": { prompts: PROMPTS },
};

const check = process.argv.includes("--check");
const stale: string[] = [];
for (const [path, value] of Object.entries(outputs)) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  const current = fs.existsSync(path) ? fs.readFileSync(path, "utf8") : null;
  if (current === text) continue;
  if (check) stale.push(path);
  else fs.writeFileSync(path, text);
}
if (stale.length) {
  console.error(`${stale.join("、")} 和 src/contract 不一致，运行 npm run schema:build 后提交`);
  process.exit(1);
}
console.log(check ? "schema 是最新的" : "schema 已写出");
