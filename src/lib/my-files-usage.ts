import type { SubtitleStyle } from "./subtitle-style";
import { readKits } from "./brand-kits";
import { type MyFile, myFilesPrefix } from "./my-files";
import { getJson, listObjects } from "./r2";

// Where each of a person's My files is used (the My files page, and before a delete): the Brand Kits by name and how many
// projects. Read from the kits and every project's edit.json each time, never kept, so it can't go stale. Server only.
export type FileUse = { kits: string[]; projects: number };

type Pins = { style?: Partial<SubtitleStyle>; banners?: { font?: string; ownFont?: { file?: string } }[] };

// The My files ids a look or a project points at: its logo picture, its own font, each banner's own font.
function idsIn(edit: Pins | null): string[] {
	if (!edit) return [];
	const ids: string[] = [];
	const logo = edit.style?.logoImage;
	if (logo && "file" in logo) ids.push(logo.file);
	if (edit.style?.font === "own" && edit.style.ownFont?.file) ids.push(edit.style.ownFont.file);
	for (const b of edit.banners ?? []) if (b.font === "own" && b.ownFont?.file) ids.push(b.ownFont.file);
	return ids;
}

export async function filesUse(userId: string, projectIds: string[]): Promise<Map<string, FileUse>> {
	const use = new Map<string, FileUse>();
	const at = (id: string) => use.get(id) ?? (use.set(id, { kits: [], projects: 0 }), use.get(id)!);
	const { kits } = await readKits(`brand/${userId}.json`);
	for (const kit of kits) for (const id of new Set(idsIn({ style: kit.style }))) at(id).kits.push(kit.name);
	const edits = await Promise.all(projectIds.map((id) => getJson<Pins>(`uploads/${id}/edit.json`).catch(() => null)));
	for (const edit of edits) for (const id of new Set(idsIn(edit))) at(id).projects += 1;
	return use;
}

// Every card in their My files (the bytes beside each are listed too: the sizes add up from the cards).
export async function myFilesOf(userId: string): Promise<MyFile[]> {
	const keys = (await listObjects(myFilesPrefix(userId))).map((o) => o.key).filter((k) => k.endsWith(".json"));
	const cards = await Promise.all(keys.map((k) => getJson<MyFile>(k)));
	return cards.filter((c): c is MyFile => !!c).sort((a, b) => b.at.localeCompare(a.at));
}

// The bytes their My files take (every file under files/<id>/, cards included), for the storage bar and the cap.
export async function myFilesBytes(userId: string) {
	return (await listObjects(myFilesPrefix(userId))).reduce((sum, o) => sum + o.size, 0);
}
