import { logoKey, logoType, logoVersion, MAX_LOGO_BYTES } from "@/lib/logo";
import { deleteObject, fetchObject, putObject } from "@/lib/r2";
import { currentUser } from "@/lib/supabase/server";

// The signed-in user's logo picture (lib/logo.ts).
//   GET              the picture itself, for the preview (?v= changes with every upload)
//   POST (the file)  check it, save it → { version }
//   DELETE           remove it
export async function GET(request: Request) {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	// That version's own picture; one from before logos had versions is the old single file (lib/logo.ts).
	const version = logoVersion(Number(new URL(request.url).searchParams.get("v")));
	let res = version ? await fetchObject(logoKey(user.id, version)) : null;
	if (!res?.ok) res = await fetchObject(logoKey(user.id));
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
	// A file of its own: the other Brand Kits keep theirs.
	const version = Date.now();
	await putObject(logoKey(user.id, version), bytes, type);
	return Response.json({ version });
}

export async function DELETE() {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	await deleteObject(logoKey(user.id));
	return Response.json({ ok: true });
}
