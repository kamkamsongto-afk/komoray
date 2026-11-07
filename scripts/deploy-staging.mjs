// Puts the current branch on staging.komoray.com (the test site). The live site is untouched.
// Builds with NEXT_PUBLIC_KOMORAY_STAGE=staging (the test database, the STAGING label), then deploys the
// "staging" part of wrangler.jsonc (its own Worker, bucket and Modal app). Works on Windows and Linux.
// If render.py changed, first: KOMORAY_RENDER_APP=komoray-render-staging python -m modal deploy modal_app/render.py
import { spawnSync } from "node:child_process";

const env = { ...process.env, NEXT_PUBLIC_KOMORAY_STAGE: "staging" };
for (const args of [["opennextjs-cloudflare", "build"], ["opennextjs-cloudflare", "deploy", "--env", "staging"]]) {
	const run = spawnSync("npx", args, { env, stdio: "inherit", shell: process.platform === "win32" });
	if (run.status !== 0) process.exit(run.status ?? 1);
}
