import { hmac } from "./callback";
import { cutThaiWords, isThaiWord } from "./newmm";
import { getJson, putObject } from "./r2";

// Komoray's shared word list: speech-to-text mistakes that several creators fixed the same way. Only creators who
// ticked "Help make Komoray more accurate" on My words give to it (Privacy: "Shared word fixes"). It is given to the
// AI that fixes spelling (lib/spelling.ts) as examples, so every video gets fixed better as more people use Komoray.
//
// What is kept, in R2 outside uploads/ (so the 14-day clean-up doesn't take it):
//   shared-words/votes/<lang>/<pair id>.json  { heard, fixed, voters }  voters: anonymous ids, not accounts
//   shared-words/<lang>.json                  { pairs }  the pairs at least MIN_VOTERS creators made: what the AI sees
// An anonymous id is a keyed hash of the account: the same creator counts once, and no one can tell who it was.
// Never kept: who made a fix, which video, the sentence around it.

export const MIN_VOTERS = 3; // a fix only counts once this many different creators made it
const MAX_PAIRS = 1000; // per language, most voted first
const MAX_VOTERS = 100; // counted up to this many: plenty to rank by, and a pair's file stays small
const MAX_LETTERS = 30;
const MAX_WORDS = 4;
export type SharedPair = { heard: string; fixed: string; voters: number };
type Votes = { heard: string; fixed: string; voters: string[] };
type Lang = "th" | "latin";

const THAI = /[฀-๿]/;

// Only ordinary words are shared: Thai fixes made only of dictionary words; other languages in small letters only
// (names and brands start with a capital); no numbers, @, links. The dictionary has some common first names (สมชาย):
// what keeps a private name out is MIN_VOTERS, as the Privacy Policy says.
export function shareable(heard: string, fixed: string): Lang | null {
	const h = heard.trim();
	const f = fixed.trim();
	if (!h || !f || h === f || h.length > MAX_LETTERS || f.length > MAX_LETTERS) return null;
	if (h.split(/\s+/).length > MAX_WORDS || f.split(/\s+/).length > MAX_WORDS) return null;
	if (/[0-9๐-๙@#/:.\\_]/.test(h + f)) return null;
	// Both sides are words, not sentences: the heard side is shown to the AI too, so it can't be an instruction
	// three accounts agreed on (Codex review 11 Nov).
	if (THAI.test(f)) {
		if (!/^[฀-๿ ]+$/.test(h) || !/^[฀-๿ ]+$/.test(f)) return null;
		const words = f.split(/\s+/).flatMap((part) => cutThaiWords(part.replace(/ๆ/g, "")));
		return words.length && words.every((w) => isThaiWord(w)) ? "th" : null;
	}
	if (!/^[\p{Ll}' -]+$/u.test(f) || !/^[\p{Ll}' -]+$/u.test(h)) return null;
	// A mishearing looks like the word: a few letters apart ("teh" → "the"), not a different phrase.
	return distance(h, f) <= Math.max(2, Math.ceil(0.4 * Math.max(h.length, f.length))) ? "latin" : null;
}

function distance(a: string, b: string) {
	let row = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const next = [i];
		for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		row = next;
	}
	return row[b.length];
}

// Did this creator tick "Help make Komoray more accurate"? (their settings, api/prefs)
export const sharesWords = async (userId: string) => (await getJson<{ shareWords?: boolean }>(`prefs/${userId}.json`).catch(() => null))?.shareWords === true;

async function pairId(lang: Lang, heard: string, fixed: string) {
	const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${lang}\n${heard}\n${fixed}`)));
	return [...bytes].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// One creator's fix, counted once. R2 has no locks, so two fixes saved at the same moment can lose a vote, or a pair
// from the list: the next time anyone makes that fix, it is put back (the list is checked every time, not only at 3).
export async function addSharedFix(userId: string, secret: string, heard: string, fixed: string) {
	const lang = shareable(heard, fixed);
	if (!lang) return;
	const voter = (await hmac(`shared-words:${secret}`, userId)).slice(0, 16);
	const key = `shared-words/votes/${lang}/${await pairId(lang, heard.trim(), fixed.trim())}.json`;
	const votes = (await getJson<Votes>(key)) ?? { heard: heard.trim(), fixed: fixed.trim(), voters: [] };
	if (!votes.voters.includes(voter) && votes.voters.length < MAX_VOTERS) {
		votes.voters.push(voter);
		await putObject(key, JSON.stringify(votes), "application/json");
	}
	if (votes.voters.length < MIN_VOTERS) return;
	const listKey = `shared-words/${lang}.json`;
	const list = (await getJson<{ pairs: SharedPair[] }>(listKey))?.pairs ?? [];
	if (list.some((p) => p.heard === votes.heard && p.fixed === votes.fixed && p.voters === votes.voters.length)) return;
	const pairs = [{ heard: votes.heard, fixed: votes.fixed, voters: votes.voters.length }, ...list.filter((p) => p.heard !== votes.heard || p.fixed !== votes.fixed)]
		.sort((a, b) => b.voters - a.voters)
		.slice(0, MAX_PAIRS);
	await putObject(listKey, JSON.stringify({ pairs }), "application/json");
}

// Mistakes we collected ourselves (coach, 11 Nov: one Thai clip of ours), so the list helps from day one.
const SEED: Record<Lang, SharedPair[]> = {
	th: [
		["สิๆปี", "สิบๆ ปี"],
		["ไอเงย", "ไอเดีย"],
		["ไเงย", "ไอเดีย"],
		["วิ่งเหาๆ", "วิ่งเหยาะๆ"],
		["ประเน", "ประเมิน"],
		["ก้างๆ", "กว้างๆ"],
		["แคๆ", "แคบๆ"],
		["ผูหญิง", "ผู้หญิง"],
		["เื่อนไข", "เงื่อนไข"],
		["ติต่อ", "ติดต่อ"],
		["อาทิต", "อาทิตย์"],
		["ควคุม", "ควบคุม"],
		["ท่วงรัก", "ทวงรัก"],
		["พิมพ", "พิมพ์"],
		["ปหา", "ปัญหา"],
		["สัพันธ์", "สัมพันธ์"],
	].map(([heard, fixed]) => ({ heard, fixed, voters: 0 })),
	latin: [],
};

// What the spelling AI is shown for a script: the language's shared fixes, most voted first.
export async function sharedFixes(thai: boolean, limit: number): Promise<SharedPair[]> {
	const lang: Lang = thai ? "th" : "latin";
	const saved = (await getJson<{ pairs: SharedPair[] }>(`shared-words/${lang}.json`).catch(() => null))?.pairs ?? [];
	const seen = new Set(saved.map((p) => p.heard));
	return [...saved, ...SEED[lang].filter((p) => !seen.has(p.heard))].slice(0, limit);
}
