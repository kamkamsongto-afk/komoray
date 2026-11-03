import { exists, getJson, listObjects, putObject } from "@/lib/r2";
import { currentUser, isAdmin } from "@/lib/supabase/server";

// People waiting for access, one file each at waitlist/<hash of the email>.json (signing up twice changes nothing).
//   POST { email, website }  from the home page. website is a field people never see: only bots fill it in.
//   GET                      for the admin: { people: [{ email, at }] }
const MAX_BODY = 1024;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SHOW = 1000;

async function hash(text: string) {
	const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
	return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request) {
	if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Not allowed" }, { status: 403 });
	if (Number(request.headers.get("content-length")) > MAX_BODY) return Response.json({ error: "Too big" }, { status: 413 });
	const body = (await request.json().catch(() => ({}))) as { email?: unknown; website?: unknown };
	if (body.website) return Response.json({ ok: true }); // a bot: looks fine to it, nothing is saved
	const email = String(body.email ?? "").trim().toLowerCase();
	if (email.length > 254 || !EMAIL.test(email)) return Response.json({ error: "Please enter a valid email address" }, { status: 400 });
	const key = `waitlist/${await hash(email)}.json`;
	if (!(await exists(key))) await putObject(key, JSON.stringify({ email, at: new Date().toISOString() }), "application/json");
	return Response.json({ ok: true });
}

export async function GET() {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	if (!isAdmin(user.email)) return Response.json({ error: "This page is for the Komoray team only" }, { status: 403 });
	const files = (await listObjects("waitlist/")).sort((a, b) => b.lastModified.localeCompare(a.lastModified)).slice(0, SHOW);
	const people = await Promise.all(files.map((file) => getJson<{ email: string; at: string }>(file.key).catch(() => null)));
	return Response.json({ people: people.filter(Boolean) });
}
