// 公开仓库不能出现密钥值、个人信息或内部地址。扫描所有被 git 跟踪的文件。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RULES = [
  // 允许 jj_YOUR_KEY 这类占位符和测试里的 jj_test_ 开头的值。
  { name: "夹夹 key", pattern: /\bjj_(?!YOUR_KEY\b|test_)[A-Za-z0-9_-]{8,}/g },
  { name: "Bearer 令牌", pattern: /Bearer\s+(?!jj_YOUR_KEY\b|jj_test_|<key>|\$\{)[A-Za-z0-9._~+/-]{16,}/g },
  { name: "邮箱", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
  { name: "内网地址", pattern: /\b(10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})\b/g },
  { name: "Workers 预览域名", pattern: /\b[\w-]+\.workers\.dev\b/g },
  { name: "QQ 号", pattern: /\bQQ\s*[:：号]?\s*\d{5,11}\b/gi },
];

// 许可证原文里有 Creative Commons 的联系邮箱，不是我们的信息。
const ALLOWED = [{ file: "LICENSE-CONTENT", rule: "邮箱" }];

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const findings = [];
for (const file of files) {
  if (file === "package-lock.json") continue;
  const text = readFileSync(file, "utf8");
  for (const rule of RULES) {
    if (ALLOWED.some((entry) => entry.file === file && entry.rule === rule.name)) continue;
    for (const match of text.matchAll(rule.pattern)) {
      const line = text.slice(0, match.index).split("\n").length;
      findings.push(`${file}:${line} ${rule.name}：${match[0]}`);
    }
  }
}

if (findings.length > 0) {
  console.error(`发现可能不该公开的内容：\n${findings.map((line) => `- ${line}`).join("\n")}`);
  process.exit(1);
}
console.log(`检查了 ${files.length} 个文件，没有发现密钥、个人信息或内部地址`);
