// npm run check: both sets of checks, each run to the end even when the other fails.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const results = ["rules.mjs", "run.mjs"].map((file) => spawnSync(process.execPath, [join(here, file)], { stdio: "inherit" }).status);
process.exit(results.some((status) => status !== 0) ? 1 : 0);
