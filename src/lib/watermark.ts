// The Free plan's watermark (coach, 18 Nov): the word Komoray in white (public/watermark.png), at 35% with a thin shadow, small
// enough not to be in the way but still readable, kept well in from the edges, and moving to a corner picked at random
// every few seconds. The preview (PlayerFrame) and the final video (WATERMARK, watermark_corners and the overlay in
// ffmpeg_command, render.py) work it out the same way, so both show it in the same corner at the same moment.
// "Random" is the same for every showing of one video: the corners follow from the video's id.

export const WATERMARK = {
	// Change it whenever the watermark looks different (picture, size, place, timing): it is in the video's fingerprint
	// (api/render), so a watermarked video is made again instead of handing back one with the old watermark.
	rev: "2026-11-18c", // b: 35% with a shadow · c: 10% bigger, drifts slowly, fades between corners
	file: "/watermark.png", // the word with a thin shadow baked in (10% once faded, coach 18 Nov), 1225 x 321 px
	opacity: 0.35, // coach 18 Nov: 30% was too faint on a white background
	width: 0.206, // of the frame's shorter side: 222 px on a 1080 px side, the word itself ~213 px (coach 18 Nov: 10% bigger)
	margin: 0.08, // from both edges of its corner, of the shorter side: 86 px (the Brand Kit logo sits 40 px in)
	every: 8, // seconds in one corner before it moves
	// Coach 18 Nov: drift slowly in a small loop, like a screensaver, and fade out and back in at the next corner.
	fade: 0.6, // seconds to fade in at a corner, and out before leaving it
	drift: 0.015, // how far it wanders from its place, of the shorter side: 16 px; it never comes nearer the edge than `margin`
	driftX: 7, // seconds for one sway side to side
	driftY: 9, // and up and down: different, so the path loops instead of going back and forth on a line
};

export type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
const CORNERS: Corner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

// FNV-1a over the id's characters, 32-bit: the starting point of this video's corners.
export function watermarkSeed(id: string) {
	let h = 0x811c9dc5;
	for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
	return h >>> 0;
}

// One number per stretch of `every` seconds (xorshift32 of the seed mixed with the stretch's number).
function draw(seed: number, slot: number) {
	let x = (seed ^ Math.imul(slot + 1, 0x9e3779b1)) >>> 0;
	x = (x ^ (x << 13)) >>> 0;
	x = (x ^ (x >>> 17)) >>> 0;
	x = (x ^ (x << 5)) >>> 0;
	return x;
}

// The corner for each stretch: the first at random, then always a different one from the stretch before.
const cache = new Map<number, number[]>();
export function watermarkCorner(seed: number, seconds: number): Corner {
	const slot = Math.max(0, Math.floor(seconds / WATERMARK.every));
	const list = cache.get(seed) ?? [draw(seed, 0) % 4];
	while (list.length <= slot) list.push((list[list.length - 1] + 1 + (draw(seed, list.length) % 3)) % 4);
	cache.set(seed, list);
	return CORNERS[list[slot]];
}

// Where it is at this moment, in the output's pixels: its corner, its width, how far its side and its top or bottom are
// from the frame's edges (ready for CSS left/right and top/bottom), and how see-through it is. The same sums as
// watermark_filters in render.py: the drift goes by the time in the whole video, each corner swaying from its own phase.
export function watermarkAt(seed: number, seconds: number, W: number, H: number) {
	const corner = watermarkCorner(seed, seconds);
	const k = CORNERS.indexOf(corner);
	const { width, margin } = watermarkBox(W, H);
	const reach = Math.round(Math.min(W, H) * WATERMARK.drift);
	const dx = reach * Math.sin((2 * Math.PI * seconds) / WATERMARK.driftX + k * 1.7);
	const dy = reach * Math.sin((2 * Math.PI * seconds) / WATERMARK.driftY + k * 0.9);
	const u = ((seconds % WATERMARK.every) + WATERMARK.every) % WATERMARK.every;
	const shown = Math.min(1, Math.max(0, Math.min(u / WATERMARK.fade, (WATERMARK.every - u) / WATERMARK.fade)));
	const inset = margin + reach;
	return {
		corner,
		width,
		side: corner.endsWith("right") ? inset - dx : inset + dx,
		edge: corner.startsWith("bottom") ? inset - dy : inset + dy,
		opacity: WATERMARK.opacity * shown,
	};
}

// Its size and distance from the edges, in the output's pixels.
export function watermarkBox(W: number, H: number) {
	const short = Math.min(W, H);
	return { width: Math.round(short * WATERMARK.width), margin: Math.round(short * WATERMARK.margin) };
}
