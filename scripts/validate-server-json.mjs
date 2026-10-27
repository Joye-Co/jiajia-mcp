// 按 server.json 自己声明的 $schema 校验，并核对它和 package.json 的名字、版本一致。
import { readFileSync } from "node:fs";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const read = (file) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
const server = read("server.json");
const pkg = read("package.json");

const response = await fetch(server.$schema);
if (!response.ok) throw new Error(`下载 schema 失败：HTTP ${response.status} ${server.$schema}`);
const schema = await response.json();

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const errors = [];
if (!ajv.validate(schema, server)) {
  for (const error of ajv.errors ?? []) errors.push(`${error.instancePath || "/"} ${error.message}`);
}

const npmPackage = server.packages?.find((entry) => entry.registryType === "npm");
if (pkg.mcpName !== server.name)
  errors.push(`package.json 的 mcpName（${pkg.mcpName}）和 server.json 的 name（${server.name}）不一致`);
if (server.version !== pkg.version)
  errors.push(`server.json 的 version（${server.version}）和 package.json（${pkg.version}）不一致`);
if (npmPackage?.identifier !== pkg.name) errors.push(`npm 包名应为 ${pkg.name}`);
if (npmPackage?.version !== pkg.version) errors.push(`packages 里 npm 包的 version 应为 ${pkg.version}`);

if (errors.length > 0) {
  console.error(`server.json 校验失败：\n${errors.map((line) => `- ${line}`).join("\n")}`);
  process.exit(1);
}
console.log(`server.json 通过校验（${server.$schema}）`);
