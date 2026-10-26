import type { Transcript } from "./transcribe";

export type Cut = { start: number; end: number; reason: "silence" };

// A pause longer than this between two words counts as dead air.
export const MIN_SILENCE = 0.4;
// Leave a little breathing room around each word so cuts never clip a syllable.
export const PADDING = 0.1;

const round = (n: number) => Math.round(n * 1000) / 1000;

export function findSilences({ duration, words }: Transcript): Cut[] {
	if (words.length === 0) return [];

	// Treat the start and end of the clip as "words" so leading/trailing silence is caught too.
	const edges = [{ end: 0 }, ...words, { start: duration }] as { start?: number; end?: number }[];
	const cuts: Cut[] = [];

	for (let i = 0; i < edges.length - 1; i++) {
		const gapStart = edges[i].end!;
		const gapEnd = edges[i + 1].start!;
		if (gapEnd - gapStart <= MIN_SILENCE) continue;

		// No padding at the very start/end of the clip: there is no word there to protect.
		const start = i === 0 ? 0 : gapStart + PADDING;
		const end = i === edges.length - 2 ? duration : gapEnd - PADDING;
		if (end > start) cuts.push({ start: round(start), end: round(end), reason: "silence" });
	}
	return cuts;
}
