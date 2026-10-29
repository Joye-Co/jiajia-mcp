# 给 agent 的说明

人和 agent 共用 [CONTRIBUTING.md](CONTRIBUTING.md) 的流程。这份文件只写 agent 开工前最需要知道的事。

## 这个仓库是什么

夹夹把 QQ 群里审核、脱敏后的公开内容（答案、原始讨论、面经、日报周报、话题）通过 MCP 提供给用户自己的 agent（要登录，除 `ask` 外只读）。服务端在 `https://jiajia.fun/mcp`，**不在本仓库**。本仓库放的是：

1. **工具定义**：对外契约，随 npm 包 `jiajia-mcp` 发布，服务端依赖它。
2. **本地 stdio 转发**：给只支持 stdio 的客户端用。
3. **文档**：README（用户怎么接入）和契约。

## 先读什么

1. [docs/mcp.md](docs/mcp.md)：对外契约。改任何工具、参数、返回字段之前必读。
2. [docs/design.md](docs/design.md)：代码规范、转发程序的不变量和已经做过的决定。和 Issue 或 PR 里的说法不一致时，以文档为准。
3. [CONTRIBUTING.md](CONTRIBUTING.md)：Issue、分支、PR 和验证记录。

## 代码地图

| 路径 | 负责什么 | 改了以后 |
| --- | --- | --- |
| `src/contract/` | 10 个工具和 2 个 prompt 的定义，共用片段在 `parts.ts` | 先改 docs/mcp.md；运行 `npm run schema:build`，提交生成的 `schema/tools.json`、`schema/prompts.json`；补 `test/fixtures/results.json` |
| `src/index.ts` | 包的公开入口：工具定义、兼容清单、安全样例 | 导出变了算包的接口变更，写进 PR 的「契约影响」 |
| `src/bridge.ts`、`src/cli.ts` | 本地 stdio 转发 | 守住 docs/design.md「转发程序的不变量」；在 `test/bridge.test.ts` 或 `test/cli.test.ts` 补用例 |
| `schema/tools.json`、`schema/prompts.json` | 生成文件，不手改 | 由 `npm run schema:build` 写出 |
| `schema/compat.json` | 兼容的协议版本清单 | 同时改 docs/mcp.md「兼容清单」 |
| `schema/safety-cases.json` | 注入和脱敏的共享样例，只用合成数据 | 至少 10 条、至少 1 条走 `my_questions`；`removed` 里的每一项都要出现在 `input` 里 |
| `server.json` | MCP registry 元数据 | 名字和版本要和 `package.json` 一致（`npm run validate:server-json`） |
| `scripts/` | 生成 schema 和各项检查，带 `.test.ts` 的检查都有反例测试 | 新增检查时一起加它应该拦下的样例 |
| `scripts/tool-removals.json` | 到期删除的工具登记 | 只在删除工具的 PR 里改 |

## 命令

开发用 Node 24 和 npm。用户侧的 `engines` 是 `>=20`，由 CI 最后的 Node 20 冒烟测试守住。

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run check:schema
npm run check:contract
npm run check:compat
npm run build && npm run check:pack
npm run validate:server-json
npm run check:secrets
```

改了 `src/contract/` 以后先运行 `npm run schema:build`。

## 规则

- **契约先行**：先改 docs/mcp.md，再改 `src/contract/`，服务端最后跟进。
- **不兼容变更不在原工具上做**：新增一个工具，旧工具保留至少 30 天，在说明里写出替代者（docs/mcp.md「版本规则」）。
- **只用合成数据**：测试、文档、Issue 和 PR 里都不放真实群聊内容、昵称、QQ 号、手机号、邮箱或 key。
- **不写服务端的内部信息**：不写内部路径、内部服务名或存储细节。需要服务端配合时，在 PR 的「契约影响」里用文字说明。
- **只写实际跑过的命令**：PR 里不写没运行过的检查结果。

## 不要做

- 不要手改 `schema/tools.json`、`schema/prompts.json`。
- 不要给转发程序加运行时依赖（docs/design.md「代码规范」）。
- 不要在 `src/` 里用 Node 20 没有的 API：发布出去的 `dist/` 要在 Node 20 上运行。
- 不要连真实的 `/mcp` 做测试，转发测试用 `test/fake-server.ts`。
- 不要在 commit 或 PR 里放 agent 会话链接。
