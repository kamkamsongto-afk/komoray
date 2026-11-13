// What a word fix teaches, and how a learned pair may be used (coach, 13 Nov). Every save used to go into My words as
// it was typed, spaces and all, and was put on every match of every new video: "ใช่" → "ไม่ใช่" became "ไม่ไม่ใช่",
// "เป็น" → "ที่เป็น" put "ที่" before every "เป็น", and "สวน" → "ส่วน" would turn a gardener's "สวนใหญ่" into "ส่วนใหญ่".
// So a fix is sorted first, with plain rules (instant, free, in the browser and on the server alike):
//   spacing   only spaces changed ("ดึงสติกลับมา" → "ดึงสติ กลับมา"): this video only, never learned
//   added     whole words typed in (ใช่ → ไม่ใช่) or  removed  (น่า น่าอาย → น่าอาย): what was missed or said
//             twice at that moment, this video only
//   style     numbers, English letters or ๆ came in or went (ห้า → ข้อ 5, เหนื่อย เหนื่อย → เหนื่อยๆ): this video only
//   rewrite   many words: this video only
//   spelling  letters wrong inside words ("ดึงงติ" → "ดึงสติ"): learned, only the words that changed, no spaces
// And a learned pair is used one of three ways (wordUse):
//   always    the heard side is no real word (ผูหญิง): put on every match, it can't be right as it was
//   ai        both sides are real words (สวน → ส่วน, กด → กฎ): only the spelling AI may put it on, reading the sentence
//   off       not a spelling fix: kept, never used
// The heard side counts as a real word when the Thai dictionary (lib/newmm.ts, server only) has every part of it.

export type FixKind = "same" | "spacing" | "added" | "removed" | "style" | "rewrite" | "spelling";
export type WordUse = "always" | "ai" | "off";
export type Pair = { heard: string; fixed: string };

const THAI = /[฀-๿]/;
const MARK_FIRST = /^[ัำ-ฺ็-๎]/; // a Thai vowel or tone mark, which can't begin a word
const MAX_PIECES = 4; // a pair learned is a word or two, never a phrase
const MAX_LETTERS = 30;
const MIN_HEARD = 3; // letters (not counting marks) a learned Thai pair keeps: shorter, it fits too many words
const MAX_GROWTH = 3; // more letters than this put into a word: words were missed, not misspelled
const TRAIL = /[.,!?;:…"'“”‘’()]+/g;
const STYLE = /[0-9๐-๙A-Za-z]/; // numbers and English letters among Thai: how it reads, not how it is spelled

const thaiLetters = (text: string) => [...text.replace(/ํา/g, "ำ").replace(/\s+/g, "").replace(TRAIL, "")];
const noSpace = (text: string) => text.replace(/\s+/g, "");

// pieces: the speech-to-text's words the fix covers, as it wrote them. typed: what the creator typed for them.
export function learnFromFix(pieces: string[], typed: string): { kind: FixKind; pairs: Pair[] } {
	const original = pieces.join(THAI.test(pieces.join("")) ? "" : " ");
	if (typed.trim() === original.trim()) return { kind: "same", pairs: [] };
	if (noSpace(typed) === noSpace(original)) return { kind: "spacing", pairs: [] };
	return THAI.test(original + typed) ? thaiFix(pieces, typed) : wordFix(pieces, typed);
}

// Each word the creator typed (split at their spaces) is lined up with the speech-to-text's letters, letter by letter,
// and a word that reads differently is learned as a pair: the pieces under it, whole, and what was typed for them,
// without spaces. Lining up per typed word keeps a pair to the word that changed ("ทีละ ก้อน": กอน → ก้อน, not กอ → ก้อ).
function thaiFix(pieces: string[], typed: string): { kind: FixKind; pairs: Pair[] } {
	const parts = pieces.map(thaiLetters);
	const A = parts.flat();
	const B = thaiLetters(typed);
	if (A.join("") === B.join("")) return { kind: "spacing", pairs: [] };
	if (STYLE.test(A.join("")) !== STYLE.test(B.join("")) || count(A, "ๆ") !== count(B, "ๆ")) return { kind: "style", pairs: [] };
	const { aAt, bAt } = lineUp(A, B);
	const spans: [number, number][] = [];
	let at = 0;
	for (const p of parts) spans.push([at, (at += p.length)]);

	// Where each typed word sits among B's letters.
	const words: [number, number][] = [];
	let b = 0;
	for (const w of typed.trim().split(/\s+/)) {
		const n = thaiLetters(w).length;
		if (n) words.push([b, (b += n)]);
	}
	// first..last: the pieces; a0..a1 and b0..b1: the letters of the typed words they came from, in A and in B.
	const found: { first: number; last: number; a0: number; a1: number; b0: number; b1: number }[] = [];
	let added = 0;
	let removed = 0;
	for (const [b0, b1] of words) {
		const a0 = aAt[b0];
		const a1 = aAt[b1];
		if (A.slice(a0, a1).join("") === B.slice(b0, b1).join("")) continue;
		if (a0 === a1) {
			added++; // a word typed where nothing was heard
			continue;
		}
		const first = spans.findIndex(([, e]) => e > a0);
		const last = spans.findLastIndex(([s]) => s < a1);
		const prev = found[found.length - 1];
		if (prev && first <= prev.last) Object.assign(prev, { last: Math.max(prev.last, last), a1, b1 });
		else found.push({ first, last, a0, a1, b0, b1 });
	}
	// Letters heard that no typed word took: words taken out.
	if (B.length === 0 || aAt[0] > 0 || aAt[B.length] < A.length) removed++;

	const pairs: Pair[] = [];
	// A piece at either end that reads the same as typed, and is a word of its own, isn't part of the mistake
	// ("ปก|กาสีแดง": ปก → ปาก). A short one stays (ทะ|เลา → ทะเลาะ is learned whole: "เลา" alone could be anything).
	const unchanged = (k: number) => parts[k].length >= 3 && parts[k].join("") === B.slice(bAt[spans[k][0]], bAt[spans[k][1]]).join("");
	// And what is left keeps at least MIN_HEARD letters: "ผู|ชาย" stays ผูชาย → ผู้ชาย, as ผู alone would be ผู้ here and
	// ผูก in ผู|พัน → ผูกพัน.
	const spoken = (first: number, last: number) => parts.slice(first, last + 1).flat().filter((l) => !/[ัิ-ฺ็-๎]/.test(l)).length;
	for (const span of found) {
		while (span.first < span.last && unchanged(span.first) && spoken(span.first + 1, span.last) >= MIN_HEARD) span.first++;
		while (span.last > span.first && unchanged(span.last) && spoken(span.first, span.last - 1) >= MIN_HEARD) span.last--;
	}
	for (const { first, last, a0, a1, b0, b1 } of found) {
		const heard = parts.slice(first, last + 1).flat();
		// What was typed in at either end of the typed word belongs to it ("ใช่" → "ไม่ใช่": the ไม่ before ใช่).
		const start = spans[first][0] <= a0 ? Math.min(bAt[spans[first][0]], b0) : bAt[spans[first][0]];
		const end = spans[last][1] >= a1 ? Math.max(bAt[spans[last][1]], b1) : bAt[spans[last][1]];
		const fixed = B.slice(start, end);
		const h = heard.join("");
		const f = fixed.join("");
		if (!f || h === f) continue;
		// Whole words put in or dropped inside the word typed (คุณ → ถ้าคุณ, รยา → ภรรยา): what was missed here.
		const extra = f.includes(h) ? f.replace(h, "") : h.includes(f) ? h.replace(f, "") : "";
		if (extra.length >= 2 && !MARK_FIRST.test(extra)) {
			if (f.length > h.length) added++;
			else removed++;
			continue;
		}
		if (fixed.length - heard.length > MAX_GROWTH) {
			added++;
			continue;
		}
		if (last - first + 1 > MAX_PIECES || fixed.length > MAX_LETTERS) continue;
		pairs.push({ heard: h, fixed: f });
	}
	if (pairs.length) return { kind: "spelling", pairs };
	return { kind: added ? "added" : removed ? "removed" : "rewrite", pairs: [] };
}

const count = (letters: string[], c: string) => letters.filter((l) => l === c).length;

// The cheapest way to turn A into B, letter by letter: for each place in B, how many of A's letters come before it
// (aAt), and for each place in A, how many of B's (bAt). A fix is short, so this is quick.
function lineUp(A: string[], B: string[]) {
	const D = Array.from({ length: A.length + 1 }, (_, i) => Array.from({ length: B.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
	for (let i = 1; i <= A.length; i++) for (let j = 1; j <= B.length; j++) D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1));
	// The steps from the end back to the start, then walked forwards.
	const steps: ("both" | "a" | "b")[] = [];
	for (let i = A.length, j = B.length; i > 0 || j > 0; ) {
		if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1)) {
			steps.push("both");
			i--;
			j--;
		} else if (j > 0 && D[i][j] === D[i][j - 1] + 1) {
			steps.push("b");
			j--;
		} else {
			steps.push("a");
			i--;
		}
	}
	const aAt = new Array<number>(B.length + 1).fill(A.length);
	const bAt = new Array<number>(A.length + 1).fill(B.length);
	let a = 0;
	let b = 0;
	for (const step of steps.reverse()) {
		if (step !== "a") aAt[b] = a; // B's letter b comes after a of A's
		if (step !== "b") bAt[a] = b;
		if (step !== "b") a++;
		if (step !== "a") b++;
	}
	return { aAt, bAt };
}

function wordFix(pieces: string[], typed: string): { kind: FixKind; pairs: Pair[] } {
	const A = pieces.join(" ").trim().split(/\s+/);
	const B = typed.trim().split(/\s+/);
	const same = (a: string, b: string) => a.replace(TRAIL, "") === b.replace(TRAIL, "");
	let head = 0;
	while (head < A.length && head < B.length && same(A[head], B[head])) head++;
	let tail = 0;
	while (tail < A.length - head && tail < B.length - head && same(A[A.length - 1 - tail], B[B.length - 1 - tail])) tail++;
	const took = A.slice(head, A.length - tail);
	const put = B.slice(head, B.length - tail);
	// Only the spaces and capitals of a name changed ("Ali express" → "AliExpress"): learned whole.
	if (took.length && put.length && noSpace(took.join("")).toLowerCase() === noSpace(put.join("")).toLowerCase())
		return { kind: "spelling", pairs: [{ heard: took.join(" ").replace(TRAIL, ""), fixed: put.join(" ").replace(TRAIL, "") }] };
	// More or fewer words than were heard: words were put in or taken out ("weather" → "the weather"), not misspelled
	// (Codex review 13 Nov).
	if (put.length > took.length) return { kind: "added", pairs: [] };
	if (put.length < took.length) return { kind: "removed", pairs: [] };
	if (took.length > MAX_PIECES || put.length > MAX_PIECES || put.join(" ").length > MAX_LETTERS) return { kind: "rewrite", pairs: [] };
	return { kind: "spelling", pairs: [{ heard: took.join(" ").replace(TRAIL, ""), fixed: put.join(" ").replace(TRAIL, "") }] };
}

// How a learned pair may be used. realWords: does the dictionary know every part of this Thai text (server only).
// shared: Komoray's list, used on everyone's videos, where only the AI decides unless the team said otherwise.
export function wordUse(heard: string, fixed: string, options: { realWords?: (thai: string) => boolean; shared?: boolean } = {}): WordUse {
	const thai = THAI.test(heard + fixed);
	const { kind } = learnFromFix(thai ? [heard.replace(/\s+/g, "")] : [heard], fixed);
	if (kind !== "spelling") return "off";
	// Other languages have no dictionary here to ask. A creator's own name or brand (a capital or a number, 3 letters
	// or more: komorey → Komoray) is put on everywhere; anything else could be a real word either way (their → there,
	// a → I), so the AI decides (Codex review 13 Nov).
	if (!thai) return !options.shared && /[\p{Lu}0-9]/u.test(fixed) && heard.replace(/[^\p{L}0-9]/gu, "").length >= 3 ? "always" : "ai";
	if (!options.realWords) return "ai";
	return options.realWords(heard.replace(/\s+/g, "")) ? "ai" : "always";
}

// What the edit box says about a fix before it is saved.
export const KIND_NOTE: Record<Exclude<FixKind, "spelling" | "same">, string> = {
	spacing: "Only the spacing changed, so this stays in this video.",
	added: "You added words, so this stays in this video: the speech-to-text missed them here only.",
	removed: "You took words out, so this stays in this video.",
	style: "Numbers, English words and ๆ are a matter of style, so this stays in this video.",
	rewrite: "That is more than a word or two, so this stays in this video.",
};
