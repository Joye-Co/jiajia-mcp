// 包的公开入口：服务端和测试从这里取工具定义、兼容清单和安全样例。
// 不依赖构建产物的调用方（比如 git 依赖）直接读 schema/*.json，内容相同。
import { readFileSync } from "node:fs";

export { CONTENT_NOTICE } from "./contract/parts.ts";
export { PROMPTS } from "./contract/prompts.ts";
export { TOOLS } from "./contract/tools.ts";
export type { ErrorCode, JsonSchema, PromptDefinition, ToolDefinition } from "./contract/types.ts";
export { ERROR_CODES } from "./contract/types.ts";

// 用户侧支持 Node 20，不用 JSON 导入属性；src/ 和 dist/ 都在仓库根目录下一层，同一个相对路径能找到 schema/。
const readSchema = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../schema/${name}`, import.meta.url), "utf8"));

export const COMPAT = readSchema("compat.json") as { readonly protocolVersions: readonly string[] };

export type SafetyCase = {
  readonly id: string;
  readonly tool: string;
  readonly rule: string;
  readonly input: string;
  readonly removed: readonly string[];
  readonly boundary: boolean;
};
export const SAFETY_CASES = (readSchema("safety-cases.json") as { cases: SafetyCase[] }).cases as readonly SafetyCase[];
