// 工具和 prompt 的定义形状，对应 MCP 的 tools/list 与 prompts/list。
// 生成的 schema/*.json 由 scripts/build-schema.ts 从这里的值写出：共用片段只写一次，生成的 JSON 提交进仓库，评审时能看到契约的 diff。

export type JsonSchema = { readonly [key: string]: unknown };

export type ToolAnnotations = {
  readonly readOnlyHint: true;
  readonly destructiveHint: false;
  readonly idempotentHint: true;
  readonly openWorldHint: false;
};

export type ToolDefinition = {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly outputSchema: JsonSchema;
  readonly annotations: ToolAnnotations;
};

export type PromptDefinition = {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly arguments: readonly { readonly name: string; readonly description: string; readonly required: boolean }[];
};

export const ERROR_CODES = ["invalid_params", "not_found", "site_closed", "rate_limited", "unavailable"] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
