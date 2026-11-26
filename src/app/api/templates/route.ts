import { accessFor, NO_INVITE } from "@/lib/access";
import { MY_FILE_ID, myRefOf, refId } from "@/lib/my-files";
import { myFilesOf, openFonts } from "@/lib/my-files-usage";
import { PLAN_RULES } from "@/lib/plans";
import { deleteObject, putObject } from "@/lib/r2";
import { currentUser } from "@/lib/supabase/server";
import { cleanTemplateName, readLook, type Template, type TemplateCard, type TemplateLook, usableLook } from "@/lib/templates";
import { templateKey, templatesOf } from "@/lib/templates-store";

// The signed-in user's templates (lib/templates.ts), one file each in R2 (templates/<user id>/<id>.json, outside
// uploads/, so none goes when a video does), so two saves at once can't overwrite each other's.
//   GET             { templates: cards, limit }
//   GET ?id=        { template: { id, name, seconds, look }, left }   the look as it can be used now
//   POST { name, seconds, look }          save a new one            → { templates, limit, left }
//   PUT  { id, name? , seconds?, look? }  rename, or take a new look → { templates, limit, left }
//   DELETE ?id=                           remove it                 → { templates, limit }
// The plan's count (PlanRules.templates): the oldest that many can be used and changed. Any past it are kept, to
// rename or delete, never silently removed.
const MAX_SECONDS = 6 * 3600;

async function signedIn() {
	const { user } = await currentUser();
	if (!user?.email) return { error: Response.json({ error: "Please sign in" }, { status: 401 }) };
	const access = await accessFor(user.email);
	if (!access.allowed) return { error: Response.json({ error: NO_INVITE }, { status: 403 }) };
	const rules = PLAN_RULES[access.plan && access.plan !== "admin" ? access.plan : "beta"];
	return { userId: user.id, fonts: access.perks.fonts, limit: rules.templates };
}

const open = (list: Template[], limit: number) => new Set(list.slice(0, limit).map((t) => t.id)); // list: oldest first

function cards(list: Template[], limit: number): TemplateCard[] {
	const usable = open(list, limit);
	return list
		.map((t) => ({ id: t.id, name: t.name, at: t.at, updatedAt: t.updatedAt, shape: t.look.style.format, banners: t.look.banners.length, frames: t.look.frames.length, layouts: t.look.layouts.length, locked: !usable.has(t.id) }))
		.reverse(); // newest first on screen
}

// The look as it can be shown on any of their videos now. A failed read throws: nothing is left out on a guess.
async function checked(userId: string, fontsAllowed: number, look: TemplateLook) {
	const files = await myFilesOf(userId);
	const byId = new Map(files.map((f) => [f.id, f]));
	const fonts = openFonts(files, fontsAllowed);
	return usableLook(look, {
		file: (name) => {
			const card = byId.get(refId(name) ?? "");
			return !!card && myRefOf(card) === name;
		},
		logo: (id) => byId.has(id),
		font: (id) => fonts.has(id),
	});
}

const seconds = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 && value <= MAX_SECONDS ? Math.round(value * 100) / 100 : null);
const full = (limit: number) => (limit ? `Your plan holds ${limit} template${limit > 1 ? "s" : ""}. Update or delete one, or upgrade on the Pricing page.` : "Templates come with a paid plan. Upgrade on the Pricing page.");
const FAILED = () => Response.json({ error: "Could not reach your templates. Please try again." }, { status: 503 });

export async function GET(request: Request) {
	const me = await signedIn();
	if ("error" in me) return me.error;
	const id = new URL(request.url).searchParams.get("id");
	try {
		const list = await templatesOf(me.userId);
		if (id === null) return Response.json({ templates: cards(list, me.limit), limit: me.limit });
		const found = list.find((t) => t.id === id);
		if (!found) return Response.json({ error: "That template was deleted." }, { status: 404 });
		if (!open(list, me.limit).has(found.id)) return Response.json({ error: full(me.limit) }, { status: 403 });
		const { look, left } = await checked(me.userId, me.fonts, found.look);
		return Response.json({ template: { id: found.id, name: found.name, seconds: found.seconds, look }, left });
	} catch {
		return FAILED();
	}
}

export async function POST(request: Request) {
	const me = await signedIn();
	if ("error" in me) return me.error;
	const body = (await request.json().catch(() => ({}))) as { name?: unknown; seconds?: unknown; look?: unknown };
	const look = readLook(body.look);
	const length = seconds(body.seconds);
	if (!look || !length) return Response.json({ error: "Could not read this video's look." }, { status: 400 });
	try {
		const list = await templatesOf(me.userId);
		if (list.length >= me.limit) return Response.json({ error: full(me.limit) }, { status: 403 });
		const usable = await checked(me.userId, me.fonts, look);
		const now = new Date().toISOString();
		const made: Template = { id: crypto.randomUUID(), name: cleanTemplateName(body.name) || `Template ${list.length + 1}`, at: now, updatedAt: now, seconds: length, look: usable.look };
		await putObject(templateKey(me.userId, made.id), JSON.stringify(made), "application/json");
		return Response.json({ templates: cards([...list, made], me.limit), limit: me.limit, left: usable.left });
	} catch {
		return FAILED();
	}
}

export async function PUT(request: Request) {
	const me = await signedIn();
	if ("error" in me) return me.error;
	const body = (await request.json().catch(() => ({}))) as { id?: unknown; name?: unknown; seconds?: unknown; look?: unknown };
	try {
		const list = await templatesOf(me.userId);
		const found = list.find((t) => t.id === body.id);
		if (!found) return Response.json({ error: "That template was deleted." }, { status: 404 });
		const next: Template = { ...found, name: cleanTemplateName(body.name) || found.name, updatedAt: new Date().toISOString() };
		let left = null;
		if (body.look !== undefined) {
			const look = readLook(body.look);
			const length = seconds(body.seconds);
			if (!look || !length) return Response.json({ error: "Could not read this video's look." }, { status: 400 });
			if (!open(list, me.limit).has(found.id)) return Response.json({ error: full(me.limit) }, { status: 403 });
			const usable = await checked(me.userId, me.fonts, look);
			Object.assign(next, { look: usable.look, seconds: length });
			left = usable.left;
		}
		await putObject(templateKey(me.userId, next.id), JSON.stringify(next), "application/json");
		return Response.json({ templates: cards(list.map((t) => (t.id === next.id ? next : t)), me.limit), limit: me.limit, ...(left && { left }) });
	} catch {
		return FAILED();
	}
}

export async function DELETE(request: Request) {
	const me = await signedIn();
	if ("error" in me) return me.error;
	const id = new URL(request.url).searchParams.get("id") ?? "";
	// MY_FILE_ID is 64 hex; a template's id is a UUID. Checked before it becomes part of a key.
	if (MY_FILE_ID.test(id) || !/^[0-9a-f-]{36}$/.test(id)) return Response.json({ error: "That template was deleted." }, { status: 404 });
	try {
		await deleteObject(templateKey(me.userId, id));
		return Response.json({ templates: cards(await templatesOf(me.userId), me.limit), limit: me.limit });
	} catch {
		return FAILED();
	}
}
