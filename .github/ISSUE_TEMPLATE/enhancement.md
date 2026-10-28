---
name: 功能建议
about: 新工具、新参数、新返回字段，或文档的改进。
title: "<工具或模块>：<一句话说明想要什么>"
labels: ["enhancement"]
---

<!--
填写前阅读 [贡献指南](../../CONTRIBUTING.md)。仓库会公开，不贴真实内容。
夹夹 MCP 只读、不调用模型、不做批量导出，这些边界见 docs/mcp.md「边界」。
只是改进文档（README、docs/ 下的文档）时，把标签换成 documentation，「契约影响」写「无」。
-->

## 想解决什么
<!-- 你的 agent 现在做不到什么，具体场景 -->

## 建议的做法
<!-- 新工具 / 新可选参数 / 新返回字段。改已有参数或字段的含义属于不兼容变更，只能新增工具 -->

## 契约影响
<!-- 兼容变更 / 需要新工具替代旧工具 / 不确定 -->

## 验收条件
- [ ] docs/mcp.md 和 `src/contract/` 已更新，`npm run check:contract`、`npm run check:compat` 通过
- [ ] <具体行为>
