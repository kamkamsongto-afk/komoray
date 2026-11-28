import { sameOrigin } from "@/lib/access";
import { scriptFingerprint } from "@/lib/bad-takes";
import { LANGUAGES } from "@/lib/languages";
import { cutThaiWords, isThaiWord } from "@/lib/newmm";
import { getJson, siblingKey, updateJson } from "@/lib/r2";
import { addPicked, curatable, effectiveUse, listFor, readCuratedStrict, SEED, type WordList } from "@/lib/shared-words";
import { currentUser, isAdmin } from "@/lib/supabase/server";
import { thaiWords } from "@/lib/word-check";
import type { WordUse } from "@/lib/word-rules";
import { type Clip, squash, suggestWords } from "@/lib/word-suggestions";

// Suggestions on the admin page's Words tab (lib/word-suggestions.ts). Read from the signed-in admin's OWN videos only,
// never a customer's: the Privacy Policy lets nothing of theirs into our list.
//   GET                                                { suggestions, videos, total, unread, older }
//   POST { action: "add", id, heard, fixed, use, language? }   into Word Hub, set as chosen, not offered again (409: the
//                                                             list has another pair for that heard side)
//   POST { action: "skip", id }                        not offered again
const MOST_VIDEOS = 100; // the newest
const AT_ONCE = 10;
// A Worker has 128 MB: older videos are left out once this many words are held (about 25 hours of speech).
const MOST_WORDS = 300_000;
const MOST_SHOWN = 300;
const DONE_KEY = "shared-words/suggestions-done.json";
const MAX_DONE = 20_000;
const LISTS: WordList[] = ["th", ...LANGUAGES.map((l) => l.code).filter((c) => c !== "th"), "latin"];

type Fix = { from: number; to: number; text: string };
type Done = { ids: string[] };

// Labelled "Safe": Word Hub would put it on everywhere by itself (not where the right side has a word the dictionary
// lacks, as a typing slip does), and either part of the heard side is no word, or the
// right side is one word (โปร แกม → โปรแกรม). Real words with a neighbour (ก็ โล่ง → ก็โผล่ง) pass the rules as one
// slip, yet "ก็โล่ง" is right in another sentence.
function safe(heard: string, fixed: string) {
	const squashed = squash(heard);
	const unmarked = squashed.replace(/ๆ/g, ""); // ๆ is no word: ลับๆ is as real as ลับ
	return effectiveUse({ heard, fixed }) === "always" && (!thaiWords.realWords(unmarked) || isThaiWord(squash(fixed)));
}

async function admin() {
	const { supabase, user } = await currentUser();
	return user && isAdmin(user.email) ? { supabase, user } : null;
}
const NOT_ADMIN = () => Response.json({ error: "This page is for the Komoray team only" }, { status: 403 });

export async function GET() {
	const me = await admin();
	if (!me) return NOT_ADMIN();
	const { data, error } = await me.supabase.from("projects").select("video_key").eq("user_id", me.user.id).order("created_at", { ascending: false }).limit(MOST_VIDEOS);
	if (error) return Response.json({ error: "Could not read your videos" }, { status: 500 });
	const keys = (data ?? []).map((p) => p.video_key as string);

	const read: (Clip & { script: string })[] = [];
	let unread = 0;
	let held = 0;
	let older = 0;
	for (let i = 0; i < keys.length; i += AT_ONCE) {
		if (held >= MOST_WORDS) {
			older = keys.length - i;
			break;
		}
		const some = await Promise.all(
			keys.slice(i, i + AT_ONCE).map(async (key) => {
				try {
					// A missing file is null. One that can't be read leaves its video out and is counted: without
					// spelling.json every fix of the AI's would be offered as the admin's own.
					const [edit, spelling] = await Promise.all([
						getJson<{ words?: { text: string; start: number; end: number }[]; fixes?: Fix[]; language?: string }>(siblingKey(key, "edit.json")),
						getJson<{ fixes?: Fix[] }>(siblingKey(key, "spelling.json")),
					]);
					const words = edit?.words;
					if (!Array.isArray(words) || !words.every((w) => typeof w?.text === "string") || !Array.isArray(edit!.fixes) || !edit!.fixes.length) return null;
					const script = await scriptFingerprint(words);
					// Only the text is kept: the times of every word of every video would fill the Worker's memory.
					return { script, words: words.map((w) => ({ text: w.text })), fixes: edit!.fixes, ai: spelling?.fixes ?? [], language: edit!.language };
				} catch {
					unread++;
					return null;
				}
			}),
		);
		for (const clip of some) {
			if (!clip) continue;
			read.push(clip);
			held += clip.words.length;
		}
	}
	// A duplicated project has the same script: its fixes count once.
	const clips = [...new Map(read.reverse().map((c) => [c.script, c])).values()].reverse();

	// Without the list or what was done, everything would be offered again, and Add would write over the list: stop.
	const [lists, done] = await Promise.all([Promise.all(LISTS.map(readCuratedStrict)), getJson<Done>(DONE_KEY)]);
	const known = new Set([...lists.flat(), ...SEED.th, ...SEED.latin].map((p) => squash(p.heard)));
	const skipped = new Set(done?.ids ?? []);
	const suggestions = suggestWords(clips, {
		cut: cutThaiWords,
		oneWord: isThaiWord,
		allowed: (heard, fixed) => curatable(heard, fixed) !== null,
		known: (heard) => known.has(squash(heard)),
		done: (id) => skipped.has(id),
		safe,
	});
	return Response.json({ suggestions: suggestions.slice(0, MOST_SHOWN), total: suggestions.length, videos: clips.length, unread, older });
}

export async function POST(request: Request) {
	if (!(await admin()) || !sameOrigin(request)) return NOT_ADMIN();
	const body = (await request.json().catch(() => ({}))) as { action?: unknown; id?: unknown; heard?: unknown; fixed?: unknown; use?: unknown; language?: unknown };
	const id = typeof body.id === "string" ? body.id.slice(0, 200) : "";
	if (!id || (body.action !== "add" && body.action !== "skip")) return Response.json({ error: "Which suggestion?" }, { status: 400 });
	if (body.action === "add") {
		const heard = String(body.heard ?? "");
		const fixed = String(body.fixed ?? "");
		const use: WordUse | null = body.use === "always" || body.use === "ai" ? body.use : null;
		const lang = curatable(heard, fixed);
		if (!lang || !use) return Response.json({ error: "That pair can't go in the list: numbers, symbols, or longer than 30 letters." }, { status: 400 });
		const list = listFor(lang, typeof body.language === "string" ? body.language : undefined);
		const added = await addPicked(list, heard, fixed, use);
		if (!added) return Response.json({ error: "That didn't work. Please try again." }, { status: 503 });
		const there = added.result;
		if (there) return Response.json({ error: `Word Hub already has ${there.heard} → ${there.fixed}. Change it in the table below, or press Skip.` }, { status: 409 });
	}
	const kept = await updateJson<Done, true>(DONE_KEY, (old) => ({ next: { ids: [id, ...(old?.ids ?? []).filter((x) => x !== id)].slice(0, MAX_DONE) }, result: true }));
	if (!kept) return Response.json({ error: "That didn't work. Please try again." }, { status: 503 });
	return Response.json({ ok: true });
}
