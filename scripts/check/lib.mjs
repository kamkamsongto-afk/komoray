// The web code as it is (src/lib), turned into plain JavaScript in memory, for the checks. Nothing is written.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const need = createRequire(join(repo, "package.json"));
export const ts = need("typescript");

const loaded = new Map();
export function lib(file) {
	const path = resolve(repo, /\.(ts|json)$/.test(file) ? file : `${file}.ts`);
	if (path.endsWith(".json")) return JSON.parse(readFileSync(path, "utf8"));
	if (loaded.has(path)) return loaded.get(path).exports;
	const module = { exports: {} };
	loaded.set(path, module);
	const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
	const requireHere = (name) => (name.startsWith("@/") ? lib(`src/${name.slice(2)}`) : name.startsWith(".") ? lib(join(dirname(path), name)) : need(name));
	new Function("module", "exports", "require", code)(module, module.exports, requireHere);
	return module.exports;
}
