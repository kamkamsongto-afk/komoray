// Thai numbers said in words become digits (coach 22 Nov): Deepgram's Thai gives 1,767 as "หนึ่ง พัน เจ็ด ร้อย หก สิบ เจ็ด"
// and the price in a clip as words, so the script and subtitles read "สามสิบนาที" where a creator writes "30 นาที".
// Measured on FLEURS Thai sentences with numbers: only 22% came back as digits (scratchpad nums/, 22 Nov).
// Strict, because a number word is also an ordinary word (หนึ่ง in "สิ่งหนึ่ง", ร้อยละ = percent, แสน = very):
//   - a run of at least TWO consecutive pieces that are all number words, said within NUMBER_GAP seconds of each other;
//   - the run must read as one well-formed Thai number (descending units, ยี่ only before สิบ, เอ็ด only last after a
//     unit, no ศูนย์ inside); anything else is left exactly as it was heard (fail closed);
//   - a run followed by "ละ" is ร้อยละ (percent), never a number;
//   - a run with no unit (สิบ ร้อย พัน หมื่น แสน ล้าน) is left alone: "หนึ่ง สอง สาม" is counting, not a number.
// No AI. Server side, after the Thai pieces are joined (lib/thai-words.ts). English and Chinese are not changed.

import { isThaiWord } from "./newmm";

type Word = { text: string; start: number; end: number };

const NUMBER_GAP = 1; // seconds between the pieces of one number
const DIGITS: Record<string, number> = { หนึ่ง: 1, เอ็ด: 1, สอง: 2, ยี่: 2, สาม: 3, สี่: 4, ห้า: 5, หก: 6, เจ็ด: 7, แปด: 8, เก้า: 9 };
const UNITS: Record<string, number> = { สิบ: 10, ร้อย: 100, พัน: 1000, หมื่น: 10000, แสน: 100000 };
const MILLION = "ล้าน";
const isNumberWord = (t: string) => t in DIGITS || t in UNITS || t === MILLION || t === "ศูนย์";
// The dictionary joins number words into one word ("แปดสิบ", "ร้อยห้าสิบ"): a word made only of number words is its pieces.
const PIECES = /ศูนย์|หนึ่ง|เอ็ด|สอง|ยี่|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ|ร้อย|พัน|หมื่น|แสน|ล้าน/gy;
function piecesOf(text: string): string[] | null {
	const out: string[] = [];
	PIECES.lastIndex = 0;
	for (let m = PIECES.exec(text); m; m = PIECES.exec(text)) out.push(m[0]);
	return out.length && out.join("") === text ? out : null;
}
// A piece next to a run that is part of a number word ("สิ" for สิบ, "เจ" or "ด" for เจ็ด: Deepgram heard the end of 1,767 as
// "หก สิ เจ ด"): the number was not heard whole, so it stays as heard, not a wrong figure (1,706) that looks sure.
const NUMBER_WORDS = [...Object.keys(DIGITS), ...Object.keys(UNITS), MILLION, "ศูนย์"];
const fragment = (t: string) => t.length > 0 && NUMBER_WORDS.some((w) => w !== t && (w.startsWith(t) || w.endsWith(t)));
const broken = (w: Word | undefined) => !!w && /[฀-๿]/.test(w.text) && !isNumberWord(w.text) && (fragment(w.text) || !isThaiWord(w.text)); // or a mashed word the dictionary doesn't know ("เจ็สิ")

// The value of a run of number words, or null if it is not one well-formed number.
export function parseThaiNumber(tokens: string[]): number | null {
	if (!tokens.length || tokens.some((t) => t === "ศูนย์")) return null;
	let total = 0;
	let rest = tokens;
	// "ล้าน" closes everything said before it (หนึ่ง ล้าน สอง แสน = 1,200,000). Said once only.
	const million = rest.indexOf(MILLION);
	if (million >= 0) {
		if (rest.lastIndexOf(MILLION) !== million || million === 0) return null;
		const before = rest.slice(0, million);
		const millions = before.length === 1 && before[0] in DIGITS && before[0] !== "เอ็ด" && before[0] !== "ยี่" ? DIGITS[before[0]] : parseBelowMillion(before);
		if (millions === null) return null;
		total = millions * 1_000_000;
		rest = rest.slice(million + 1);
		if (!rest.length) return total;
	}
	const below = parseBelowMillion(rest);
	return below === null ? null : total + below;
}

function parseBelowMillion(tokens: string[]): number | null {
	let total = 0;
	let lastUnit = Infinity; // units must come in falling order
	let i = 0;
	while (i < tokens.length) {
		const t = tokens[i];
		const next = tokens[i + 1];
		if (t in UNITS) {
			// A unit with no digit before it: only at the start of the number ("สิบ", "สิบเอ็ด", "ร้อยห้า").
			if (i !== 0 || UNITS[t] >= lastUnit) return null;
			total += UNITS[t];
			lastUnit = UNITS[t];
			i++;
		} else if (t in DIGITS && next !== undefined && next in UNITS) {
			if (t === "เอ็ด" || (t === "ยี่" && next !== "สิบ") || UNITS[next] >= lastUnit) return null;
			total += DIGITS[t] * UNITS[next];
			lastUnit = UNITS[next];
			i += 2;
		} else if (t in DIGITS && next === undefined && i > 0) {
			// The last digit: only after a unit (เอ็ด only after สิบ or more).
			if (t === "ยี่" || lastUnit === Infinity) return null;
			total += DIGITS[t];
			i++;
		} else return null;
	}
	return total;
}

// The one exception to "as heard" (coach 26 Nov): "แป" beside a unit is แปด with its last sound dropped ("สองล้านแปแสน").
// Thai has no other word a speaker says there. Before a unit, or ending a number before บาท; nowhere else.
const EIGHT_BEFORE_UNIT = /แป(?=สิบ|ร้อย|พัน|หมื่น|แสน|ล้าน)/g;
function mendEight<W extends Word>(words: W[]): W[] {
	const near = (a: Word | undefined, b: Word | undefined) => !!a && !!b && Math.abs(b.start - a.end) <= NUMBER_GAP;
	return words.map((w, i) => {
		if (w.text === "แป") {
			const [before, after] = [words[i - 1], words[i + 1]];
			const beforeUnit = near(w, after) && /^(สิบ|ร้อย|พัน|หมื่น|แสน|ล้าน)/.test(after.text) && piecesOf(after.text) !== null;
			const ending = near(before, w) && /(สิบ|ร้อย|พัน|หมื่น|แสน|ล้าน)$/.test(before.text) && near(w, after) && after.text === "บาท";
			return beforeUnit || ending ? { ...w, text: "แปด" } : w;
		}
		// Joined to the unit already ("แปแสน"): only when the whole word is then number words.
		const mended = w.text.replace(EIGHT_BEFORE_UNIT, "แปด");
		return mended !== w.text && piecesOf(mended) ? { ...w, text: mended } : w;
	});
}

// A list of words with number words said in a row turned into one word each, in digits ("2,990" style is left to the
// writer: digits come joined, 1767, as the script writes them). Times: from the first piece's start to the last one's end.
export function mergeThaiNumbers<W extends Word>(heard: W[]): W[] {
	const thai = heard.length > 0 && heard.filter((w) => /[฀-๿]/.test(w.text)).length / heard.length >= 0.3;
	if (!thai) return heard;
	const words = mendEight(heard);
	// Each word as its number pieces (one piece for a plain number word, null for a word that is not a number word).
	const pieces = words.map((w) => piecesOf(w.text));
	const out: W[] = [];
	for (let i = 0; i < words.length; ) {
		let j = i;
		while (j < words.length && pieces[j] && (j === i || words[j].start - words[j - 1].end <= NUMBER_GAP)) j++;
		const tokens = pieces.slice(i, j).flat() as string[];
		const gap = (a: W | undefined, b: W | undefined) => !!a && !!b && Math.abs(b.start - a.end) <= NUMBER_GAP;
		const edge = (gap(words[j - 1], words[j]) && broken(words[j])) || (gap(words[i - 1], words[i]) && broken(words[i - 1]));
		const ok = tokens.length >= 2 && tokens.some((t) => t in UNITS || t === MILLION) && words[j]?.text !== "ละ" && !edge;
		const value = ok ? parseThaiNumber(tokens) : null;
		if (value !== null) out.push({ ...words[i], text: String(value), end: words[j - 1].end });
		else out.push(...(j > i ? words.slice(i, j) : [words[i]])); // not one number: all of it stays as heard, never a part
		i = Math.max(j, i + 1);
	}
	return out;
}
