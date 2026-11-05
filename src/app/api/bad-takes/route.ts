import { getCloudflareContext } from "@opennextjs/cloudflare";
import { accessFor, NO_INVITE } from "@/lib/access";
import { askForTakes, type BadTake, CHUNK_WORDS, keepTakes } from "@/lib/bad-takes";
import { getJson, putObject, siblingKey, VIDEO_KEY } from "@/lib/r2";
import { currentUser, ownsVideo } from "@/lib/supabase/server";

// Suggestions for what to cut, kept next to the video in bad-takes.json, so a video is only paid for once
// (again only if it is listened to again, which changes its words).
//   POST { key }             reads the next part of the script, answers { takes, remaining }. The page calls until remaining is 0.
//   POST { key, keep: from } the creator said to keep this suggestion: it stays gone.
type Saved = { words: number; done: number; takes: BadTake[] };

export async function POST(request: Request) {
	const { key, keep } = (await request.json().catch(() => ({}))) as { key?: string; keep?: unknown };
	if (!key || !VIDEO_KEY.test(key) || !(await ownsVideo(key))) return Response.json({ error: "Unknown video" }, { status: 404 });
	const { user } = await currentUser();
	if (!(await accessFor(user?.email)).allowed) return Response.json({ error: NO_INVITE }, { status: 403 });

	const savedKey = siblingKey(key, "bad-takes.json");
	const saved = await getJson<Saved>(savedKey);
	if (typeof keep === "number") {
		if (!saved) return Response.json({ takes: [], remaining: 0 });
		const next = { ...saved, takes: saved.takes.filter((t) => t.from !== keep) };
		await putObject(savedKey, JSON.stringify(next), "application/json");
		return Response.json({ takes: next.takes, remaining: 0 });
	}

	const edit = await getJson<{ words: { text: string; start: number; end: number }[] }>(siblingKey(key, "edit.json"));
	if (!edit) return Response.json({ error: "Find silences first" }, { status: 400 });
	const count = edit.words.length;
	const state: Saved = saved?.words === count ? saved : { words: count, done: 0, takes: [] };
	if (state.done >= count) return Response.json({ takes: state.takes, remaining: 0 });

	const { ANTHROPIC_API_KEY: apiKey } = getCloudflareContext().env as unknown as { ANTHROPIC_API_KEY?: string };
	if (!apiKey) return Response.json({ error: "Not set up yet" }, { status: 503 });
	try {
		const found = await askForTakes(edit.words, state.done, apiKey);
		const next: Saved = { words: count, done: Math.min(count, state.done + CHUNK_WORDS), takes: keepTakes(found, state.takes, state.done, count) };
		await putObject(savedKey, JSON.stringify(next), "application/json");
		return Response.json({ takes: next.takes, remaining: count - next.done });
	} catch (error) {
		console.error("Bad takes failed:", error);
		return Response.json({ error: "Could not check this video for bad takes" }, { status: 502 });
	}
}
