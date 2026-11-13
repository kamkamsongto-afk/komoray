import { hmac } from "./callback";
import { cutThaiWords, isThaiWord } from "./newmm";
import { getJson, putObject } from "./r2";
import { realThaiWords } from "./word-check";
import { type WordUse, wordUse } from "./word-rules";

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
const MAX_THAI_LETTERS = 20; // a Thai fix is a word or two, never a sentence
export type SharedPair = { heard: string; fixed: string; voters: number };
type Votes = { heard: string; fixed: string; voters: string[] };
export type Lang = "th" | "latin";

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
		if (h.length > MAX_THAI_LETTERS || f.length > MAX_THAI_LETTERS) return null;
		if (!/^[฀-๿ ]+$/.test(h) || !/^[฀-๿ ]+$/.test(f)) return null;
		const words = f.split(/\s+/).flatMap((part) => cutThaiWords(part.replace(/ๆ/g, "")));
		return words.length && words.every((w) => isThaiWord(w)) ? "th" : null;
	}
	// One word only: an instruction needs a sentence.
	if (!/^[\p{Ll}'-]+$/u.test(f) || !/^[\p{Ll}'-]+$/u.test(h)) return null;
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

// What may go into Word Hub by itself, from the admin's fixes or creators' shared ones (coach, 13 Nov: "My words is
// your own list, Word Hub the shared one, and not every save should land there"): ordinary words (shareable) that
// are a clear misspelling, the heard side no real word (ผูหญิง → ผู้หญิง). A word right in other sentences (เนี่ย,
// สวน → ส่วน) stays in the creator's My words. The team still adds any pair by hand on the Word Hub tab.
export function hubLang(heard: string, fixed: string): Lang | null {
	const lang = shareable(heard, fixed);
	return lang && wordUse(heard, fixed, { realWords: realThaiWords, shared: true }) === "always" ? lang : null;
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
	const lang = hubLang(heard, fixed);
	if (!lang) return;
	const voter = (await hmac(`shared-words:${secret}`, userId)).slice(0, 16);
	const key = `shared-words/votes/${lang}/${await pairId(lang, heard.trim(), fixed.trim())}.json`;
	const votes = (await getJson<Votes>(key)) ?? { heard: heard.trim(), fixed: fixed.trim(), voters: [] };
	if (!votes.voters.includes(voter) && votes.voters.length < MAX_VOTERS) {
		votes.voters.push(voter);
		await putObject(key, JSON.stringify(votes), "application/json");
	}
	if (votes.voters.length < MIN_VOTERS) return;
	if ((await readBlocked(lang)).has(votes.heard)) return; // the team took it off (admin Words tab)
	const listKey = `shared-words/${lang}.json`;
	const list = (await getJson<{ pairs: SharedPair[] }>(listKey))?.pairs ?? [];
	if (list.some((p) => p.heard === votes.heard && p.fixed === votes.fixed && p.voters === votes.voters.length)) return;
	const pairs = [{ heard: votes.heard, fixed: votes.fixed, voters: votes.voters.length }, ...list.filter((p) => p.heard !== votes.heard || p.fixed !== votes.fixed)]
		.sort((a, b) => b.voters - a.voters)
		.slice(0, MAX_PAIRS);
	await putObject(listKey, JSON.stringify({ pairs }), "application/json");
}

// Mistakes we collected ourselves (coach, 11 Nov: one Thai clip of ours), so the list helps from day one.
export const SEED: Record<Lang, SharedPair[]> = {
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

// Komoray's own word list (coach, 11 Nov: our own correct Thai first, before creators share theirs): pairs the team
// checked, at shared-words/curated-<list>.json. It grows two ways: the admin's own word fixes go in by themselves
// (api/dictionary, ordinary words only, as shareable checks), and the admin adds or removes pairs on the admin page
// (Words tab). It needs no votes: we checked it. Nothing in it comes from customers.
// A list per language (coach, 13 Nov): "th", a language code from lib/languages.ts for pairs from videos that saved
// their language, and "latin" for the other languages' pairs from before. use: what the team set (always, ai, off;
// none: lib/word-rules.ts decides), reviewed: the team looked at it, uses: how many times it was added.
export type CuratedPair = { heard: string; fixed: string; at: string; uses?: number; use?: WordUse; reviewed?: boolean };
export type WordList = string; // "th", "latin", or a language code
const MAX_CURATED = 20_000;
const curatedKey = (list: WordList) => `shared-words/curated-${list}.json`;
export const readCurated = async (list: WordList) => (await getJson<{ pairs: CuratedPair[] }>(curatedKey(list)).catch(() => null))?.pairs ?? [];
const tidy = (text: string) => text.trim().replace(/\s+/g, " ");
export const isWordList = (list: unknown): list is WordList => typeof list === "string" && /^(th|latin|[a-z]{2})$/.test(list);
// Where a pair goes: Thai to "th", others to their video's language when known, else "latin".
export const listFor = (lang: Lang, language?: string): WordList => (lang === "th" ? "th" : language && language !== "th" && /^[a-z]{2}$/.test(language) ? language : "latin");

// How a pair of Komoray's list is used on everyone's videos: what the team set, else the rules. A Thai pair whose fixed
// side has a word the dictionary lacks (ไบโอ, a name) is only the AI's to use until the team approves it: the admin's
// own fixes come in without the dictionary check, and "Always" goes on every creator's video (13 Nov).
export function effectiveUse(p: { heard: string; fixed: string; use?: WordUse; reviewed?: boolean }): WordUse {
	if (p.use) return p.use;
	const rule = wordUse(p.heard, p.fixed, { realWords: realThaiWords, shared: true });
	if (rule === "always" && !p.reviewed && THAI.test(p.fixed) && !realThaiWords(p.fixed.replace(/\s+/g, ""))) return "ai";
	return rule;
}

// A pair the team typed in: short, Thai or letters only (a team member may add a word the dictionary lacks).
export function curatable(heard: string, fixed: string): Lang | null {
	const h = tidy(heard);
	const f = tidy(fixed);
	if (!h || !f || h === f || h.length > MAX_LETTERS || f.length > MAX_LETTERS) return null;
	if (/[0-9๐-๙@#/:\\_{}<>]/.test(h + f)) return null;
	if (THAI.test(f)) return /^[฀-๿ ]+$/.test(h + f) ? "th" : null;
	return /^[\p{L}' -]+$/u.test(h + f) ? "latin" : null;
}

// Add (or change: the same heard with a new fixed) and remove pairs. Newest first. Adding one already there counts
// it up (uses) and keeps what the team set for it, unless it now reads differently.
// The list is read without readCurated's fallback: if R2 can't be read, nothing is written, so a hiccup can't save an
// empty list over it (Codex review 11 Nov). Two changes at the same moment can still lose one: only the admin writes
// here, rarely at once, and a lost pair comes back the next time it is fixed.
export async function changeCurated(list: WordList, add: { heard: string; fixed: string }[], remove: string[] = []) {
	const now = new Date().toISOString();
	const saved = (await getJson<{ pairs: CuratedPair[] }>(curatedKey(list)))?.pairs ?? [];
	const before = new Map(saved.map((p) => [p.heard, p]));
	const fresh = add.map((p): CuratedPair => {
		const heard = tidy(p.heard);
		const fixed = tidy(p.fixed);
		const old = before.get(heard);
		const same = old?.fixed === fixed;
		return { heard, fixed, at: now, uses: (same ? (old?.uses ?? 1) : 0) + 1, ...(same && old?.use && { use: old.use }), ...(same && old?.reviewed && { reviewed: true }) };
	});
	const gone = new Set([...remove.map(tidy), ...fresh.map((p) => p.heard)]);
	const pairs = [...fresh, ...saved.filter((p) => !gone.has(p.heard))].slice(0, MAX_CURATED);
	await putObject(curatedKey(list), JSON.stringify({ pairs }), "application/json");
	return pairs;
}

// The team's changes from the Words tab, by heard: what it is fixed to (or a new heard), how it is used (null: back
// to the rules), reviewed.
export type CuratedChange = { heard: string; newHeard?: string; fixed?: string; use?: WordUse | null; reviewed?: boolean };
export async function updateCurated(list: WordList, changes: CuratedChange[]) {
	const saved = (await getJson<{ pairs: CuratedPair[] }>(curatedKey(list)))?.pairs ?? [];
	const byHeard = new Map(changes.map((c) => [tidy(c.heard), c]));
	const pairs = saved.map((p) => {
		const c = byHeard.get(p.heard);
		if (!c) return p;
		const next: CuratedPair = { ...p, ...(c.newHeard && { heard: tidy(c.newHeard) }), ...(c.fixed && { fixed: tidy(c.fixed) }), ...(c.reviewed !== undefined && { reviewed: c.reviewed }) };
		if (c.use === null) delete next.use;
		else if (c.use) next.use = c.use;
		return next;
	});
	// A new heard that another pair already has: the one changed now wins.
	const changed = new Set(changes.map((c) => tidy(c.newHeard ?? c.heard)));
	const ordered = [...pairs.filter((p) => changed.has(p.heard)), ...pairs.filter((p) => !changed.has(p.heard))];
	const seen = new Set<string>();
	const unique = ordered.filter((p) => (seen.has(p.heard) ? false : (seen.add(p.heard), true)));
	await putObject(curatedKey(list), JSON.stringify({ pairs: unique }), "application/json");
	return unique;
}

// Creators' pairs (shared-words/<th|latin>.json) the team took off: never shown to the AI again.
const blockedKey = (lang: Lang) => `shared-words/blocked-${lang}.json`;
export const readBlocked = async (lang: Lang) => new Set((await getJson<{ heards: string[] }>(blockedKey(lang)).catch(() => null))?.heards ?? []);
// Taken off: out of the list the AI reads too. The anonymous vote counts stay (votes/), so the pair can't come back
// with the next vote, and a creator who asks (Privacy: email us) is handled by hand.
export async function blockShared(lang: Lang, heards: string[]) {
	const now = new Set((await getJson<{ heards: string[] }>(blockedKey(lang)))?.heards ?? []); // no fallback: a hiccup can't empty it
	for (const h of heards) now.add(tidy(h));
	await putObject(blockedKey(lang), JSON.stringify({ heards: [...now] }), "application/json");
	const listKey = `shared-words/${lang}.json`;
	const list = (await getJson<{ pairs: SharedPair[] }>(listKey))?.pairs;
	if (list?.some((p) => now.has(p.heard))) await putObject(listKey, JSON.stringify({ pairs: list.filter((p) => !now.has(p.heard)) }), "application/json");
}
export const readVoted = async (lang: Lang) => (await getJson<{ pairs: SharedPair[] }>(`shared-words/${lang}.json`).catch(() => null))?.pairs ?? [];

// What the spelling AI may be shown, for a video in `language` (or Thai): our own list first (that language's, and the
// older "latin" one), then what creators agreed on and the team didn't take off, then the first mistakes we collected
// (SEED). Each with how it is used; "off" pairs are left out. lib/spelling.ts shows only the ones in the part it reads.
export async function sharedFixes(thai: boolean, language?: string): Promise<(SharedPair & { use: WordUse })[]> {
	const lang: Lang = thai ? "th" : "latin";
	const lists = thai ? ["th"] : [...new Set([listFor("latin", language), "latin"])];
	const [curated, voted, blocked] = await Promise.all([Promise.all(lists.map(readCurated)).then((l) => l.flat()), readVoted(lang), readBlocked(lang)]);
	const out: (SharedPair & { use: WordUse })[] = [];
	const seen = new Set<string>();
	for (const p of [...curated.map((c) => ({ ...c, voters: 0 })), ...voted.filter((v) => !blocked.has(v.heard)), ...SEED[lang]]) {
		if (seen.has(p.heard)) continue;
		seen.add(p.heard);
		const use = effectiveUse(p);
		if (use !== "off") out.push({ heard: p.heard, fixed: p.fixed, voters: p.voters, use });
	}
	return out;
}

// One row of the admin's Words tab (api/admin/words).
export type WordRow = {
	heard: string;
	fixed: string;
	at?: string;
	uses: number; // team: times added; creators: how many creators made it
	source: "team" | "creators";
	rule: WordUse; // what lib/word-rules.ts makes of it
	set?: WordUse; // what the team chose
	use: WordUse; // how it is used now
	reviewed: boolean;
};

