// Subtitles that move: each line pops in, and with Bounce a word jumps out now and then as it is said.
// Saved in the style as "motion". Same keyframes and rules as MOTION in modal_app/render.py,
// which writes them as ASS \t tags, so the preview moves like the final video.

export type Motion = "none" | "pop" | "bounce";
export const MOTIONS: Record<Motion, { name: string; hint: string }> = {
	none: { name: "Still", hint: "Subtitles don't move" },
	pop: { name: "Pop", hint: "Each line pops in once, then stays still" },
	bounce: { name: "Bounce", hint: "Each line pops in, and words jump out big as they are said" },
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
	[110, 150],
	[280, 100],
];
const BOUNCE_END = BOUNCE[BOUNCE.length - 1][0];
const BOUNCE_GAP = 450; // ms: at most one word jumps in this time, else short words make the line shiver
const POP_END = POP[POP.length - 1][0];

// Which words of a line jump, from when each is said (ms after the line starts). The first word rides
// the pop. Same as bouncing_words in render.py.
export function bouncingWords(froms: number[]) {
	const out: number[] = [];
	let last = 0;
	froms.forEach((ms, k) => {
		if (k > 0 && ms >= POP_END && ms - last >= BOUNCE_GAP) {
			out.push(k);
			last = ms;
		}
	});
	return out;
}

export function scaleAt(keys: Keys, ms: number) {
	if (ms <= keys[0][0]) return keys[0][1];
	for (let i = 1; i < keys.length; i++) {
		const [t1, s1] = keys[i];
		const [t0, s0] = keys[i - 1];
		if (ms < t1) return s0 + ((s1 - s0) * (ms - t0)) / (t1 - t0);
	}
	return keys[keys.length - 1][1];
}

// How big the line and the word in mid-jump are at this moment (1 = normal size; bounced = that word, or -1).
// sinceLine = frames since the line started; froms = when each of its words is said, in the same frames.
export function motionScale(motion: Motion | undefined, fps: number, sinceLine: number, froms: number[]) {
	if (!motion || motion === "none") return { line: 1, word: 1, bounced: -1 };
	const ms = (frames: number) => (frames / fps) * 1000;
	const popping = ms(sinceLine) < POP_END;
	const line = popping ? scaleAt(POP, ms(sinceLine)) / 100 : 1;
	if (motion !== "bounce") return { line, word: 1, bounced: -1 };
	// A jump carries on after the next word starts: it only ends when it has finished.
	const now = ms(sinceLine);
	const from = froms.map(ms);
	const bounced = bouncingWords(from).findLast((k) => from[k] <= now) ?? -1;
	if (bounced < 0 || now - from[bounced] >= BOUNCE_END) return { line, word: 1, bounced: -1 };
	return { line, word: scaleAt(BOUNCE, now - from[bounced]) / 100, bounced };
}
