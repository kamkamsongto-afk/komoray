import { readKits, type BrandFile, kitId, MAX_KITS, MAX_KIT_NAME } from "@/lib/brand-kits";
import { putObject } from "@/lib/r2";
import { readStyle, type SubtitleStyle } from "@/lib/subtitle-style";
import { currentUser } from "@/lib/supabase/server";

// The signed-in user's Brand Kits: subtitle looks a new video can start with, one per channel (coach, 13 Nov).
// Kept in R2 at brand/<user id>.json (outside uploads/, so it is not deleted after 14 days). The one starred is what
// a new video starts with unless the upload window picked another (lib/upload-options.ts `kit`).
//   GET                                   { kits: [{ id, name, style }], defaultId, style }  style: the starred kit's, or null
//   PUT    { style, kitId? , name? }      save a look into a kit, or into a new one (no kitId)  → the file
//   PATCH  { kitId, name?, star? }        rename, or make it the starred one                    → the file
//   DELETE { kitId }                      remove one (never the last)                           → the file
const brandKey = (userId: string) => `brand/${userId}.json`;

const cleanName = (name: unknown) => (typeof name === "string" ? name.replace(/[\n\r\t]/g, " ").trim().slice(0, MAX_KIT_NAME) : "");
// These belong to one video, never to a look every new video starts from.
function lookOf(value: unknown): SubtitleStyle {
	const style = readStyle(value);
	delete style.splits;
	delete style.spots;
	return style;
}
const answer = (file: BrandFile) => Response.json({ ...file, style: file.kits.find((k) => k.id === file.defaultId)?.style ?? null });

async function signedIn() {
	const { user } = await currentUser();
	return user ? { user, file: await readKits(brandKey(user.id)) } : null;
}
const save = async (userId: string, file: BrandFile) => {
	await putObject(brandKey(userId), JSON.stringify({ ...file, updatedAt: new Date().toISOString() }), "application/json");
	return answer(file);
};
const NO_USER = () => Response.json({ error: "Please sign in" }, { status: 401 });

export async function GET() {
	const me = await signedIn();
	if (!me) return NO_USER();
	return answer(me.file);
}

export async function PUT(request: Request) {
	const me = await signedIn();
	if (!me) return NO_USER();
	const body = (await request.json().catch(() => ({}))) as { style?: unknown; kitId?: unknown; name?: unknown };
	if (!body.style || typeof body.style !== "object") return Response.json({ error: "No style" }, { status: 400 });
	const style = lookOf(body.style);
	const { file } = me;
	const kit = typeof body.kitId === "string" ? file.kits.find((k) => k.id === body.kitId) : undefined;
	// A kit asked for by name that is gone (deleted in another tab): say so, never save into a new one unasked.
	if (body.kitId !== undefined && !kit) return Response.json({ error: "That Brand Kit was deleted. Create a new one instead." }, { status: 404 });
	if (kit) {
		kit.style = style;
		if (cleanName(body.name)) kit.name = cleanName(body.name);
	} else {
		if (file.kits.length >= MAX_KITS) return Response.json({ error: `You can keep up to ${MAX_KITS} Brand Kits. Remove one first.` }, { status: 400 });
		const id = kitId();
		file.kits.push({ id, name: cleanName(body.name) || `Brand Kit ${file.kits.length + 1}`, style });
		if (!file.defaultId) file.defaultId = id;
	}
	return save(me.user.id, file);
}

export async function PATCH(request: Request) {
	const me = await signedIn();
	if (!me) return NO_USER();
	const body = (await request.json().catch(() => ({}))) as { kitId?: unknown; name?: unknown; star?: unknown };
	const kit = me.file.kits.find((k) => k.id === body.kitId);
	if (!kit) return Response.json({ error: "Which Brand Kit?" }, { status: 404 });
	if (cleanName(body.name)) kit.name = cleanName(body.name);
	if (body.star === true) me.file.defaultId = kit.id;
	return save(me.user.id, me.file);
}

export async function DELETE(request: Request) {
	const me = await signedIn();
	if (!me) return NO_USER();
	const body = (await request.json().catch(() => ({}))) as { kitId?: unknown };
	const { file } = me;
	if (!file.kits.some((k) => k.id === body.kitId)) return Response.json({ error: "Which Brand Kit?" }, { status: 404 });
	if (file.kits.length <= 1) return Response.json({ error: "Keep at least one Brand Kit." }, { status: 400 });
	file.kits = file.kits.filter((k) => k.id !== body.kitId);
	if (file.defaultId === body.kitId) file.defaultId = file.kits[0].id;
	return save(me.user.id, file);
}
