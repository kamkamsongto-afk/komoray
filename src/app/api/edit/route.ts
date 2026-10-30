import { ownsVideo } from "@/lib/supabase/server";
import { getJson, putObject, siblingKey, VIDEO_KEY } from "@/lib/r2";

// Save which words the user deleted in the Script view. They live in edit.json as
// "deleted" (word positions), next to the silences, so Make video cuts both.
export async function PUT(request: Request) {
	const { key, deleted } = (await request.json()) as { key?: string; deleted?: unknown };
	if (!key || !VIDEO_KEY.test(key) || !(await ownsVideo(key))) return Response.json({ error: "Unknown video" }, { status: 404 });

	const editKey = siblingKey(key, "edit.json");
	const edit = await getJson<{ words: unknown[]; deleted?: number[] }>(editKey);
	if (!edit) return Response.json({ error: "Find silences first" }, { status: 400 });

	const count = edit.words.length;
	if (!Array.isArray(deleted) || !deleted.every((i) => Number.isInteger(i) && i >= 0 && i < count)) {
		return Response.json({ error: "Bad word list" }, { status: 400 });
	}
	edit.deleted = [...new Set(deleted as number[])].sort((a, b) => a - b);
	await putObject(editKey, JSON.stringify(edit, null, 2), "application/json");
	return Response.json({ ok: true, deleted: edit.deleted });
}
