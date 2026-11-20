// The final video's timeline, worked out in the browser for the preview.
// Mirrors modal_app/render.py (keep_segments + build_subtitles): change one, change the other,
// or the preview stops matching the video people download.
import type { SubtitleSpot } from "./subtitle-style";

type Span = { start: number; end: number };
type Word = { text: string; start: number; end: number; space?: boolean; glue?: boolean; br?: boolean }; // space: typed by the user, glue: typed onto the word before, br: two spaces typed before it = a new line (fixedWords)

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

// How long a subtitle line may get, per look (subtitle-style.ts). Thai letters don't count marks
// above and below the line; thaiLetters fits text size `size` (bigger letters: fewer per line, so a
// line never wraps onto a second row). Same as LINE_LIMITS in render.py.
const LINE_LIMITS = {
	normal: { words: 3, seconds: 1.6, thaiWords: 6, thaiLetters: 16, thaiSeconds: 2.2, size: 130 },
	big: { words: 2, seconds: 1.2, thaiWords: 4, thaiLetters: 10, thaiSeconds: 1.6, size: 195 },
	two: { words: 7, seconds: 3.0, thaiWords: 12, thaiLetters: 30, thaiSeconds: 3.6, size: 117 },
};

// Where a Thai line may break. A line never starts with a word that belongs to the one before it
// ("ชุด|นี้", "ได้|ไหม", a polite ending), and breaks best at a pause or before a word that starts a
// new phrase ("แต่", "ถ้า"). Same as THAI_NO_START / THAI_STARTS in render.py.
const THAI_NO_START = new Set(["นี้", "นั้น", "โน้น", "ไหม", "มั้ย", "เลย", "ด้วย", "กัน", "ได้", "ๆ", "อยู่", "หรอ", "เหรอ", "เดียว", "กว่า", "ที่สุด", "มาก", "หน่อย", "บ้าง", "เอง", "ไว้", "ขึ้น", "ออก"]);
const THAI_STARTS = new Set(["แต่", "ถ้า", "และ", "หรือ", "เพราะ", "ซึ่ง", "โดย", "ดังนั้น", "เช่น", "คือ", "เมื่อ", "ตอนที่", "จน", "ทำให้", "แล้วก็", "ก็"]);
const START_BONUS = 8; // frames: a phrase start or a polite ending is worth a pause this long
// Where an English line may break (coach 20 Nov: "With Komoray, I" left the I at the end): never after a word that
// leads into the next one, best after , . ! ? or at a pause. Same as EN_NO_END / EN_PUNCT / english_break in render.py.
const EN_NO_END = new Set(["a", "an", "the", "i", "i'm", "i've", "i'll", "i'd", "to", "of", "and", "or", "but", "my", "your", "his", "her", "our", "their", "its", "in", "on", "at", "for", "with", "from", "by", "as", "if", "so", "that", "this", "these", "those", "we", "you", "they", "he", "she", "we're", "you're", "they're", "it's", "is", "are", "was", "were", "not", "don't", "can't", "very", "just", "can", "will", "would", "could", "should", "into", "about", "than", "when", "because"]);
const EN_PUNCT = /[.,!?;:…]["'”’)]*$/;
const enWord = (text: string) => text.toLowerCase().replace(/’/g, "'").replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, "");
const THAI_LETTER_EM = 0.44; // how wide a Thai letter is, in text sizes: to work out what letter spacing costs
const THAI_PAUSE = 0.15; // a pause this long inside a Thai line gets a space
const LINE_BREAK_GAP = 0.5;
// Pop only for a line said after a pause this long (seconds). Lines said straight on just change: quick speech made a
// new line pop every 0.6 s, which looked like the subtitles flickering (coach 16 Nov, VID20261115124127 4:14). Same as
// POP_PAUSE in render.py.
const POP_PAUSE = 0.3;

// Auto zoom (lib/zoom.ts) grows the picture around this point when no face was found: a little above
// the middle, where the face usually is. Same as ZOOM_ORIGIN in render.py.
export const ZOOM_ORIGIN = { x: 0.5, y: 0.4 };

// One kept piece of the source: plays `frames` frames from source frame `trim`, at output frame `from`.
export type Segment = { from: number; trim: number; frames: number };
// A subtitle line; parts = its words as shown (with the space before them) and when each is said.
// row2 = the part that starts the second row (Two lines look), if the line is split.
// piece = the stretch of the original video this line is in, once the video has been Split: dragging the line
// moves that stretch's subtitles only. position = where that stretch's subtitles were moved to, if they were.
// afterPause: the first line, or one said after a pause (POP_PAUSE): only these pop in (motion.ts).
export type Line = { from: number; to: number; text: string; parts: { text: string; from: number }[]; row2?: number; piece?: [number, number]; position?: number; afterPause?: boolean };

// The stretch between the Splits around second t of the original video.
export function pieceAt(splits: number[], t: number, end: number): [number, number] {
	return [splits.findLast((s) => s <= t) ?? 0, splits.find((s) => s > t) ?? end];
}
// One stretch moved on its own: other spots keep what lies outside it.
export function setSpot(spots: SubtitleSpot[] | undefined, start: number, end: number, position: number): SubtitleSpot[] {
	const kept = (spots ?? []).flatMap((s) => {
		if (s.end <= start || s.start >= end) return [s];
		return [...(s.start < start ? [{ ...s, end: start }] : []), ...(s.end > end ? [{ ...s, start: end }] : [])];
	});
	return [...kept, { start, end, position }];
}
// Splits to add at these moments of the original video: none where one already is (within `near` seconds).
export function addSplits(splits: number[] | undefined, at: number[], near = 0.05) {
	const all = [...(splits ?? [])];
	for (const t of at) if (t > 0 && !all.some((s) => Math.abs(s - t) < near)) all.push(Math.round(t * 1000) / 1000);
	return all.sort((a, b) => a - b);
}

// Subtitles of their own place for a stretch of the final video (start / end: its seconds), e.g. while a Layout shows
// (coach 20 Nov: top / bottom put the subtitles over a face or over what is shown). One step for what took several
// Splits and a drag: Splits at both edges (on the original video, so no line runs across them) and a spot over it.
// position null: back to the place of the rest (its spot goes, the Splits stay). Only Splits and spots, which
// build_subtitles in render.py already reads: nothing new for the final video.
export function placeStretch(sub: { splits?: number[]; spots?: SubtitleSpot[] }, start: number, end: number, segments: Segment[], position: number | null) {
	const [a, b] = [toSourceSeconds(start, segments), toSourceSeconds(end, segments)];
	if (b <= a) return sub;
	const spots = setSpot(sub.spots, a, b, position ?? 0).filter((s) => position !== null || s.start !== a || s.end !== b);
	return { ...sub, splits: addSplits(sub.splits, [a, b]), spots };
}
// The spot over a stretch of the final video, if its subtitles have their own place (placeStretch).
export const stretchPlace = (spots: SubtitleSpot[] | undefined, start: number, segments: Segment[]) => {
	const a = toSourceSeconds(start, segments) + 0.01;
	return spots?.find((s) => a >= s.start && a < s.end)?.position ?? null;
};

// A hundredth of a second in, so a line starting exactly on a Split counts as after it. Same as source_at in render.py.
function lineSource(frame: number, segments: Segment[]) {
	const seg = segments.findLast((s) => s.from <= frame && frame <= s.from + s.frames); // the last: right after a cut, the piece that starts there
	return seg ? (seg.trim + frame - seg.from) / FPS + 0.01 : null;
}

const TWO_ROWS_FROM = 14; // Two lines look: a line with more letters than this is split in two rows

// Where to split a line into two rows: between the words closest to half its letters. Same as
// second_row in render.py.
function secondRow(texts: string[]) {
	const sizes = texts.map((t) => thaiLetters(t.trim()));
	const total = sizes.reduce((a, b) => a + b, 0);
	if (texts.length < 2 || total <= TWO_ROWS_FROM) return undefined;
	let best = 1;
	let before = 0;
	let bestDiff = Infinity;
	for (let k = 1; k < texts.length; k++) {
		before += sizes[k - 1];
		const diff = Math.abs(before - total / 2);
		if (diff < bestDiff) [best, bestDiff] = [k, diff];
	}
	return best;
}

// The subtitle lines as an .srt file (YouTube, Premiere, CapCut…), timed on the final video.
export function toSrt(lines: Line[]) {
	const time = (frames: number) => {
		const ms = Math.round((frames / FPS) * 1000);
		const pad = (n: number, w = 2) => String(n).padStart(w, "0");
		return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
	};
	return lines
		.map((l, i) => {
			const text = l.parts.map((p, k) => (k === l.row2 ? "\n" : "") + p.text).join("");
			return `${i + 1}\n${time(l.from)} --> ${time(l.to)}\n${text}\n`;
		})
		.join("\n");
}

// The parts of the video that stay: everything that is not a cut.
export function keepSegments(duration: number, cuts: Span[]): Segment[] {
	const keeps: [number, number][] = [];
	let pos = 0;
	for (const cut of [...cuts].sort((a, b) => a.start - b.start)) {
		if (cut.start > pos) keeps.push([pos, cut.start]);
		pos = Math.max(pos, cut.end);
	}
	if (pos < duration) keeps.push([pos, duration]);

	const segments: Segment[] = [];
	let from = 0;
	for (const [a, b] of keeps) {
		if (b - a <= 0.05) continue;
		const trim = Math.round(a * FPS);
		const frames = Math.round(b * FPS) - trim;
		if (frames <= 0) continue;
		segments.push({ from, trim, frames });
		from += frames;
	}
	return segments;
}

export const totalFrames = (segments: Segment[]) => segments.reduce((sum, s) => sum + s.frames, 0);

// Seconds of the final video for a moment of the source; a moment that was cut counts as where
// the video goes on after it.
export function toOutSeconds(t: number, segments: Segment[]) {
	const f = placeFrame(t, segments);
	if (f !== null) return f / FPS;
	const next = segments.find((s) => s.trim > t * FPS);
	return (next ? next.from : totalFrames(segments)) / FPS;
}

// And back: the moment of the source shown at this second of the final video (the editor only, to move the
// player to a banner or a picture, which are timed on the final video). Same as toSource in Timeline.tsx.
export function toSourceSeconds(out: number, segments: Segment[]) {
	const f = out * FPS;
	const s = segments.find((seg) => f < seg.from + seg.frames) ?? segments[segments.length - 1];
	return s ? (s.trim + Math.min(s.frames, Math.max(0, f - s.from))) / FPS : 0;
}

// Output frame for a moment of the source, or null if that moment was cut.
function placeFrame(t: number, segments: Segment[]): number | null {
	const f = t * FPS;
	const s = segments.find((seg) => f >= seg.trim && f <= seg.trim + seg.frames);
	return s ? s.from + (f - s.trim) : null;
}

const isThai = (text: string) => /[฀-๿]/.test(text);
const fixThai = (text: string) => text.replace(/ํา/g, "ำ");

const charKind = (ch: string) => (/[฀-๿]/.test(ch) ? "thai" : /\d/.test(ch) ? "number" : /[A-Za-z]/.test(ch) ? "latin" : null);

// Polite endings: a Thai sentence usually ends on one, so a space goes after it ("นะครับ ได้ยินไหม").
export const THAI_ENDINGS = new Set(["ครับ", "คับ", "ค่ะ", "คะ", "ค่า", "นะ", "จ้ะ", "จ้า", "ฮะ", "ฮับ", "เนอะ", "นะครับ", "นะคะ"]);
const THAI_MARKS = /[ัิ-ฺ็-๎]/g;
const thaiLetters = (text: string) => text.replace(THAI_MARKS, "").length;

// Thai doesn't put spaces between words, only between phrases. A Thai line gets one where Thai,
// numbers and English letters meet ("5 นาที", "ราคา Komoray"), after a polite ending or ๆ, and
// where the speaker pauses. Returns each word with the space before it. Same as join_thai in render.py.
function joinThai(words: { text: string; start: number; end: number; space?: boolean }[]) {
	let out = "";
	return words.map((w, i) => {
		const prev = words[i - 1];
		let space = "";
		if (prev && out && w.text) {
			const a = charKind(out[out.length - 1]);
			const b = charKind(w.text[0]);
			const ending = (THAI_ENDINGS.has(prev.text) && !THAI_ENDINGS.has(w.text)) || prev.text.endsWith("ๆ");
			if (w.space || (a && b && a !== b) || ending || w.start - prev.end >= THAI_PAUSE * FPS) space = " ";
		}
		out += space + w.text;
		return space + w.text;
	});
}

// Short subtitle lines on the output timeline, grouped the same way as the final video.
export function subtitleLines(words: Word[], segments: Segment[], look = "clean", size = 100, spacing = 0, splits: number[] = [], spots: SubtitleSpot[] = []): Line[] {
	const thai = words.some((w) => isThai(w.text));
	const lastSegment = segments[segments.length - 1];
	const videoEnd = lastSegment ? (lastSegment.trim + lastSegment.frames) / FPS : 0;
	// A line never runs across a Split, so each piece has its own words.
	// A Split inside a cut part breaks where the video picks up again, or the pieces on either side would join.
	const breaks = splits.map((s) => placeFrame(s, segments) ?? segments.find((g) => g.trim / FPS > s)?.from ?? null).filter((f): f is number => f !== null);
	const limits = look === "big" || look === "two" ? LINE_LIMITS[look] : LINE_LIMITS.normal;
	// The line's width in letters at the limit's size, shared out among bigger or more spaced-out letters.
	const maxLetters = Math.floor((limits.thaiLetters * limits.size * THAI_LETTER_EM) / (Math.max(size, limits.size) * THAI_LETTER_EM + spacing) + 1e-9);
	const perLine = thai ? limits.thaiWords : limits.words;
	const maxFrames = (thai ? limits.thaiSeconds : limits.seconds) * FPS;
	const gapFrames = LINE_BREAK_GAP * FPS;

	const placed: { text: string; start: number; end: number; space?: boolean; glue?: boolean; br?: boolean }[] = [];
	for (const w of words) {
		const mid = placeFrame((w.start + w.end) / 2, segments);
		if (mid === null) continue;
		const half = ((w.end - w.start) / 2) * FPS;
		placed.push({ text: fixThai(w.text), start: Math.max(0, mid - half), end: mid + half, space: w.space, glue: w.glue, br: w.br });
	}

	type Placed = (typeof placed)[number];
	const lettersOf = (run: Placed[]) => run.reduce((sum, w) => sum + thaiLetters(w.text), 0);
	const fits = (run: Placed[]) =>
		run.length <= perLine && run[run.length - 1].end - run[0].start <= maxFrames && (!thai || lettersOf(run) <= maxLetters);
	// A full Thai line: break where it reads best (see THAI_NO_START), carrying the rest to the next
	// line, as long as that still fits. k = how many words stay on this line.
	const bestBreak = (run: Placed[], next: Placed) => {
		const all = [...run, next];
		let best = run.length;
		let bestScore = -Infinity;
		for (let k = 1; k <= run.length; k++) {
			const first = all[k];
			const last = all[k - 1];
			// glue: typed onto the word before it, with no space ("ของ|โค้ช" from a fix): a line never starts there.
			if (first.glue || THAI_NO_START.has(first.text) || THAI_ENDINGS.has(first.text) || first.text.startsWith("ๆ")) continue;
			if (k < run.length && (lettersOf(run.slice(0, k)) < Math.max(3, maxLetters * 0.4) || !fits(all.slice(k)))) continue;
			const score = first.start - last.end + (THAI_STARTS.has(first.text) ? START_BONUS : 0) + (THAI_ENDINGS.has(last.text) ? START_BONUS : 0) + 0.3 * k;
			if (score >= bestScore) [best, bestScore] = [k, score];
		}
		return best;
	};

	// A full English line: k = how many words stay (at least half), the rest carried on if it fits. Not after a word that
	// leads on ("I", "the"), best after a comma or full stop or at a pause. Same as english_break in render.py.
	const englishBreak = (run: Placed[], next: Placed) => {
		const all = [...run, next];
		let best = run.length;
		let bestScore = -Infinity;
		for (let k = Math.ceil(run.length / 2); k <= run.length; k++) {
			if (k < run.length && !fits(all.slice(k))) continue;
			const [last, first] = [all[k - 1], all[k]];
			const end = EN_PUNCT.test(last.text);
			const score = first.start - last.end + (end ? START_BONUS : 0) - (!end && EN_NO_END.has(enWord(last.text)) ? 2 * START_BONUS : 0) + 0.3 * k;
			if (score >= bestScore) [best, bestScore] = [k, score];
		}
		return best;
	};

	const groups: Placed[][] = [];
	let current: Placed[] = [];
	for (const w of placed) {
		const crossesSplit = current.length > 0 && breaks.some((b) => current[current.length - 1].start < b && b <= w.start + 0.01);
		// br: two spaces typed before it in Edit text, a new line here (coach 20 Nov). Same in group_lines (render.py).
		if (crossesSplit || (current.length && w.br) || (current.length && w.start - current[current.length - 1].end > gapFrames)) {
			groups.push(current);
			current = [];
		} else if (current.length && !fits([...current, w])) {
			const k = thai ? bestBreak(current, w) : englishBreak(current, w);
			groups.push(current.slice(0, k));
			current = current.slice(k);
		}
		current.push(w);
	}
	if (current.length) groups.push(current);

	return groups.map((line, i) => {
		let to = line[line.length - 1].end;
		// Hold each line until the next one starts (if close), so subtitles don't flicker.
		const next = groups[i + 1];
		if (next && next[0].start - to < gapFrames) to = next[0].start;
		const texts = thai ? joinThai(line) : line.map((w, k) => (k ? " " : "") + w.text);
		const row2 = look === "two" ? secondRow(texts) : undefined;
		if (row2 !== undefined) texts[row2] = texts[row2].trimStart();
		const source = lineSource(line[0].start, segments);
		const position = source === null ? undefined : spots.find((s) => source >= s.start && source < s.end)?.position;
		const piece = source !== null && splits.length ? pieceAt(splits, source, videoEnd) : undefined;
		const before = groups[i - 1];
		const afterPause = !before || line[0].start - before[before.length - 1].end >= POP_PAUSE * FPS;
		return { from: line[0].start, to, text: texts.join(""), parts: texts.map((text, k) => ({ text, from: line[k].start })), row2, piece, position, afterPause };
	});
}
