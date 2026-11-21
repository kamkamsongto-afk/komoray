import { logoKey, logoType, logoVersion, MAX_LOGO_BYTES } from "@/lib/logo";
import { fetchObject, putIfAbsent } from "@/lib/r2";
import { currentUser } from "@/lib/supabase/server";

// The signed-in user's logo picture (lib/logo.ts).
//   GET ?v=          that version's own picture, for the preview (404 when it has no file: never another picture)
//   POST (the file)  check it, save it as a new file → { version } (never written over: lib/logo.ts)
export async function GET(request: Request) {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	// That version's own picture and nothing else (lib/logo.ts). Not found is said with no-store, so the browser asks again.
	const version = logoVersion(Number(new URL(request.url).searchParams.get("v")));
	const res = version ? await fetchObject(logoKey(user.id, version)) : null;
	if (!res?.ok) {
		await res?.body?.cancel(); // the 404 is not read
		return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
	}
	const type = res.headers.get("Content-Type") ?? "image/png";
	return new Response(res.body, { headers: { "Content-Type": type, "Cache-Control": "private, max-age=31536000, immutable" } });
}

export async function POST(request: Request) {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	const bytes = new Uint8Array(await request.arrayBuffer());
	if (!bytes.length || bytes.length > MAX_LOGO_BYTES) return Response.json({ error: "The logo must be 2 MB or smaller" }, { status: 400 });
	const type = logoType(bytes);
	if (!type) return Response.json({ error: "Please use a PNG, JPG or WebP picture" }, { status: 400 });
	// A file of its own: the other Brand Kits keep theirs.
	// Only if no file has this version yet: two uploads in the same millisecond never land in one file.
	const version = Date.now();
	if (!(await putIfAbsent(logoKey(user.id, version), bytes, type))) return Response.json({ error: "Please try again" }, { status: 409 });
	return Response.json({ version });
}
