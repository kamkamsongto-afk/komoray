// The final video's timeline, worked out in the browser for the preview.
// Mirrors modal_app/render.py (keep_segments + build_subtitles): change one, change the other,
// or the preview stops matching the video people download.

type Span = { start: number; end: number };
type Word = { text: string; start: number; end: number };

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

const WORDS_PER_LINE = 3;
const THAI_TOKENS_PER_LINE = 7;
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

// Short subtitle lines on the output timeline, grouped the same way as the final video.
export function subtitleLines(words: Word[], segments: Segment[]): Line[] {
	const thai = words.some((w) => isThai(w.text));
	const joiner = thai ? "" : " ";
	const perLine = thai ? THAI_TOKENS_PER_LINE : WORDS_PER_LINE;
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
	for (const w of placed) {
		if (
			current.length &&
			(current.length >= perLine || w.start - current[current.length - 1].end > gapFrames || w.end - current[0].start > maxFrames)
		) {
			groups.push(current);
			current = [];
		}
		current.push(w);
	}
	if (current.length) groups.push(current);

	return groups.map((line, i) => {
		let to = line[line.length - 1].end;
		// Hold each line until the next one starts (if close), so subtitles don't flicker.
		const next = groups[i + 1];
		if (next && next[0].start - to < gapFrames) to = next[0].start;
		return { from: line[0].start, to, text: line.map((w) => w.text).join(joiner) };
	});
}
