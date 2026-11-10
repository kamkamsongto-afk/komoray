// The final video's timeline, worked out in the browser for the preview.
// Mirrors modal_app/render.py (keep_segments + build_subtitles): change one, change the other,
// or the preview stops matching the video people download.
import type { SubtitleSpot } from "./subtitle-style";

type Span = { start: number; end: number };
type Word = { text: string; start: number; end: number };

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
const THAI_LETTER_EM = 0.44; // how wide a Thai letter is, in text sizes: to work out what letter spacing costs
const THAI_PAUSE = 0.15; // a pause this long inside a Thai line gets a space
const LINE_BREAK_GAP = 0.5;

// Auto zoom (lib/zoom.ts) grows the picture around this point when no face was found: a little above
// the middle, where the face usually is. Same as ZOOM_ORIGIN in render.py.
export const ZOOM_ORIGIN = { x: 0.5, y: 0.4 };

// One kept piece of the source: plays `frames` frames from source frame `trim`, at output frame `from`.
export type Segment = { from: number; trim: number; frames: number };
// A subtitle line; parts = its words as shown (with the space before them) and when each is said.
// row2 = the part that starts the second row (Two lines look), if the line is split.
// piece = the stretch of the original video this line is in, once the video has been Split: dragging the line
// moves that stretch's subtitles only. position = where that stretch's subtitles were moved to, if they were.
export type Line = { from: number; to: number; text: string; parts: { text: string; from: number }[]; row2?: number; piece?: [number, number]; position?: number };

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
function joinThai(words: { text: string; start: number; end: number }[]) {
	let out = "";
	return words.map((w, i) => {
		const prev = words[i - 1];
		let space = "";
		if (prev && out && w.text) {
			const a = charKind(out[out.length - 1]);
			const b = charKind(w.text[0]);
			const ending = (THAI_ENDINGS.has(prev.text) && !THAI_ENDINGS.has(w.text)) || prev.text.endsWith("ๆ");
			if ((a && b && a !== b) || ending || w.start - prev.end >= THAI_PAUSE * FPS) space = " ";
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

	const placed: { text: string; start: number; end: number }[] = [];
	for (const w of words) {
		const mid = placeFrame((w.start + w.end) / 2, segments);
		if (mid === null) continue;
		const half = ((w.end - w.start) / 2) * FPS;
		placed.push({ text: fixThai(w.text), start: Math.max(0, mid - half), end: mid + half });
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
			if (THAI_NO_START.has(first.text) || THAI_ENDINGS.has(first.text) || first.text.startsWith("ๆ")) continue;
			if (k < run.length && (lettersOf(run.slice(0, k)) < Math.max(3, maxLetters * 0.4) || !fits(all.slice(k)))) continue;
			const score = first.start - last.end + (THAI_STARTS.has(first.text) ? START_BONUS : 0) + (THAI_ENDINGS.has(last.text) ? START_BONUS : 0) + 0.3 * k;
			if (score >= bestScore) [best, bestScore] = [k, score];
		}
		return best;
	};

	const groups: Placed[][] = [];
	let current: Placed[] = [];
	for (const w of placed) {
		const crossesSplit = current.length > 0 && breaks.some((b) => current[current.length - 1].start < b && b <= w.start + 0.01);
		if (crossesSplit || (current.length && w.start - current[current.length - 1].end > gapFrames)) {
			groups.push(current);
			current = [];
		} else if (current.length && !fits([...current, w])) {
			const k = thai ? bestBreak(current, w) : current.length;
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
		return { from: line[0].start, to, text: texts.join(""), parts: texts.map((text, k) => ({ text, from: line[k].start })), row2, piece, position };
	});
}
