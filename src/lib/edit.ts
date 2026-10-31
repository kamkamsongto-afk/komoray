import { PADDING } from "./silences";

type Span = { start: number; end: number };
export type EditCut = Span & { reason: "silence" | "words" };

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

// Every cut for the final video: the silences plus the deleted words.
export function allCuts(edit: { duration: number; cuts: EditCut[]; words: Span[]; deleted?: number[] }): EditCut[] {
	return [...edit.cuts, ...wordCuts(edit.words, edit.deleted ?? [], edit.duration)].sort((a, b) => a.start - b.start);
}

// Words the user retyped in the script: words from..to (positions in the transcript) read as `text`.
// Deepgram's own words stay untouched, so cuts and deleted words keep working on the same positions.
export type Fix = { from: number; to: number; text: string };

const MAX_FIX_LENGTH = 200;

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
