// The Free plan's watermark (coach, 18 Nov): the word Komoray in white (public/watermark.png), 30% see-through, small
// enough not to be in the way but still readable, kept well in from the edges, and moving to a corner picked at random
// every few seconds. The preview (PlayerFrame) and the final video (WATERMARK, watermark_corners and the overlay in
// ffmpeg_command, render.py) work it out the same way, so both show it in the same corner at the same moment.
// "Random" is the same for every showing of one video: the corners follow from the video's id.

export const WATERMARK = {
	file: "/watermark.png", // the word only, cropped to its ink: 1177 x 273 px
	opacity: 0.3,
	width: 0.18, // of the frame's shorter side: 194 px on a 1080 px side
	margin: 0.08, // from both edges of its corner, of the shorter side: 86 px (the Brand Kit logo sits 40 px in)
	every: 8, // seconds in one corner before it moves
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

// Its size and distance from the edges, in the output's pixels.
export function watermarkBox(W: number, H: number) {
	const short = Math.min(W, H);
	return { width: Math.round(short * WATERMARK.width), margin: Math.round(short * WATERMARK.margin) };
}
