// Subtitles that move: each line pops in, and with Bounce every word jumps out as it is said.
// Saved in the style as "motion". Same keyframes and rules as POP, BOUNCE and bounce_events in
// modal_app/render.py, which writes them as ASS \t tags, so the preview moves like the final video.

export type Motion = "none" | "pop" | "bounce";
export const MOTIONS: Record<Motion, { name: string; hint: string }> = {
	none: { name: "Still", hint: "Subtitles don't move" },
	pop: { name: "Pop", hint: "Each line pops in once, then stays still" },
	bounce: { name: "Bounce", hint: "Every word jumps out big as it is said, from the first word on" },
};

// (milliseconds after the start, size in %), straight lines between them.
type Keys = [number, number][];
export const POP: Keys = [
	[0, 70],
	[90, 110],
	[170, 100],
];
// Up, a moment at the top, down, a small dip, settle. Every word plays this from when it is said.
export const BOUNCE: Keys = [
	[0, 100],
	[60, 125],
	[120, 150],
	[200, 145],
	[300, 110],
	[370, 97],
	[440, 100],
];
export const BOUNCE_WORD_GAP = 0.14; // of the text size: room kept between words, so two big words don't cover each other
const BOUNCE_END = BOUNCE[BOUNCE.length - 1][0];
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

// How big the line and each of its words are at this moment (1 = normal size; jumping = in mid-jump).
// sinceLine = frames since the line started; froms = when each of its words is said, in the same frames.
export function motionScale(motion: Motion | undefined, fps: number, sinceLine: number, froms: number[]) {
	const ms = (frames: number) => (frames / fps) * 1000;
	const now = ms(sinceLine);
	const line = motion === "pop" && now < POP_END ? scaleAt(POP, now) / 100 : 1;
	const words = froms.map((from) => {
		const since = now - ms(from);
		const jumping = motion === "bounce" && since >= 0 && since < BOUNCE_END;
		return { scale: jumping ? scaleAt(BOUNCE, since) / 100 : 1, jumping };
	});
	return { line, words };
}
