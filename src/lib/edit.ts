import { PADDING } from "./silences";

type Span = { start: number; end: number };
export type EditCut = Span & { reason: "silence" | "words" | "manual" };

// Words the user deleted in the Script view become cuts. Each run of deleted words is cut
// from just before its first word to just before the next kept word, so the pause after it goes too.
export function wordCuts(words: Span[], deleted: number[], duration: number): EditCut[] {
	const gone = new Set(deleted);
	const cuts: EditCut[] = [];
	let i = 0;
	while (i < words.length) {
		if (!gone.has(i)) {
			i++;
			continue;
		}
		let j = i;
		while (gone.has(j + 1)) j++;
		const prev = words[i - 1];
		const next = words[j + 1];
		const start = prev ? Math.max(prev.end, words[i].start - PADDING) : 0;
		const end = next ? Math.max(words[j].end, next.start - PADDING) : duration;
		if (end > start) cuts.push({ start, end, reason: "words" });
		i = j + 1;
	}
	return cuts;
}

// Cut or kept by hand on the timeline (source seconds). `manual` is cut whatever is said there;
// `keep` stays in the video although a silence or a deleted word's cut covered it (e.g. the end of
// a word dragged back in). Deleting words again takes their part out of `keep` (page.tsx).
export type HandEdits = { manual?: Span[]; keep?: Span[] };

// Every cut for the final video: the silences and the deleted words (minus what was kept by hand),
// plus the hand cuts.
export function allCuts(edit: { duration: number; cuts: Span[]; words: Span[]; deleted?: number[] } & HandEdits): EditCut[] {
	const auto = [
		...edit.cuts.map((c) => ({ start: c.start, end: c.end, reason: "silence" as const })),
		...wordCuts(edit.words, edit.deleted ?? [], edit.duration),
	];
	const manual = (edit.manual ?? []).map((c) => ({ start: c.start, end: c.end, reason: "manual" as const }));
	return [...subtractSpans(auto, edit.keep ?? []), ...manual].sort((a, b) => a.start - b.start);
}

// Spans sorted and joined where they touch or overlap.
export function mergeSpans(spans: Span[]): Span[] {
	const out: Span[] = [];
	for (const s of [...spans].sort((a, b) => a.start - b.start)) {
		const last = out[out.length - 1];
		if (last && s.start <= last.end + 0.001) last.end = Math.max(last.end, s.end);
		else if (s.end > s.start) out.push({ start: s.start, end: s.end });
	}
	return out;
}

// `spans` with the parts inside any of `holes` taken out.
export function subtractSpans<S extends Span>(spans: S[], holes: Span[]): S[] {
	if (!holes.length) return spans;
	const gaps = mergeSpans(holes);
	const out: S[] = [];
	for (const s of spans) {
		let pos = s.start;
		for (const h of gaps) {
			if (h.end <= pos || h.start >= s.end) continue;
			if (h.start - pos > 0.01) out.push({ ...s, start: pos, end: h.start });
			pos = Math.max(pos, h.end);
		}
		if (s.end - pos > 0.01) out.push({ ...s, start: pos, end: s.end });
	}
	return out;
}

// Hand spans sent by the browser, checked: inside the video, at most MAX_HAND_SPANS. Null if bad.
export const MAX_HAND_SPANS = 1000;
export function readSpans(value: unknown, duration: number): Span[] | null {
	if (!Array.isArray(value) || value.length > MAX_HAND_SPANS) return null;
	const spans: Span[] = [];
	for (const v of value as Partial<Span>[]) {
		const { start, end } = v ?? {};
		if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end)) return null;
		if (start < 0 || end > duration + 0.01 || end <= start) return null;
		spans.push({ start: Math.round(start * 1000) / 1000, end: Math.round(Math.min(end, duration) * 1000) / 1000 });
	}
	return mergeSpans(spans);
}

// Words the user retyped in the script: words from..to (positions in the transcript) read as `text`.
// Deepgram's own words stay untouched, so cuts and deleted words keep working on the same positions.
export type Fix = { from: number; to: number; text: string };

export const MAX_FIX_LENGTH = 200;

// Words compared the way people read them: ignore capitals, spacing and punctuation at the ends
// ("People," = "people"). Used to find words in the script and as the personal dictionary's key.
export const TRAIL = /[.,!?;:…]+$/;
export const normText = (text: string) =>
	text
		.toLowerCase()
		.replace(/\s+/g, " ")
		.replace(/^[\s"'“”‘’([]+|[\s"'“”‘’)\].,!?;:…]+$/g, "");

// One entry of the personal dictionary (table word_fixes): the script showed `heard`, the user wants `fixed`.
export type WordFix = { heard: string; fixed: string };

// The words as they should read in subtitles: each fix becomes one word spanning its words' time.
export function fixedWords<W extends Span & { text: string }>(words: W[], fixes: Fix[] = []): W[] {
	const byStart = new Map(fixes.map((f) => [f.from, f]));
	const out: W[] = [];
	for (let i = 0; i < words.length; i++) {
		const fix = byStart.get(i);
		if (!fix) {
			out.push(words[i]);
			continue;
		}
		out.push({ ...words[i], text: fix.text, end: words[fix.to].end });
		i = fix.to;
	}
	return out;
}

// Put a fix on words from..to, replacing any fix it overlaps. The original text (or nothing) removes it.
export function setFix(fixes: Fix[], from: number, to: number, text: string, original: string): Fix[] {
	const kept = fixes.filter((f) => f.to < from || f.from > to);
	const clean = text.trim().slice(0, MAX_FIX_LENGTH);
	if (clean && clean !== original) kept.push({ from, to, text: clean });
	return kept.sort((a, b) => a.from - b.from);
}

// Fixes sent by the browser, checked: whole numbers inside the transcript, no overlaps. Null if bad.
export function readFixes(value: unknown, count: number): Fix[] | null {
	if (!Array.isArray(value)) return null;
	const fixes: Fix[] = [];
	for (const f of value as Partial<Fix>[]) {
		const { from, to, text } = f ?? {};
		if (!Number.isInteger(from) || !Number.isInteger(to) || typeof text !== "string") return null;
		if (from! < 0 || to! < from! || to! >= count || !text.trim() || text.length > MAX_FIX_LENGTH) return null;
		fixes.push({ from: from!, to: to!, text: text.trim() });
	}
	fixes.sort((a, b) => a.from - b.from);
	return fixes.every((f, i) => i === 0 || f.from > fixes[i - 1].to) ? fixes : null;
}

// Seconds removed in total (cuts can overlap, so merge them first).
export function cutSeconds(cuts: Span[]): number {
	let total = 0;
	let reach = 0;
	for (const c of [...cuts].sort((a, b) => a.start - b.start)) {
		const start = Math.max(c.start, reach);
		if (c.end > start) total += c.end - start;
		reach = Math.max(reach, c.end);
	}
	return total;
}
