// 发布到 npm 的包只能带 dist/、schema/、README、许可证和 package.json，必需的入口都要在。
// 先运行 npm run build。
import { execFileSync } from "node:child_process";

const ALLOWED = /^(?:package\.json|README\.md|LICENSE(?:-CONTENT)?|dist\/.+|schema\/.+\.json)$/;
const REQUIRED = [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/cli.js",
  "schema/tools.json",
  "schema/prompts.json",
  "schema/compat.json",
  "schema/safety-cases.json",
];

export function packProblems(paths: readonly string[]): string[] {
  return [
    ...paths.filter((p) => !ALLOWED.test(p)).map((p) => `包里不该有 ${p}`),
    ...REQUIRED.filter((p) => !paths.includes(p)).map((p) => `包里缺少 ${p}`),
    ...paths.filter((p) => /\.test\.|\.map$/.test(p)).map((p) => `包里不该有测试或 source map：${p}`),
  ];
}

if (import.meta.main) {
  const [pack] = JSON.parse(
    execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { encoding: "utf8" }),
  );
  const problems = packProblems(pack.files.map((f: { path: string }) => f.path));
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(`pack ok（${pack.files.length} 个文件，${pack.size} 字节）`);
}
