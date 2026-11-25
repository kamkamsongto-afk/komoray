import { getCloudflareContext } from "@opennextjs/cloudflare";
import { accessFor, NO_INVITE } from "@/lib/access";
import { scriptFingerprint } from "@/lib/bad-takes";
import { deleteObject, getJson, putIfAbsent, putObject, siblingKey, VIDEO_KEY } from "@/lib/r2";
import { currentUser, ownsVideo } from "@/lib/supabase/server";
import { askForMoments, type Moment, MOMENT_CHUNK_WORDS, momentParts } from "@/lib/zoom-moments";

// Where Claude would zoom (lib/zoom-moments.ts), kept next to the video so a script is only paid for once:
//   zoom-moments.json                        how far we read and what we found, for one exact script
//   zoom-moments-lock-<script>-<done>.json   someone is reading this part now: another ask waits instead of paying again
// POST { key }  reads the next part, answers { parts, remaining, busy? }. The page calls until remaining is 0.
type Saved = { script: string; done: number; moments: Moment[] };

const LOCK_MS = 120_000; // longer than a request can last: after this, whoever held it has died
const BUSY_WAIT_MS = 3000; // a busy answer is held this long: the page asks again at once and would otherwise spin

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
	const answer = (s: Saved, busy?: boolean) => Response.json({ parts: momentParts(edit.words, s.moments, edit.duration), remaining: count - s.done, ...(busy && { busy }) });
	if (state.done >= count) return answer(state);

	const { ANTHROPIC_API_KEY: apiKey } = getCloudflareContext().env as unknown as { ANTHROPIC_API_KEY?: string };
	if (!apiKey) return Response.json({ error: "Not set up yet" }, { status: 503 });

	// Taken before the AI is asked (as api/bad-takes): without it, asks sent together were each paid for.
	const lockKey = siblingKey(key, `zoom-moments-lock-${script}-${state.done}.json`);
	const claim = JSON.stringify({ at: Date.now() });
	if (!(await putIfAbsent(lockKey, claim, "application/json"))) {
		const lock = await getJson<{ at: number }>(lockKey);
		if (lock && Date.now() - lock.at < LOCK_MS) {
			await new Promise((resolve) => setTimeout(resolve, BUSY_WAIT_MS));
			const now = await getJson<Saved>(savedKey);
			return answer(now?.script === script ? now : state, true);
		}
		await putObject(lockKey, claim, "application/json");
	}
	try {
		const found = await askForMoments(edit.words, state.done, apiKey);
		const next: Saved = { script, done: Math.min(count, state.done + MOMENT_CHUNK_WORDS), moments: [...state.moments, ...found] };
		await putObject(savedKey, JSON.stringify(next), "application/json");
		return answer(next);
	} catch (error) {
		console.error("Zoom moments failed:", error);
		await deleteObject(lockKey).catch(() => {});
		return Response.json({ error: "Could not find the key moments" }, { status: 502 });
	}
}
