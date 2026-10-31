import { ownsVideo } from "@/lib/supabase/server";
import { type Fix, readFixes } from "@/lib/edit";
import { getJson, putObject, siblingKey, VIDEO_KEY } from "@/lib/r2";
import { readStyle } from "@/lib/subtitle-style";

// Save the user's edits from the editor into edit.json, next to the silences:
//   deleted  word positions deleted in the script (Make video cuts them)
//   fixes    words retyped in the script (subtitles read the fixed text)
//   style    subtitle size / outline / position
// Any of them can be sent on its own.
export async function PUT(request: Request) {
	const { key, deleted, fixes, dictionaryApplied, style } = (await request.json()) as {
		key?: string;
		deleted?: unknown;
		fixes?: unknown;
		dictionaryApplied?: unknown;
		style?: unknown;
	};
	if (!key || !VIDEO_KEY.test(key) || !(await ownsVideo(key))) return Response.json({ error: "Unknown video" }, { status: 404 });

	const editKey = siblingKey(key, "edit.json");
	const edit = await getJson<{ words: unknown[]; deleted?: number[]; fixes?: Fix[]; dictionaryApplied?: boolean; style?: unknown }>(editKey);
	if (!edit) return Response.json({ error: "Find silences first" }, { status: 400 });

	if (deleted !== undefined) {
		const count = edit.words.length;
		if (!Array.isArray(deleted) || !deleted.every((i) => Number.isInteger(i) && i >= 0 && i < count)) {
			return Response.json({ error: "Bad word list" }, { status: 400 });
		}
		edit.deleted = [...new Set(deleted as number[])].sort((a, b) => a - b);
	}
	if (fixes !== undefined) {
		const checked = readFixes(fixes, edit.words.length);
		if (!checked) return Response.json({ error: "Bad word fixes" }, { status: 400 });
		edit.fixes = checked;
	}
	if (dictionaryApplied === true) edit.dictionaryApplied = true;
	if (style !== undefined) edit.style = readStyle(style);

	await putObject(editKey, JSON.stringify(edit, null, 2), "application/json");
	return Response.json({ ok: true });
}
