import { getCloudflareContext } from "@opennextjs/cloudflare";
import { accessFor, NO_INVITE } from "@/lib/access";
import { scriptFingerprint } from "@/lib/bad-takes";
import { getJson, putObject, siblingKey, VIDEO_KEY } from "@/lib/r2";
import { currentUser, ownsVideo } from "@/lib/supabase/server";
import { askForMoments, type Moment, MOMENT_CHUNK_WORDS, momentParts } from "@/lib/zoom-moments";

// Where Claude would zoom (lib/zoom-moments.ts), kept next to the video so a script is only paid for once:
//   zoom-moments.json   how far we read and what we found, for one exact script
// POST { key }  reads the next part, answers { parts, remaining }. The page calls until remaining is 0.
type Saved = { script: string; done: number; moments: Moment[] };

export async function POST(request: Request) {
	const { key } = (await request.json().catch(() => ({}))) as { key?: string };
	if (!key || !VIDEO_KEY.test(key) || !(await ownsVideo(key))) return Response.json({ error: "Unknown video" }, { status: 404 });
	const { user } = await currentUser();
	if (!(await accessFor(user?.email)).allowed) return Response.json({ error: NO_INVITE }, { status: 403 });

	const edit = await getJson<{ duration: number; words: { text: string; start: number; end: number }[] }>(siblingKey(key, "edit.json"));
	if (!edit?.words?.length) return Response.json({ error: "Find silences first" }, { status: 400 });
	const count = edit.words.length;
	const script = await scriptFingerprint(edit.words);
	const savedKey = siblingKey(key, "zoom-moments.json");
	const saved = await getJson<Saved>(savedKey);
	const state: Saved = saved?.script === script ? saved : { script, done: 0, moments: [] };
	const answer = (s: Saved) => Response.json({ parts: momentParts(edit.words, s.moments, edit.duration), remaining: count - s.done });
	if (state.done >= count) return answer(state);

	const { ANTHROPIC_API_KEY: apiKey } = getCloudflareContext().env as unknown as { ANTHROPIC_API_KEY?: string };
	if (!apiKey) return Response.json({ error: "Not set up yet" }, { status: 503 });
	try {
		const found = await askForMoments(edit.words, state.done, apiKey);
		const next: Saved = { script, done: Math.min(count, state.done + MOMENT_CHUNK_WORDS), moments: [...state.moments, ...found] };
		await putObject(savedKey, JSON.stringify(next), "application/json");
		return answer(next);
	} catch (error) {
		console.error("Zoom moments failed:", error);
		return Response.json({ error: "Could not find the key moments" }, { status: 502 });
	}
}
