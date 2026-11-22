// Deepgram writes Thai in pieces of words, sometimes single letters or tone marks ("ผู" "้" "หญิง").
// Here the pieces are joined back into real Thai words with newmm (lib/newmm.ts), so the script, word fixes
// and subtitles work on words. Not Intl.Segmenter: it cut spoken Thai too small ("วัน|นี้", "ผู้|หญิง").
// Pieces are only ever joined, never split, and each word keeps its first piece's start and last piece's end.

import { cutThaiWords, isThaiWord } from "./newmm";

type Word = { text: string; start: number; end: number };

const THAI = /[฀-๿]/;
const RUN_GAP = 0.3; // pieces further apart than this (seconds) are never one word
const THAI_MARK_FIRST = /^[ัำ-ฺ็-๎]/; // a vowel or tone mark that can't begin a word
const NUMBER_START = /^(?:\d[,.]?|19|20)$/; // one digit (or one with a comma or point after it): the start of a number said digit by digit
// A piece that is no word of its own ("ป", "ไม", "สร") followed by the rest of its word, after a pause longer than RUN_GAP
// (Deepgram sometimes breaks one word with a pause: "ป" ... "กติ" for ปกติ, the pause was cut as silence, coach 22 Nov).
// Joined only if the two together are one dictionary word, and within FRAGMENT_GAP seconds.
const FRAGMENT_GAP = 1.2;
const FRAGMENT_MAX = 3; // letters: a fragment is short, a whole word is not
const oneWord = (text: string) => {
	const parts = cutThaiWords(text);
	return parts.length === 1 && isThaiWord(parts[0]);
};
const isFragment = (text: string) => text.length <= FRAGMENT_MAX && THAI.test(text) && !isThaiWord(text);
const NUMBER_GAP = 1; // seconds: digits said further apart than this are not one number

const fixThai = (text: string) => text.replace(/ํา/g, "ำ");

// English said inside Thai comes in pieces too, glued end to start with no gap: "cre" "at" "or", "b" "a" "ck" "g" "d"
// (VID20261112103855, 15 Nov), and Highlight lit each piece in turn. Pieces of Latin letters with no gap at all between
// them are one word, unless the next starts with a capital after a small letter (a new word, a name). Only in a
// mostly-Thai transcript: in English, words said in a row can also touch.
const LATIN_PIECE = /^\p{Script=Latin}+$/u;
const LATIN_GLUE = 0.01; // seconds: pieces this close are glued; Deepgram gives the same time to both
const THAI_SHARE = 0.3; // share of pieces that are Thai for a transcript to count as Thai
const startsNewWord = (prev: string, next: string) => /\p{Ll}$/u.test(prev) && /^\p{Lu}/u.test(next);

// For each word: the positions (in `words`) of the pieces it was made from.
export function thaiWordGroups(words: Word[]): number[][] {
	const groups: number[][] = [];
	const thai = words.length > 0 && words.filter((w) => THAI.test(w.text)).length / words.length >= THAI_SHARE;
	let i = 0;
	while (i < words.length) {
		// A run: Thai pieces right after one another.
		let j = i;
		if (thai && LATIN_PIECE.test(words[i].text)) {
			while (j + 1 < words.length && LATIN_PIECE.test(words[j + 1].text) && words[j + 1].start - words[j].end <= LATIN_GLUE && !startsNewWord(words[j].text, words[j + 1].text)) j++;
			groups.push(Array.from({ length: j - i + 1 }, (_, k) => i + k));
			i = j + 1;
			continue;
		}
		// A number said digit by digit comes in pieces too: "9" "9" "0" for 990, "2," "9" "9" "0" for 2,990 (VID20261120105025,
		// 22 Nov). One word, so the script, subtitles and word-by-word looks never break inside it. Joined only when the next
		// piece is a single digit (or, after a comma, a group of three), never two whole numbers ("10" "20"), and when
		// said within NUMBER_GAP. Thai only until other languages are measured (a count "1 2 3" in English must stay three words).
		// lib/timeline.ts insideNumber is the line-break twin.
		if (thai && NUMBER_START.test(words[i].text)) {
			// Pieces: a single digit, three digits after a comma, a piece that begins with 0 ("4" "00", "1" "000"), and a year said
			// as two pairs ("19" "78" after ปี: Deepgram's Thai does this, FLEURS 22 Nov). Never two whole numbers ("10" "20").
			const year = (k: number) => /^(19|20)$/.test(words[k].text) && /^\d\d$/.test(words[k + 1].text) && /^(ปี|ค\.ศ\.|พ\.ศ\.)$/.test(words[i - 1]?.text ?? "");
			const grouped = (k: number) => {
				const [a, b] = [words[k].text, words[k + 1].text];
				if (/^\d$/.test(a) || a.endsWith(",")) return a.endsWith(",") ? /^\d{3}[,.]?$|^\d$/.test(b) : /^\d[,.]?$|^0\d*[,.]?$/.test(b);
				return k === i && year(k);
			};
			while (j + 1 < words.length && grouped(j) && words[j + 1].start - words[j].end <= NUMBER_GAP) j++;
			if (j > i) {
				groups.push(Array.from({ length: j - i + 1 }, (_, k) => i + k));
				i = j + 1;
				continue;
			}
		}
		if (THAI.test(words[i].text)) {
			// A piece that starts with a vowel or tone mark ("ส" "่วน") belongs to the one before it, however long the gap:
			// alone it can't be read, and the gap was cut as silence (VID20261112093656, 13 Nov).
			while (
				j + 1 < words.length &&
				THAI.test(words[j + 1].text) &&
				(words[j + 1].start - words[j].end <= RUN_GAP ||
					THAI_MARK_FIRST.test(words[j + 1].text) ||
					(words[j + 1].start - words[j].end <= FRAGMENT_GAP && isFragment(words[j].text) && oneWord(words[j].text + words[j + 1].text)))
			)
				j++;
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
