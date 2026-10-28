// 两个 prompt 只返回提示词模板，服务端不调用模型（docs/mcp.md「工具」）。
import type { PromptDefinition } from "./types.ts";

export const PROMPTS: readonly PromptDefinition[] = [
  {
    name: "daily_digest",
    title: "今日推荐",
    description: "读取最近的公开更新和最新日报，结合用户当前任务推荐最多 3 条内容。",
    arguments: [],
  },
  {
    name: "deep_dive",
    title: "深入一个问题",
    description: "围绕一个问题检索、阅读并比较相关证据。",
    arguments: [{ name: "question", description: "要深入的问题，非空字符串", required: true }],
  },
];
