// The final video's timeline, worked out in the browser for the preview.
// Mirrors modal_app/render.py (keep_segments + build_subtitles): change one, change the other,
// or the preview stops matching the video people download.

type Span = { start: number; end: number };
type Word = { text: string; start: number; end: number };

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

const WORDS_PER_LINE = 3;
const THAI_WORDS_PER_LINE = 6;
const THAI_MAX_LETTERS = 16; // letters on the line, not counting marks above and below
const THAI_PAUSE = 0.15; // a pause this long inside a Thai line gets a space
const MAX_LINE_SECONDS = 1.6;
const THAI_MAX_LINE_SECONDS = 2.2;
const LINE_BREAK_GAP = 0.5;

// One kept piece of the source: plays `frames` frames from source frame `trim`, at output frame `from`.
export type Segment = { from: number; trim: number; frames: number };
export type Line = { from: number; to: number; text: string };

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
// where the speaker pauses. Same as join_thai in render.py.
function joinThai(words: { text: string; start: number; end: number }[]) {
	let out = "";
	words.forEach((w, i) => {
		const prev = words[i - 1];
		if (prev && out && w.text) {
			const a = charKind(out[out.length - 1]);
			const b = charKind(w.text[0]);
			const ending = (THAI_ENDINGS.has(prev.text) && !THAI_ENDINGS.has(w.text)) || prev.text.endsWith("ๆ");
			if ((a && b && a !== b) || ending || w.start - prev.end >= THAI_PAUSE * FPS) out += " ";
		}
		out += w.text;
	});
	return out;
}

// Short subtitle lines on the output timeline, grouped the same way as the final video.
export function subtitleLines(words: Word[], segments: Segment[]): Line[] {
	const thai = words.some((w) => isThai(w.text));
	const perLine = thai ? THAI_WORDS_PER_LINE : WORDS_PER_LINE;
	const maxFrames = (thai ? THAI_MAX_LINE_SECONDS : MAX_LINE_SECONDS) * FPS;
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
				(thai && letters + thaiLetters(w.text) > THAI_MAX_LETTERS))
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
		return { from: line[0].start, to, text: thai ? joinThai(line) : line.map((w) => w.text).join(" ") };
	});
}
