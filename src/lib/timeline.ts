// The final video's timeline, worked out in the browser for the preview.
// Mirrors modal_app/render.py (keep_segments + build_subtitles): change one, change the other,
// or the preview stops matching the video people download.

type Span = { start: number; end: number };
type Word = { text: string; start: number; end: number };

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

// How long a subtitle line may get, per look (subtitle-style.ts). Thai letters don't count marks
// above and below the line. Same as LINE_LIMITS in render.py.
const LINE_LIMITS = {
	normal: { words: 3, seconds: 1.6, thaiWords: 6, thaiLetters: 16, thaiSeconds: 2.2 },
	big: { words: 2, seconds: 1.2, thaiWords: 4, thaiLetters: 10, thaiSeconds: 1.6 },
	two: { words: 7, seconds: 3.0, thaiWords: 12, thaiLetters: 30, thaiSeconds: 3.6 },
};
const THAI_PAUSE = 0.15; // a pause this long inside a Thai line gets a space
const LINE_BREAK_GAP = 0.5;

// Auto zoom ("cuts"): every other kept piece is shown a little closer, so a cut looks like a camera
// change instead of a jump. Zoomed around a point a little above the middle, where the face
// usually is. Same as ZOOM in render.py.
export const ZOOM = 1.12;
export const ZOOM_ORIGIN = { x: 0.5, y: 0.4 };
export const zoomOf = (piece: number, mode: string) => (mode === "cuts" && piece % 2 === 1 ? ZOOM : 1);

// One kept piece of the source: plays `frames` frames from source frame `trim`, at output frame `from`.
export type Segment = { from: number; trim: number; frames: number };
// A subtitle line; parts = its words as shown (with the space before them) and when each is said.
// row2 = the part that starts the second row (Two lines look), if the line is split.
export type Line = { from: number; to: number; text: string; parts: { text: string; from: number }[]; row2?: number };

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
const THAI_ENDINGS = new Set(["ครับ", "คับ", "ค่ะ", "คะ", "ค่า", "นะ", "จ้ะ", "จ้า", "ฮะ", "ฮับ", "เนอะ", "นะครับ", "นะคะ"]);
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
export function subtitleLines(words: Word[], segments: Segment[], look = "clean"): Line[] {
	const thai = words.some((w) => isThai(w.text));
	const limits = look === "big" || look === "two" ? LINE_LIMITS[look] : LINE_LIMITS.normal;
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

	const groups: (typeof placed)[] = [];
	let current: typeof placed = [];
	let letters = 0;
	for (const w of placed) {
		if (
			current.length &&
			(current.length >= perLine ||
				w.start - current[current.length - 1].end > gapFrames ||
				w.end - current[0].start > maxFrames ||
				(thai && letters + thaiLetters(w.text) > limits.thaiLetters))
		) {
			groups.push(current);
			current = [];
			letters = 0;
		}
		current.push(w);
		letters += thaiLetters(w.text);
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
		return { from: line[0].start, to, text: texts.join(""), parts: texts.map((text, k) => ({ text, from: line[k].start })), row2 };
	});
}
