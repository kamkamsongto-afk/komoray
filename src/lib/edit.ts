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
