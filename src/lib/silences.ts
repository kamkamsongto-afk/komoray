import type { Transcript, Word } from "./transcribe";

export type Cut = { start: number; end: number; reason: "silence" };

// A pause longer than this between two words counts as dead air.
export const MIN_SILENCE = 0.4;
// Leave a little breathing room around each word so cuts never clip a syllable.
export const PADDING = 0.1;

// Speech-to-text often stretches the last word of a phrase over the pause after it
// ("strong" reported as 1.04s). A word gets at most BASE + PER_LETTER × letters seconds;
// anything past that is treated as silence. Tuned on a real clip: "strong" 1.04s → 0.50s.
export const WORD_BASE_SECONDS = 0.2;
export const WORD_SECONDS_PER_LETTER = 0.05;

const round = (n: number) => Math.round(n * 1000) / 1000;

export function trimStretchedWords(words: Word[]): Word[] {
	return words.map((w) => {
		const letters = w.text.replace(/[^\p{L}\p{N}]/gu, "").length || 1;
		const maxEnd = w.start + WORD_BASE_SECONDS + WORD_SECONDS_PER_LETTER * letters;
		return w.end > maxEnd ? { ...w, end: round(maxEnd) } : w;
	});
}

// How tight the edit is: the shortest pause that gets cut and the room left around words.
// "natural" is MIN_SILENCE / PADDING above. Picked in the editor, saved in edit.json as "pace".
export type Pace = "tight" | "natural" | "relaxed";
export const PACES: Record<Pace, { name: string; minSilence: number; padding: number }> = {
	tight: { name: "Tight", minSilence: 0.25, padding: 0.05 },
	natural: { name: "Natural", minSilence: MIN_SILENCE, padding: PADDING },
	relaxed: { name: "Relaxed", minSilence: 0.7, padding: 0.15 },
};
export const readPace = (value: unknown): Pace | null => (value === "tight" || value === "natural" || value === "relaxed" ? value : null);

export function findSilences({ duration, words }: Transcript, pace: Pace = "natural"): Cut[] {
	if (words.length === 0) return [];
	const { minSilence, padding } = PACES[pace];

	// Treat the start and end of the clip as "words" so leading/trailing silence is caught too.
	const edges = [{ end: 0 }, ...words, { start: duration }] as { start?: number; end?: number }[];
	const cuts: Cut[] = [];

	for (let i = 0; i < edges.length - 1; i++) {
		const gapStart = edges[i].end!;
		const gapEnd = edges[i + 1].start!;
		if (gapEnd - gapStart <= minSilence) continue;

		// No padding at the very start/end of the clip: there is no word there to protect.
		const start = i === 0 ? 0 : gapStart + padding;
		const end = i === edges.length - 2 ? duration : gapEnd - padding;
		if (end > start) cuts.push({ start: round(start), end: round(end), reason: "silence" });
	}
	return cuts;
}
