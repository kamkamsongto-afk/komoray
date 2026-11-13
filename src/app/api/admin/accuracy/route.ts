import { type AccuracyRow, guessScript, scoreClip } from "@/lib/accuracy";
import { isUpload, OWNER_FILE } from "@/lib/admin-activity";
import { getJson, listObjects, type ObjectInfo } from "@/lib/r2";
import { currentUser, isAdmin } from "@/lib/supabase/server";

// The admin's Accuracy tab (lib/accuracy.ts): how right the speech-to-text was on each video the creator finished
// (Make video done), as Deepgram wrote it and after the AI's spelling fixes. Only for the admin's Google account.
// Numbers only: no words of anyone's script leave this route.
const MOST_VIDEOS = 200; // the newest finished ones, as the Activity tab

type Fix = { from: number; to: number; text: string };

export async function GET() {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	if (!isAdmin(user.email)) return Response.json({ error: "This page is for the Komoray team only" }, { status: 403 });

	const folders = new Map<string, ObjectInfo[]>();
	for (const item of await listObjects("uploads/")) {
		const id = item.key.split("/")[1];
		if (id) folders.set(id, [...(folders.get(id) ?? []), item]);
	}
	const name = (item: ObjectInfo) => item.key.split("/")[2] ?? "";
	const finished = [...folders.entries()]
		.map(([id, items]) => ({ id, items, final: items.find((item) => name(item) === "final.mp4") }))
		.filter((f) => f.final && f.items.some((item) => name(item) === "edit.json"))
		.sort((a, b) => b.final!.lastModified.localeCompare(a.final!.lastModified))
		.slice(0, MOST_VIDEOS);

	const rows = await Promise.all(
		finished.map(async ({ id, items, final }): Promise<AccuracyRow | null> => {
			const at = (file: string) => items.find((item) => name(item) === file)?.key;
			const read = <T,>(file: string) => (at(file) ? getJson<T>(at(file)!).catch(() => null) : Promise.resolve(null));
			const [edit, spelling, analyze, owner] = await Promise.all([
				read<{ words?: { text: string }[]; fixes?: Fix[]; deleted?: number[]; spellingWanted?: boolean }>("edit.json"),
				read<{ fixes?: Fix[] }>("spelling.json"),
				read<{ language?: string }>("analyze.json"),
				read<{ email?: string }>(OWNER_FILE),
			]);
			if (!Array.isArray(edit?.words) || !edit.words.length) return null;
			const video = items.find((item) => isUpload({ name: name(item), lastModified: item.lastModified }));
			const score = scoreClip(edit.words, Array.isArray(edit.fixes) ? edit.fixes : [], Array.isArray(edit.deleted) ? edit.deleted : [], Array.isArray(spelling?.fixes) ? spelling.fixes : null);
			return {
				...score,
				id,
				file: video ? name(video) : "",
				email: owner?.email ?? null,
				language: analyze?.language ?? guessScript(edit.words),
				guessed: !analyze?.language,
				at: final!.lastModified,
			};
		}),
	);
	return Response.json({ rows: rows.filter(Boolean), shown: finished.length });
}
