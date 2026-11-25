import type { SupabaseClient } from "@supabase/supabase-js";
import type { SubtitleStyle } from "./subtitle-style";
import { readKits } from "./brand-kits";
import { type MyFile, myFilesPrefix, myIncomingPrefix, myRefOf, refId } from "./my-files";
import { getJson, listObjects } from "./r2";

// Where each of a person's My files is used (the My files page, and before a delete or Replace): the Brand Kits by name,
// how many saved banners (My banners) and how many projects. Read from the kits, the banners and every project's
// edit.json each time, never kept, so it can't go stale. When unsure, keep (agent review 21 Nov, as the storage
// clean-up, docs/bugs.md): every read must work or this throws, so nothing is deleted on a failed read. Server only.
export type FileUse = { kits: string[]; banners: number; projects: number };

export type Pins = {
	style?: Partial<SubtitleStyle> | null;
	banners?: { font?: string; ownFont?: { file?: string }; kind?: string; file?: string }[] | null;
	cutout?: { inserts?: { file: string }[]; texts?: { font?: string; ownFont?: { file?: string } }[] } | null;
	frames?: { back?: string; file?: string }[] | null;
	layouts?: { file?: string }[] | null;
};

// The My files ids a look, a project or a saved banner points at: its logo picture, its own font, each banner's own
// font, and every picture or clip shown from My files (MY_REF: a banner's file, Pic/Clip, Frame Me, Layout).
// The My files reference names (MY_REF) on a project's banners, Pic/Clip, Frame Me and Layout.
export function refNamesIn(edit: Pins | null): string[] {
	if (!edit) return [];
	const names = [...(edit.banners ?? []).map((b) => (b.kind === "file" ? b.file : undefined)), ...(edit.cutout?.inserts ?? []).map((i) => i.file), ...(edit.frames ?? []).map((f) => (f.back === "file" ? f.file : undefined)), ...(edit.layouts ?? []).map((l) => l.file)];
	return names.filter((n): n is string => !!n && !!refId(n));
}

export function idsIn(edit: Pins | null): string[] {
	if (!edit) return [];
	const ids: string[] = [];
	const ref = (name?: string) => {
		const id = name ? refId(name) : null;
		if (id) ids.push(id);
	};
	const logo = edit.style?.logoImage;
	if (logo && "file" in logo) ids.push(logo.file);
	if (edit.style?.font === "own" && edit.style.ownFont?.file) ids.push(edit.style.ownFont.file);
	for (const b of edit.banners ?? []) {
		if (b.font === "own" && b.ownFont?.file) ids.push(b.ownFont.file);
		if (b.kind === "file") ref(b.file);
	}
	for (const t of edit.cutout?.texts ?? []) if (t.font === "own" && t.ownFont?.file) ids.push(t.ownFont.file);
	for (const i of edit.cutout?.inserts ?? []) ref(i.file);
	for (const f of edit.frames ?? []) if (f.back === "file") ref(f.file);
	for (const l of edit.layouts ?? []) ref(l.file);
	return ids;
}

// Every project id of the signed-in person (the database only returns their own rows), a page at a time, so none is
// missed past the database's row limit. A failed read throws.
export async function projectIdsOf(supabase: SupabaseClient) {
	const ids: string[] = [];
	for (let from = 0; ; from += 1000) {
		const { data, error } = await supabase.from("projects").select("id").order("id").range(from, from + 999);
		if (error) throw new Error(`projects: ${error.message}`);
		ids.push(...(data ?? []).map((r: { id: string }) => r.id));
		if (!data || data.length < 1000) return ids;
	}
}

export const bannersKey = (userId: string) => `brand/${userId}-banners.json`;

export async function filesUse(userId: string, projectIds: string[]): Promise<Map<string, FileUse>> {
	const use = new Map<string, FileUse>();
	const at = (id: string) => use.get(id) ?? (use.set(id, { kits: [], banners: 0, projects: 0 }), use.get(id)!);
	const [{ kits }, saved] = await Promise.all([readKits(`brand/${userId}.json`), getJson<{ templates?: Pins["banners"] }>(bannersKey(userId))]);
	for (const kit of kits) for (const id of new Set(idsIn({ style: kit.style }))) at(id).kits.push(kit.name);
	for (const banner of saved?.templates ?? []) for (const id of idsIn({ banners: [banner] })) at(id).banners += 1;
	// A missing edit.json is a project with nothing in it yet (null); any other failed read throws (getJson).
	const edits = await Promise.all(projectIds.map((id) => getJson<Pins>(`uploads/${id}/edit.json`)));
	for (const edit of edits) for (const id of new Set(idsIn(edit))) at(id).projects += 1;
	return use;
}

// Every card in their My files, newest first. A failed read throws.
export async function myFilesOf(userId: string): Promise<MyFile[]> {
	const keys = (await listObjects(myFilesPrefix(userId))).map((o) => o.key).filter((k) => k.endsWith(".json"));
	const cards = await Promise.all(keys.map((k) => getJson<MyFile>(k)));
	return cards.filter((c): c is MyFile => !!c).sort((a, b) => b.at.localeCompare(a.at));
}

// The bytes their My files take (every file under files/<id>/, cards included), for the storage bar and the cap.
// A clip still on its way up (incoming/) isn't counted: it is moved in once checked, or cleared after a day.
export async function myFilesBytes(userId: string) {
	return (await listObjects(myFilesPrefix(userId))).filter((o) => !o.key.startsWith(myIncomingPrefix(userId))).reduce((sum, o) => sum + o.size, 0);
}

// The fonts open for new picks: the first `allowed` uploaded (Starter 5, Pro 20; Free none). Kept ones beyond stay in
// the projects that already use them (coach 21 Nov), never in new ones.
export const openFonts = (cards: MyFile[], allowed: number) => new Set(cards.filter((c) => c.kind === "font").sort((a, b) => a.at.localeCompare(b.at)).slice(0, allowed).map((c) => c.id));

export const FONTS_LOCKED = "Your own fonts come with Starter and Pro. Upgrade on the Pricing page.";
export const PIN_GONE = "A file you picked is no longer in My files (replaced or deleted). Reload the page and pick it again.";

// Before saving a look, a project's banners or saved banners: what is wrong with the My files ids it points at that it
// didn't point at before (`before`, everything it had), else null. A file that is gone, or a font the plan doesn't open,
// is refused out loud, never swapped for something else (agent review 21 Nov). A failed read throws.
export async function newPinsProblem(userId: string, fontsAllowed: number, next: Pins, before: Pins[]) {
	const had = new Set(before.flatMap((b) => idsIn(b)));
	const fresh = [...new Set(idsIn(next))].filter((id) => !had.has(id));
	if (!fresh.length) return null;
	const cards = await myFilesOf(userId);
	const byId = new Map(cards.map((c) => [c.id, c]));
	const open = openFonts(cards, fontsAllowed);
	const names = new Set(refNamesIn(next));
	for (const id of fresh) {
		const card = byId.get(id);
		if (!card) return PIN_GONE;
		for (const name of names) if (refId(name) === id && myRefOf(card) !== name) return PIN_GONE;
		if (card.kind === "font" && !open.has(id)) return fontsAllowed ? `Your plan holds ${fontsAllowed} own fonts. Pick one of those, or upgrade for more.` : FONTS_LOCKED;
	}
	return null;
}
