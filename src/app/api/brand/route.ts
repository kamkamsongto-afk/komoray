import { getJson, putObject } from "@/lib/r2";
import { readStyle } from "@/lib/subtitle-style";
import { currentUser } from "@/lib/supabase/server";

// The signed-in user's Brand Kit: the subtitle look every new video starts with.
// Kept in R2 at brand/<user id>.json (outside uploads/, so it is not deleted after 14 days).
//   GET  { style } or { style: null } if they haven't made one
//   PUT  { style }  save it (checked field by field)
const brandKey = (userId: string) => `brand/${userId}.json`;

export async function GET() {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	const saved = await getJson<{ style?: unknown }>(brandKey(user.id));
	return Response.json({ style: saved?.style ? readStyle(saved.style) : null });
}

export async function PUT(request: Request) {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	const body = (await request.json().catch(() => ({}))) as { style?: unknown };
	if (!body.style || typeof body.style !== "object") return Response.json({ error: "No style" }, { status: 400 });
	const style = readStyle(body.style);
	await putObject(brandKey(user.id), JSON.stringify({ style, updatedAt: new Date().toISOString() }), "application/json");
	return Response.json({ style });
}
