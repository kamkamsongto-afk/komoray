// Subtitles that move: each line pops in, and with Bounce each word jumps as it is said.
// Saved in the style as "motion". Same keyframes and rules as MOTION in modal_app/render.py,
// which writes them as ASS \t tags, so the preview moves like the final video.

export type Motion = "none" | "pop" | "bounce";
export const MOTIONS: Record<Motion, { name: string; hint: string }> = {
	none: { name: "Still", hint: "Subtitles don't move" },
	pop: { name: "Pop", hint: "Each line pops in" },
	bounce: { name: "Bounce", hint: "Each line pops in, and every word bounces as it is said" },
};

// (milliseconds after the start, size in %), straight lines between them.
type Keys = [number, number][];
export const POP: Keys = [
	[0, 70],
	[90, 110],
	[170, 100],
];
export const BOUNCE: Keys = [
	[0, 100],
	[80, 125],
	[200, 100],
];
const POP_END = POP[POP.length - 1][0];

export function scaleAt(keys: Keys, ms: number) {
	if (ms <= keys[0][0]) return keys[0][1];
	for (let i = 1; i < keys.length; i++) {
		const [t1, s1] = keys[i];
		const [t0, s0] = keys[i - 1];
		if (ms < t1) return s0 + ((s1 - s0) * (ms - t0)) / (t1 - t0);
	}
	return keys[keys.length - 1][1];
}

// How big the line and the word being said are at this moment (1 = normal size).
// line = frames since the line started; word = which word is said (-1 none) and since when (frames).
export function motionScale(motion: Motion | undefined, fps: number, sinceLine: number, word: number, wordFrom: number, sinceWord: number) {
	if (!motion || motion === "none") return { line: 1, word: 1 };
	const ms = (frames: number) => (frames / fps) * 1000;
	const popping = ms(sinceLine) < POP_END;
	const line = popping ? scaleAt(POP, ms(sinceLine)) / 100 : 1;
	// A word bounces only once the line has finished popping in (the first word rides the pop).
	const bounces = motion === "bounce" && word > 0 && ms(wordFrom) >= POP_END;
	return { line, word: bounces ? scaleAt(BOUNCE, ms(sinceWord)) / 100 : 1 };
}
