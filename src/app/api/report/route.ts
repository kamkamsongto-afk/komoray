import { putObject } from "@/lib/r2";
import { currentUser } from "@/lib/supabase/server";

// The upload page sends errors that only the browser sees (e.g. an upload dropping halfway),
// so they show up on the admin page next to the server-side ones.
// The phone page reports without signing in, so anyone may call this: only our own pages (Origin), only small reports.
const clip = (value: unknown, max: number) => String(value ?? "").slice(0, max);
const MAX_BYTES = 8 * 1024;

export async function POST(request: Request) {
	if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Not allowed" }, { status: 403 });
	if (Number(request.headers.get("content-length")) > MAX_BYTES) return Response.json({ error: "Too big" }, { status: 413 });
	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const at = new Date().toISOString();
	const { user } = await currentUser().catch(() => ({ user: null }));
	const report = {
		email: user?.email ?? "",
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
