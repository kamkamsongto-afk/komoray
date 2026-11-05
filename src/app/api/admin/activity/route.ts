import { type VideoFacts, isUpload, OWNER_FILE, summarize, wordsFixed } from "@/lib/admin-activity";
import { listPeople } from "@/lib/access";
import { getJson, listObjects, type ObjectInfo } from "@/lib/r2";
import { currentUser, isAdmin } from "@/lib/supabase/server";

// The admin's Activity tab: one row per person. Only for the admin's Google account.
const MOST_VIDEOS = 200; // the newest ones. Each one reads two small files, so this keeps the page within a request's limits

export async function GET() {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	if (!isAdmin(user.email)) return Response.json({ error: "This page is for the Komoray team only" }, { status: 403 });

	const [people, uploads] = await Promise.all([listPeople(), listObjects("uploads/")]);
	const folders = new Map<string, ObjectInfo[]>();
	for (const item of uploads) {
		const id = item.key.split("/")[1];
		if (id) folders.set(id, [...(folders.get(id) ?? []), item]);
	}
	const newest = (files: ObjectInfo[]) => files.reduce((latest, file) => (file.lastModified > latest ? file.lastModified : latest), "");
	const withVideo = [...folders.values()].filter((items) => items.some((item) => isUpload({ name: item.key.split("/")[2] ?? "", lastModified: item.lastModified })));
	const recent = withVideo.sort((a, b) => newest(b).localeCompare(newest(a))).slice(0, MOST_VIDEOS);

	const videos: VideoFacts[] = await Promise.all(
		recent.map(async (items) => {
			const files = items.map((item) => ({ name: item.key.split("/")[2] ?? "", lastModified: item.lastModified }));
			const named = (name: string) => items.find((item) => item.key.split("/")[2] === name);
			const ownerFile = named(OWNER_FILE);
			const editFile = named("edit.json");
			const [owner, edit] = await Promise.all([
				ownerFile ? getJson<{ email?: string }>(ownerFile.key).catch(() => null) : null,
				editFile ? getJson<{ words?: unknown[]; fixes?: unknown }>(editFile.key).catch(() => null) : null,
			]);
			return { email: owner?.email ?? null, files, words: Array.isArray(edit?.words) ? edit.words.length : 0, fixed: wordsFixed(edit?.fixes) };
		}),
	);

	return Response.json({ people: summarize(people.map((person) => person.email), videos), used: Object.fromEntries(people.map((person) => [person.email, person.used])), shown: recent.length, total: withVideo.length });
}
