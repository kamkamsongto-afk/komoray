import { getCloudflareContext } from "@opennextjs/cloudflare";
import { putObject } from "@/lib/r2";
import { storageCleanup } from "@/lib/storage-cleanup";

// The daily storage clean-up (lib/storage-cleanup.ts), called once a day by modal_app/cron.py with the shared secret
// CRON_SECRET (a Worker secret, and a Modal secret on the caller's side). Two locks before anything is deleted:
// the call asks for it ({ apply: true }) AND the site allows it (STORAGE_CLEANUP = "on", a Worker secret the coach decides
// on after reading the reports). Otherwise it only reports. Every run's report is kept in logs/storage-cleanup/.
type CronEnv = { CRON_SECRET?: string; STORAGE_CLEANUP?: string };

async function same(a: string, b: string) {
	const enc = new TextEncoder();
	const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
	const p = new Uint8Array(x), q = new Uint8Array(y);
	let diff = 0;
	for (let i = 0; i < p.length; i++) diff |= p[i] ^ q[i];
	return diff === 0;
}

export async function POST(request: Request) {
	const env = getCloudflareContext().env as unknown as CronEnv;
	const given = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
	if (!env.CRON_SECRET || !given || !(await same(given, env.CRON_SECRET))) return Response.json({ error: "Not allowed" }, { status: 403 });
	const body = (await request.json().catch(() => ({}))) as { apply?: unknown };
	const apply = body.apply === true && env.STORAGE_CLEANUP === "on";
	const report = await storageCleanup(apply);
	await putObject(`logs/storage-cleanup/${report.at}.json`, JSON.stringify(report, null, 2), "application/json").catch(() => {});
	return Response.json(report);
}
