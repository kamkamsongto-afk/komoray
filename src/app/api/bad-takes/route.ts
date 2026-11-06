import { getCloudflareContext } from "@opennextjs/cloudflare";
import { accessFor, NO_INVITE } from "@/lib/access";
import { askForTakes, type BadTake, CHUNK_WORDS, keepTakes, scriptFingerprint } from "@/lib/bad-takes";
import { deleteObject, getJson, listObjects, putIfAbsent, putObject, siblingKey, VIDEO_KEY } from "@/lib/r2";
import { currentUser, ownsVideo } from "@/lib/supabase/server";

// Suggestions for what to cut, kept next to the video, so a script is only paid for once:
//   bad-takes.json                     how far we read and what we found, for one exact script
//   bad-takes-lock-<script>-<done>.json  someone is reading this part now: a second tab waits instead of paying again
//   bad-takes-kept-<script>-<from>.json  the creator said to keep this one. A file each, so reading a later part can't undo it
// POST { key }             reads the next part, answers { takes, remaining, busy? }. The page calls until remaining is 0.
// POST { key, keep: from } keep this suggestion.
type Saved = { script: string; done: number; takes: BadTake[] };

const LOCK_MS = 120_000; // longer than a request can last: after this, whoever held it has died

export async function POST(request: Request) {
	const { key, keep } = (await request.json().catch(() => ({}))) as { key?: string; keep?: unknown };
	if (!key || !VIDEO_KEY.test(key) || !(await ownsVideo(key))) return Response.json({ error: "Unknown video" }, { status: 404 });
	const { user } = await currentUser();
	if (!(await accessFor(user?.email)).allowed) return Response.json({ error: NO_INVITE }, { status: 403 });

	const edit = await getJson<{ words: { text: string; start: number; end: number }[] }>(siblingKey(key, "edit.json"));
	if (!edit) return Response.json({ error: "Find silences first" }, { status: 400 });
	const count = edit.words.length;
	// The same number of words can be a different script (Wrong language?), so it is compared by content.
	const script = await scriptFingerprint(edit.words);
	const keptPrefix = siblingKey(key, `bad-takes-kept-${script}-`);

	if (typeof keep === "number" && Number.isInteger(keep)) {
		await putObject(`${keptPrefix}${keep}.json`, "{}", "application/json");
		return Response.json({ ok: true });
	}

	const saved = await getJson<Saved>(siblingKey(key, "bad-takes.json"));
	const state: Saved = saved?.script === script ? saved : { script, done: 0, takes: [] };
	const shown = async (takes: BadTake[]) => {
		const kept = new Set((await listObjects(keptPrefix)).map((file) => Number(file.key.slice(keptPrefix.length).replace(".json", ""))));
		return takes.filter((take) => !kept.has(take.from));
	};
	if (state.done >= count) return Response.json({ takes: await shown(state.takes), remaining: 0 });

	const { ANTHROPIC_API_KEY: apiKey } = getCloudflareContext().env as unknown as { ANTHROPIC_API_KEY?: string };
	if (!apiKey) return Response.json({ error: "Not set up yet" }, { status: 503 });

	const lockKey = siblingKey(key, `bad-takes-lock-${script}-${state.done}.json`);
	const claim = JSON.stringify({ at: Date.now() });
	if (!(await putIfAbsent(lockKey, claim, "application/json"))) {
		const lock = await getJson<{ at: number }>(lockKey);
		if (lock && Date.now() - lock.at < LOCK_MS) return Response.json({ takes: await shown(state.takes), remaining: count - state.done, busy: true });
		await putObject(lockKey, claim, "application/json");
	}
	try {
		const found = await askForTakes(edit.words, state.done, apiKey);
		const next: Saved = { script, done: Math.min(count, state.done + CHUNK_WORDS), takes: keepTakes(found, state.takes, state.done, count) };
		await putObject(siblingKey(key, "bad-takes.json"), JSON.stringify(next), "application/json");
		return Response.json({ takes: await shown(next.takes), remaining: count - next.done });
	} catch (error) {
		console.error("Bad takes failed:", error);
		await deleteObject(lockKey).catch(() => {});
		return Response.json({ error: "Could not check this video for bad takes" }, { status: 502 });
	}
}
