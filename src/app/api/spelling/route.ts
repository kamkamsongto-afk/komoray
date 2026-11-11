import { getCloudflareContext } from "@opennextjs/cloudflare";
import { accessFor, NO_INVITE } from "@/lib/access";
import { scriptFingerprint } from "@/lib/bad-takes";
import type { Fix } from "@/lib/edit";
import { deleteObject, getJson, putIfAbsent, putObject, siblingKey, VIDEO_KEY } from "@/lib/r2";
import { askForSpelling, CHUNK_WORDS } from "@/lib/spelling";
import { currentUser, ownsVideo } from "@/lib/supabase/server";

// The AI's spelling fixes (lib/spelling.ts), kept next to the video so a script is only paid for once:
//   spelling.json                          how far we read and the fixes found, for one exact script
//   spelling-lock-<script>-<done>.json     someone is reading this part now: a second tab waits instead of paying again
// POST { key }  reads the next part, answers { fixes, remaining, busy? }. The page calls until remaining is 0.
type Saved = { script: string; done: number; fixes: Fix[] };

const LOCK_MS = 120_000; // longer than a request can last: after this, whoever held it has died
const HINT_WORDS = 150;

export async function POST(request: Request) {
	const { key } = (await request.json().catch(() => ({}))) as { key?: string };
	if (!key || !VIDEO_KEY.test(key) || !(await ownsVideo(key))) return Response.json({ error: "Unknown video" }, { status: 404 });
	const { supabase, user } = await currentUser();
	if (!(await accessFor(user?.email)).allowed) return Response.json({ error: NO_INVITE }, { status: 403 });

	const edit = await getJson<{ words: { text: string; start: number; end: number }[] }>(siblingKey(key, "edit.json"));
	if (!edit) return Response.json({ error: "Find silences first" }, { status: 400 });
	const count = edit.words.length;
	const script = await scriptFingerprint(edit.words);
	const saved = await getJson<Saved>(siblingKey(key, "spelling.json"));
	const state: Saved = saved?.script === script ? saved : { script, done: 0, fixes: [] };
	if (state.done >= count) return Response.json({ fixes: state.fixes, remaining: 0 });

	const { ANTHROPIC_API_KEY: apiKey } = getCloudflareContext().env as unknown as { ANTHROPIC_API_KEY?: string };
	if (!apiKey) return Response.json({ error: "Not set up yet" }, { status: 503 });

	const lockKey = siblingKey(key, `spelling-lock-${script}-${state.done}.json`);
	const claim = JSON.stringify({ at: Date.now() });
	if (!(await putIfAbsent(lockKey, claim, "application/json"))) {
		const lock = await getJson<{ at: number }>(lockKey);
		if (lock && Date.now() - lock.at < LOCK_MS) return Response.json({ fixes: state.fixes, remaining: count - state.done, busy: true });
		await putObject(lockKey, claim, "application/json");
	}
	try {
		// The creator's own words (My words, most used first): how they spell their names and terms.
		const { data } = await supabase.from("word_fixes").select("heard, fixed").order("uses", { ascending: false }).limit(HINT_WORDS);
		const found = await askForSpelling(edit.words, state.done, apiKey, data ?? []);
		const next: Saved = { script, done: Math.min(count, state.done + CHUNK_WORDS), fixes: [...state.fixes, ...found] };
		await putObject(siblingKey(key, "spelling.json"), JSON.stringify(next), "application/json");
		return Response.json({ fixes: next.fixes, remaining: count - next.done });
	} catch (error) {
		console.error("Spelling failed:", error);
		await deleteObject(lockKey).catch(() => {});
		return Response.json({ error: "Could not check the spelling" }, { status: 502 });
	}
}
