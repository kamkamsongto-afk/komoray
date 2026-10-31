// Repeated takes: the speaker starts a sentence, stops, and says it again ("Today I want to... Today
// I want to show you"). The earlier tries are bad takes; the last one is the keeper. Found by
// comparing how sentences start, right in the browser, no AI needed. Each take found here can be
// cut (its words become deleted words) or kept by the user.
import { normText } from "./edit";
import { THAI_ENDINGS } from "./timeline";

type Word = { text: string; start: number; end: number };

// One bad take: words from..to are said again from `again` on.
export type Take = { from: number; to: number; again: number; matched: number };

const SENTENCE_PAUSE = 0.25; // a pause this long (seconds) can start a new sentence
const MIN_MATCH_WORDS = 3; // the retry starts with at least this many of the same words
const MIN_MATCH_LETTERS = 8; // ...and they are not just three short words ("ที่ จะ ไม่")
const MAX_TAKE_SECONDS = 25; // a bad take is never longer than this
const MAX_TAKE_WORDS = 60;
// A retry said straight after, with no pause at all ("ทักมาได้ทั้งแอป ทักมาได้เลย"): any word can
// start it, so it has to come back sooner.
const MAX_RESTART_SECONDS = 8;
const MAX_RESTART_WORDS = 15;
// Sounds that can sit in front of a retry without making it different ("So, today I...").
const FILLERS = new Set(["um", "uh", "uhm", "erm", "hmm", "so", "okay", "ok", "and", "เอ่อ", "อ่า", "อืม", "เออ", "แบบ", "คือ"]);

const key = (w: Word) => normText(w.text.replace(/ํา/g, "ำ"));
const ENDS_SENTENCE = /[.!?…]$/;
const DECIMAL = /\d\.$/; // "24." then "99": a price, not the end of a sentence

// Positions where a sentence can start: the first word, after a pause, or after . ! ?
function sentenceStarts(words: Word[]) {
	const starts: number[] = [];
	for (let i = 0; i < words.length; i++) {
		const prev = words[i - 1];
		const after = prev?.text.trim() ?? "";
		const decimal = DECIMAL.test(after) && /^\d/.test(words[i].text);
		if (!prev || (!decimal && (words[i].start - prev.end >= SENTENCE_PAUSE || ENDS_SENTENCE.test(after)))) starts.push(i);
	}
	return starts;
}

// Skip filler sounds at a sentence start.
function skipFillers(words: Word[], i: number, limit: number) {
	while (i < limit && FILLERS.has(key(words[i]))) i++;
	return i;
}

// How many words from a and b read the same, without running a into b.
function sameStart(words: Word[], a: number, b: number) {
	let n = 0;
	let letters = 0;
	let core = 0; // letters without polite endings ("หนึ่ง นะ ครับ" is not much of a match)
	while (a + n < b && b + n < words.length && key(words[a + n]) && key(words[a + n]) === key(words[b + n])) {
		letters += key(words[a + n]).length;
		if (!THAI_ENDINGS.has(key(words[a + n]))) core += key(words[a + n]).length;
		n++;
	}
	return { n, letters, core };
}

export function findRepeatedTakes(words: Word[]): Take[] {
	const starts = sentenceStarts(words);
	const takes: Take[] = [];
	for (let s = 1; s < starts.length; s++) {
		const again = starts[s];
		const b = skipFillers(words, again, words.length);
		// The nearest earlier sentence that starts the same way.
		for (let p = s - 1; p >= 0; p--) {
			const from = starts[p];
			if (words[again].start - words[from].start > MAX_TAKE_SECONDS || again - from > MAX_TAKE_WORDS) break;
			const a = skipFillers(words, from, again);
			const { n, letters } = sameStart(words, a, b);
			if (n >= MIN_MATCH_WORDS && letters >= MIN_MATCH_LETTERS) {
				takes.push({ from, to: again - 1, again, matched: n });
				break;
			}
		}
	}
	// Retries with no pause before them: the same words again within a few seconds, from any word.
	for (let from = 0; from < words.length; from++) {
		for (let again = from + 1; again < words.length; again++) {
			if (words[again].start - words[from].start > MAX_RESTART_SECONDS || again - from > MAX_RESTART_WORDS) break;
			const { n, core } = sameStart(words, from, again);
			if (n >= MIN_MATCH_WORDS && core >= MIN_MATCH_LETTERS) {
				if (!takes.some((t) => t.from === from && t.again === again)) takes.push({ from, to: again - 1, again, matched: n });
				from = again - 1; // go on from the retry, which may be retried again
				break;
			}
		}
	}
	// Never cut into the start of a keeper: a take that runs over where another retry begins is dropped.
	// A take inside a longer one (a retry of a retry) is already covered by it.
	return takes.filter(
		(t) =>
			!takes.some((o) => o !== t && o.again > t.from && o.again <= t.to) &&
			!takes.some((o) => o !== t && o.from <= t.from && o.to >= t.to && (o.from < t.from || o.to > t.to)),
	);
}
