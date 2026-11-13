// Deepgram writes Thai in pieces of words, sometimes single letters or tone marks ("ผู" "้" "หญิง").
// Here the pieces are joined back into real Thai words with newmm (lib/newmm.ts), so the script, word fixes
// and subtitles work on words. Not Intl.Segmenter: it cut spoken Thai too small ("วัน|นี้", "ผู้|หญิง").
// Pieces are only ever joined, never split, and each word keeps its first piece's start and last piece's end.

import { cutThaiWords } from "./newmm";

type Word = { text: string; start: number; end: number };

const THAI = /[฀-๿]/;
const RUN_GAP = 0.3; // pieces further apart than this (seconds) are never one word
const THAI_MARK_FIRST = /^[ัำ-ฺ็-๎]/; // a vowel or tone mark that can't begin a word

const fixThai = (text: string) => text.replace(/ํา/g, "ำ");

// For each word: the positions (in `words`) of the pieces it was made from.
export function thaiWordGroups(words: Word[]): number[][] {
	const groups: number[][] = [];
	let i = 0;
	while (i < words.length) {
		// A run: Thai pieces right after one another.
		let j = i;
		if (THAI.test(words[i].text)) {
			// A piece that starts with a vowel or tone mark ("ส" "่วน") belongs to the one before it, however long the gap:
			// alone it can't be read, and the gap was cut as silence (VID20261112093656, 13 Nov).
			while (j + 1 < words.length && THAI.test(words[j + 1].text) && (words[j + 1].start - words[j].end <= RUN_GAP || THAI_MARK_FIRST.test(words[j + 1].text))) j++;
		}
		if (j === i) {
			groups.push([i++]);
			continue;
		}
		const texts = words.slice(i, j + 1).map((w) => fixThai(w.text));
		const text = texts.join("");
		const cuts = new Set<number>();
		let end = 0;
		for (const word of cutThaiWords(text)) cuts.add((end += word.length));
		// Keep a break between two pieces only where the dictionary also puts one.
		let group = [i];
		let offset = 0;
		for (let k = i + 1; k <= j; k++) {
			offset += texts[k - 1 - i].length;
			if (cuts.has(offset)) {
				groups.push(group);
				group = [];
			}
			group.push(k);
		}
		groups.push(group);
		i = j + 1;
	}
	return groups;
}

export function joinGroup<W extends Word>(words: W[], group: number[]): W {
	const first = words[group[0]];
	if (group.length === 1) return first;
	return { ...first, text: fixThai(group.map((k) => words[k].text).join("")), end: words[group[group.length - 1]].end };
}

export const mergeThaiWords = <W extends Word>(words: W[]): W[] => thaiWordGroups(words).map((g) => joinGroup(words, g));

// An edit.json made before words were joined: join them now and move the deleted words and fixes
// (which point at positions in the word list) onto the new positions. Null if nothing changes.
export function mergeThaiEdit<
	E extends { words: Word[]; deleted?: number[]; fixes?: { from: number; to: number; text: string }[] },
>(edit: E): E | null {
	const groups = thaiWordGroups(edit.words);
	if (groups.length === edit.words.length) return null;
	const newIndex: number[] = [];
	groups.forEach((g, n) => g.forEach((k) => (newIndex[k] = n)));
	// A word stays deleted only if all of its pieces were deleted.
	const gone = new Set(edit.deleted ?? []);
	const deleted = groups.flatMap((g, n) => (g.every((k) => gone.has(k)) ? [n] : []));
	// A fix now covers the whole words its pieces belong to, keeping the pieces it didn't cover
	// ("ผู" fixed to "ผู้" in "ผู|หญิง" becomes "ผู้หญิง"). One that runs into the previous fix is dropped.
	const fixes: { from: number; to: number; text: string }[] = [];
	const piece = (k: number) => fixThai(edit.words[k].text);
	for (const f of [...(edit.fixes ?? [])].sort((a, b) => a.from - b.from)) {
		const from = newIndex[f.from];
		const to = newIndex[f.to];
		if (from === undefined || to === undefined) continue;
		if (fixes.length && from <= fixes[fixes.length - 1].to) continue;
		const before = groups[from].filter((k) => k < f.from).map(piece).join("");
		const after = groups[to].filter((k) => k > f.to).map(piece).join("");
		fixes.push({ from, to, text: before + f.text + after });
	}
	return {
		...edit,
		words: groups.map((g) => joinGroup(edit.words, g)),
		...(edit.deleted ? { deleted } : {}),
		...(edit.fixes ? { fixes } : {}),
	};
}
