import { putObject } from "@/lib/r2";

// The upload page sends errors that only the browser sees (e.g. an upload dropping halfway),
// so they show up on the admin page next to the server-side ones.
const clip = (value: unknown, max: number) => String(value ?? "").slice(0, max);

export async function POST(request: Request) {
	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const at = new Date().toISOString();
	const report = {
		at,
		stage: clip(body.stage, 40),
		error: clip(body.error, 500),
		key: clip(body.key, 200),
		filename: clip(body.filename, 200),
		size: Number(body.size) || 0,
		browser: clip(request.headers.get("user-agent"), 300),
	};
	await putObject(`logs/${at}-${crypto.randomUUID().slice(0, 8)}.json`, JSON.stringify(report), "application/json");
	return Response.json({ ok: true });
}
