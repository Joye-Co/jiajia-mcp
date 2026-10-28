import assert from "node:assert/strict";
import { test } from "node:test";
import { contractProblems } from "./check-contract.ts";

const tools = [
  { name: "search", inputSchema: { properties: { query: {}, cursor: {} }, required: ["query"] } },
  { name: "list_topics", inputSchema: { properties: {} } },
];
const prompts = [{ name: "deep_dive" }];

const doc = (rows: string, compat = "（空）", promptList = "- `deep_dive`：说明") => `
## 工具

| 工具 | 参数 | 返回 |
| --- | --- | --- |
${rows}

### prompt

${promptList}

### 兼容清单

${compat}

## 错误

| \`search\` 不在这张表里 | x | y |
`;

const goodRows = "| `search` | `query`（必填）、`cursor`（可选） | 摘要 |\n| `list_topics` | 无 | 目录 |";

test("文档和 schema 一致时没有问题", () => {
  assert.deepEqual(contractProblems({ doc: doc(goodRows), tools, prompts, protocolVersions: [] }), []);
  assert.deepEqual(
    contractProblems({ doc: doc(goodRows, "- `2026-07-28`"), tools, prompts, protocolVersions: ["2026-07-28"] }),
    [],
  );
});

test("漏写工具、漏写参数、必填没标出来、多出工具都会报", () => {
  const cases: [string, RegExp][] = [
    ["| `search` | `query`（必填）、`cursor` | x |", /没有 list_topics/],
    ["| `search` | `query`（必填） | x |\n| `list_topics` | 无 | x |", /cursor 没写进工具表/],
    ["| `search` | `query`、`cursor` | x |\n| `list_topics` | 无 | x |", /query 是必填/],
    [`${goodRows}\n| \`get_answer\` | \`id\`（必填） | x |`, /get_answer 不在 schema 里/],
  ];
  for (const [rows, expected] of cases) {
    const problems = contractProblems({ doc: doc(rows), tools, prompts, protocolVersions: [] });
    assert.ok(
      problems.some((p) => expected.test(p)),
      `${rows}\n${problems.join("\n")}`,
    );
  }
});

test("兼容清单和 prompt 不一致会报", () => {
  assert.match(
    contractProblems({ doc: doc(goodRows), tools, prompts, protocolVersions: ["2026-07-28"] }).join(),
    /兼容清单是/,
  );
  assert.match(
    contractProblems({ doc: doc(goodRows, ""), tools, prompts, protocolVersions: [] }).join(),
    /写一行「（空）」/,
  );
  assert.match(
    contractProblems({
      doc: doc(goodRows, "（空）", "- `daily_digest`：x"),
      tools,
      prompts,
      protocolVersions: [],
    }).join(),
    /prompt/,
  );
});
