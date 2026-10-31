import { fontKeys, type OwnFont, readFontInfo } from "@/lib/font-info";
import { deleteObject, fetchObject, getJson, putObject } from "@/lib/r2";
import { currentUser } from "@/lib/supabase/server";

// The signed-in user's own subtitle font (one per account; a new upload replaces it).
// Kept in R2 at fonts/<user id>/font (the file) and font.json (its name and height).
//   GET              { font: { family, height, version } | null }
//   GET ?file=1      the font file itself, for the preview
//   POST (the file)  check it, save it → { font }
//   DELETE           remove it
const MAX_BYTES = 5 * 1024 * 1024;

export async function GET(request: Request) {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	const keys = fontKeys(user.id);
	if (new URL(request.url).searchParams.has("file")) {
		const res = await fetchObject(keys.file);
		if (!res.ok) return new Response("Not found", { status: 404 });
		// The address changes with every upload (?v=), so the browser may keep it.
		return new Response(res.body, { headers: { "Content-Type": "font/ttf", "Cache-Control": "private, max-age=31536000, immutable" } });
	}
	return Response.json({ font: await getJson<OwnFont>(keys.info) });
}

export async function POST(request: Request) {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	const bytes = new Uint8Array(await request.arrayBuffer());
	if (!bytes.length || bytes.length > MAX_BYTES) return Response.json({ error: "The font must be 5 MB or smaller" }, { status: 400 });
	const info = readFontInfo(bytes);
	if (!info) return Response.json({ error: "This isn't a .ttf or .otf font we can use" }, { status: 400 });
	const keys = fontKeys(user.id);
	const font: OwnFont = { ...info, version: Date.now() };
	await putObject(keys.file, bytes, "font/ttf");
	await putObject(keys.info, JSON.stringify(font), "application/json");
	return Response.json({ font });
}

export async function DELETE() {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	const keys = fontKeys(user.id);
	await Promise.all([deleteObject(keys.file), deleteObject(keys.info)]);
	return Response.json({ ok: true });
}
