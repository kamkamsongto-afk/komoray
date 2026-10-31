import { putObject } from "@/lib/r2";
import { currentUser } from "@/lib/supabase/server";

// Saves one batch from the preview's flight recorder (src/lib/debug-log.ts) to debug/ in R2.
// Signed-in users only, and capped in size, since anyone can open a page with ?debug=1.
const MAX_BYTES = 512 * 1024;

export async function POST(request: Request) {
	const { user } = await currentUser().catch(() => ({ user: null }));
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	const text = await request.text();
	if (text.length > MAX_BYTES) return Response.json({ error: "Too big" }, { status: 413 });
	let body: { session?: unknown; part?: unknown };
	try {
		body = JSON.parse(text);
	} catch {
		return Response.json({ error: "Not JSON" }, { status: 400 });
	}
	const session = String(body.session ?? "none").replace(/[^a-z0-9-]/gi, "").slice(0, 16);
	const part = String(Number(body.part) || 0).padStart(3, "0");
	const record = { email: user.email, at: new Date().toISOString(), browser: request.headers.get("user-agent"), ...body };
	await putObject(`debug/${record.at.slice(0, 10)}-${session}-${part}.json`, JSON.stringify(record), "application/json");
	return Response.json({ ok: true });
}
