import { readBanners } from "@/lib/banners";
import { getJson, putObject } from "@/lib/r2";
import { currentUser } from "@/lib/supabase/server";

// The signed-in user's saved banners, to add to any video in one click. Each is a banner starting at 0
// (its end is how long it shows). Kept in R2 next to the Brand Kit (outside uploads/, so it stays).
//   GET  { templates }
//   PUT  { templates }  the whole list (checked like a video's banners)
const templatesKey = (userId: string) => `brand/${userId}-banners.json`;

export async function GET() {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	const saved = await getJson<{ templates?: unknown }>(templatesKey(user.id));
	return Response.json({ templates: (readBanners(saved?.templates) ?? []).filter((t) => t.kind !== "file") });
}

export async function PUT(request: Request) {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	const body = (await request.json().catch(() => ({}))) as { templates?: unknown };
	// An uploaded banner lives next to one video, so it can't be a template for any video.
	const templates = readBanners(body.templates)?.filter((t) => t.kind !== "file");
	if (!templates) return Response.json({ error: "Bad banners" }, { status: 400 });
	await putObject(templatesKey(user.id), JSON.stringify({ templates, updatedAt: new Date().toISOString() }), "application/json");
	return Response.json({ templates });
}
