// Word pairs worth adding to Word Hub, mined from the admin's own videos (coach, 28 Nov: sending the times of wrong
// words by hand is tiring): every word fixed by hand that the list doesn't have yet, also with the word before or after
// it, and how often each way of writing it shows up in those videos. Plain counting, no AI. The admin decides each one:
// nothing here is put on a video by itself. Used by api/admin/words/suggestions.

import { learnFromFix, thaiSpoken } from "./word-rules";

type Fix = { from: number; to: number; text: string };
export type Clip = { words: { text: string }[]; fixes: Fix[]; ai: Fix[]; language?: string };
// left: places in those videos that read `heard` where a rule would not give what the finished script reads. safe: the heard side can't be right as it is (the route says, with the dictionary).
export type Variant = { with: "none" | "before" | "after"; heard: string; fixed: string; seen: number; left: number; safe: boolean };
export type Suggestion = { id: string; times: number; language?: string; variants: Variant[]; pick: number };

const THAI = /[฀-๿]/;
const MAX_RUN = 4; // words a pair can cover (placeAlways in lib/spelling.ts)
const SAFE_LETTERS = 3; // a shorter heard side is offered with a neighbour first (lib/word-rules.ts MIN_HEARD)
const TRAIL = /[.,!?;:…"'“”‘’()]+/g;

const fixThai = (text: string) => text.replace(/ํา/g, "ำ");
export const squash = (text: string) => fixThai(text).replace(/\s+/g, "").toLowerCase();
const bare = (text: string) => squash(text).replace(TRAIL, "");
const tidy = (text: string) => fixThai(text).trim().replace(/\s+/g, " ");
const join = (a: string, b: string) => (THAI.test(a.slice(-1)) && THAI.test(b.slice(0, 1)) ? a + b : `${a} ${b}`);

// The parts of one hand fix that could be a rule: the words it covers (i..j) and what they should read.
function candidates(clip: Clip, f: Fix, cut: (thai: string) => string[], oneWord: (thai: string) => boolean) {
	const pieces = clip.words.slice(f.from, f.to + 1).map((w) => fixThai(w.text));
	const lesson = learnFromFix(pieces, f.text, cut);
	if (lesson.kind === "spelling") {
		return lesson.pairs.flatMap((p) => {
			for (let i = 0; i < pieces.length; i++)
				for (let j = i; j < pieces.length; j++) if (bare(pieces.slice(i, j + 1).join("")) === bare(p.heard)) return [{ i: f.from + i, j: f.from + j, fixed: p.fixed }];
			return [];
		});
	}
	// Thai "ฉ" → "ฉะนั้น" counts as words added, yet it is a word the speech-to-text cut short, and so is โปร แก ร เม →
	// โปรแกรมเมอร์ (one dictionary word). Words typed before, after or between what was heard (ใช่ → ไม่ใช่, ผม ไป →
	// ผมจะไม่ได้ไป) were missed at that moment only.
	if (lesson.kind !== "added" || !THAI.test(pieces.join(""))) return [];
	const heard = bare(pieces.join(""));
	const fixed = bare(f.text);
	const extra = fixed.startsWith(heard) ? fixed.slice(heard.length) : fixed.endsWith(heard) ? fixed.slice(0, -heard.length) : null;
	if (extra === null ? !oneWord(fixed) : /^[ก-ฮเ-ไa-z]/.test(extra)) return [];
	return [{ i: f.from, j: f.to, fixed: f.text }];
}

// The finished script over words i..j: the fixes in place of the words they cover (whole, where one reaches further).
function reads(clip: Clip, i: number, j: number) {
	let text = "";
	for (let k = i; k <= j; ) {
		const fix = clip.fixes.find((f) => f.from <= k && f.to >= k);
		text += fix ? fix.text : clip.words[k].text;
		k = fix ? fix.to + 1 : k + 1;
	}
	return text;
}

// Whether a rule putting `fixed` on words i..j would give what the finished script reads there, taking in the whole of
// any fix that reaches into them. "The script has the fixed words somewhere" is not enough: เพราะ ฉ → เพราะฉะนั้น over
// "เพราะ ฉ นั้น" says นั้น twice, and ยาย → ยา would change every ยาย said right (review 28 Nov).
function agrees(clip: Clip, i: number, j: number, fixed: string) {
	const covering = (k: number) => clip.fixes.find((f) => f.from <= k && f.to >= k);
	const lo = covering(i)?.from ?? i;
	const hi = covering(j)?.to ?? j;
	const raw = (a: number, b: number) => clip.words.slice(a, b).map((w) => w.text).join("");
	return bare(raw(lo, i) + fixed + raw(j + 1, hi + 1)) === bare(reads(clip, lo, hi));
}

// clips: newest first. cut: the Thai dictionary. oneWord: is this one word of it. allowed: may this pair go into a list (curatable). known: is this
// heard side already in a list. done: was this suggestion already added or skipped.
export function suggestWords(
	clips: Clip[],
	options: {
		cut: (thai: string) => string[];
		oneWord: (thai: string) => boolean;
		allowed: (heard: string, fixed: string) => boolean;
		known: (heard: string) => boolean;
		done: (id: string) => boolean;
		safe: (heard: string, fixed: string) => boolean;
	},
): Suggestion[] {
	const found = new Map<string, Suggestion>();
	for (const clip of clips) {
		const byAi = new Set(clip.ai.map((f) => `${f.from}|${f.to}|${squash(f.text)}`));
		const under = (k: number) => clip.fixes.some((f) => f.from <= k && f.to >= k);
		for (const f of clip.fixes) {
			if (byAi.has(`${f.from}|${f.to}|${squash(f.text)}`) || f.to >= clip.words.length) continue;
			for (const c of candidates(clip, f, options.cut, options.oneWord)) {
				const heard = tidy(clip.words.slice(c.i, c.j + 1).map((w) => w.text).join(" "));
				const fixed = tidy(c.fixed);
				const id = `${squash(heard)}>${squash(fixed)}`;
				if (squash(heard) === squash(fixed) || options.done(id)) continue;
				const old = found.get(id);
				if (old) {
					old.times++;
					continue;
				}
				// As fixed, then with the word before and after, where that word wasn't itself fixed (it may be wrong as heard).
				const ways: Pick<Variant, "with" | "heard" | "fixed">[] = [{ with: "none", heard, fixed }];
				const before = c.i > 0 && !under(c.i - 1) ? tidy(clip.words[c.i - 1].text) : "";
				const after = c.j + 1 < clip.words.length && !under(c.j + 1) ? tidy(clip.words[c.j + 1].text) : "";
				if (before) ways.push({ with: "before", heard: `${before} ${heard}`, fixed: join(before, fixed) });
				if (after) ways.push({ with: "after", heard: `${heard} ${after}`, fixed: join(fixed, after) });
				const variants = ways
					.filter((v, k) => c.j - c.i + (k ? 2 : 1) <= MAX_RUN && options.allowed(v.heard, v.fixed) && !options.known(v.heard))
					.map((v) => ({ ...v, seen: 0, left: 0, safe: options.safe(v.heard, v.fixed) }));
				// Already in a list as fixed: nothing to suggest.
				if (variants[0]?.with !== "none") continue;
				found.set(id, { id, times: 1, language: clip.language, variants, pick: 0 });
			}
		}
	}

	// How often each way shows up, in one walk through every video.
	const wanted = new Map<string, Variant[]>();
	for (const s of found.values()) for (const v of s.variants) wanted.set(squash(v.heard), [...(wanted.get(squash(v.heard)) ?? []), v]);
	for (const clip of clips) {
		for (let i = 0; i < clip.words.length; i++) {
			let said = "";
			for (let j = i; j < Math.min(clip.words.length, i + MAX_RUN); j++) {
				said += squash(clip.words[j].text);
				for (const v of wanted.get(said) ?? []) {
					v.seen++;
					if (!agrees(clip, i, j, v.fixed)) v.left++;
				}
			}
		}
	}

	// Offered first: long enough, changing nothing the creator left alone, then a safe one, then the shortest.
	for (const s of found.values()) {
		const rank = (v: Variant) => (thaiSpoken(v.heard) < SAFE_LETTERS ? 1_000_000 : 0) + v.left * 2 + (v.safe ? 0 : 1);
		s.pick = s.variants.reduce((best, v, k) => (rank(v) < rank(s.variants[best]) ? k : best), 0);
	}
	return [...found.values()].sort((a, b) => b.times - a.times || a.variants[a.pick].left - b.variants[b.pick].left);
}
