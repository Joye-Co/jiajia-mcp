# 贡献指南

本指南适用于人和 agent。开工前先读本文件和 [AGENTS.md](AGENTS.md)，再读对应的 Issue / PR 模板。通过 CLI、API 或自动化创建 Issue 和 PR 时，也按模板的结构填写，替换占位符，不发布模板注释，不虚构验证结果。

## 工作顺序

1. 确认 Issue 已经排期，再读关联 Issue、[docs/mcp.md](docs/mcp.md) 和相关代码，记下用于定位和验证的 commit 基线。
2. 需要新建 Issue 时按下表选模板，写清证据、目标和验收条件。
3. 按 Issue 范围建分支，先补测试再实现；具体缺陷先用失败测试复现。
4. 运行与改动相关的检查，记录实际结果、未运行项及原因；新的或改变的设计决策写进 [docs/design.md](docs/design.md)。
5. 按 PR 模板填写描述，关联 Issue，写明契约影响。

## Issue

| 模板 | 什么时候用 |
| --- | --- |
| 缺陷报告 | 可复现或从源码能确认的错误行为 |
| 功能建议 | 新工具、新参数、新返回字段，或文档的改进 |
| 客户端兼容报告 | 在某个客户端里接入成功或失败的实测记录 |

- 没有排期的 Issue 不开工。维护者把 Issue 指派给了人，或者在 Issue 里留言确认要做，才算已排期；想认领一个 Issue，先在下面留言，等维护者确认。需要维护者决定的问题，在 Issue 里写清有哪些选项、推荐哪个、能不能撤回。
- 安全问题（过滤被绕过、个人信息泄露、key 泄露）不开公开 Issue，按 [SECURITY.md](SECURITY.md) 报告。

### 证据与脱敏

仓库会公开，Issue 和 PR 所有人都看得到。

- 不贴工具返回的原文。需要举例时，改写成合成内容，或者只给内容 id 和工具名，由维护者在服务端查。
- 不贴 key、QQ 号、手机号、邮箱、群名、昵称、本机路径。
- 维护者发现 Issue 或评论里有个人信息时，直接编辑删掉，并在评论里说明删了什么类别的信息。

## 分支与 PR

- 分支命名为 `fix/<issue>-<slug>`、`feat/<issue>-<slug>`、`docs/<issue>-<slug>`、`test/<issue>-<slug>`、`ci/<issue>-<slug>` 或 `chore/<issue>-<slug>`。
- 一个 Issue 对应一个 PR，base 为 `main`。完成 Issue 时写 `Closes #<issue>`，只完成一部分时写 `Refs #<issue>`。
- PR 描述里的「契约影响」写明：工具定义有没有变、是不是兼容变更、服务端要不要跟着改。不兼容变更必须是新增工具，见 docs/mcp.md「版本规则」。
- commit message 和 PR 描述里不放 agent 会话链接。

### 改契约的顺序

1. 改 docs/mcp.md 里对应的说明和表格。
2. 改 `src/contract/`，运行 `npm run schema:build`，提交生成的 `schema/*.json`。
3. 补 `test/fixtures/results.json` 的合成返回；新增引导句时在 docs/design.md「工具说明里的引导句」加一行。
4. 运行 `npm run check:contract` 和 `npm run check:compat`。`check:compat` 报出不兼容变更时，改成新增工具，不要绕过检查。
5. 发版以后，服务端升级依赖、按新 schema 实现。

## 验证与结果记录

检查命令以 [package.json](package.json) 和 [CI 工作流](.github/workflows/ci.yml) 为准，常用的列在 AGENTS.md「命令」。

- 代码改动运行 `npm run lint`、`npm run typecheck` 和 `npm test`；改了契约再运行 `check:schema`、`check:contract`、`check:compat`；所有改动都运行 `check:secrets`。
- 缺陷修复用合成数据写离线回归测试，记录修复前失败、修复后通过的用例。
- PR 里只填写实际运行过的命令和结果，写明新增或修改的测试及用例数。没运行的检查写明原因，列进「需要确认」，不要笼统写「全绿」。
- 转发程序的改动在 `test/fake-server.ts` 上测；涉及真实客户端时，用 MCP Inspector 或对应客户端手动连一次，结果写进「需要确认」。

## 文档怎么写

接手的人和 agent 只能读到仓库里的内容。Issue、PR 评论和聊天记录会过时，所以决定必须写进仓库；代码本身能说清楚的，就不要再写一遍。

- **能用测试或检查守住的约束，写成测试或检查。** 文档只说明为什么有这条检查。
- **决定写在 docs/design.md（实现）或 docs/mcp.md（对外约定）的「决定」小节**，按这个顺序写：日期和来源（维护者或 Issue 编号）、决定、理由、放弃的方案、重新评估的条件。决定改了就直接改文档，写一句它替代了哪个旧决定、为什么改。
- **容易被顺手改掉的代码**，加一行注释指向文档的对应小节，格式如 `见 docs/design.md「转发程序的不变量」`。
- **外部事实（协议版本、客户端版本、限额）注明查询日期和来源链接。**
- **新增文档要在 [docs/README.md](docs/README.md) 里加一行。**
- **不写**：逐个函数复述代码、变更历史和进度（分别由 git 和 Issue 记录）。
