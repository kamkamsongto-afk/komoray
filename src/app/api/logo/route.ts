import { logoKey, logoType, MAX_LOGO_BYTES } from "@/lib/logo";
import { deleteObject, fetchObject, putObject } from "@/lib/r2";
import { currentUser } from "@/lib/supabase/server";

// The signed-in user's logo picture (lib/logo.ts).
//   GET              the picture itself, for the preview (?v= changes with every upload)
//   POST (the file)  check it, save it → { version }
//   DELETE           remove it
export async function GET() {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	const res = await fetchObject(logoKey(user.id));
	if (!res.ok) return new Response("Not found", { status: 404 });
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
	await putObject(logoKey(user.id), bytes, type);
	return Response.json({ version: Date.now() });
}

export async function DELETE() {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	await deleteObject(logoKey(user.id));
	return Response.json({ ok: true });
}
