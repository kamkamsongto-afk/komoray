// Frame Me (coach, 12 Nov): for a stretch of the video, the speaker shows inside a shape (circle, heart, star...)
// over a background, like an alpha mask in OBS. Nothing is cut out, so it is ready at once. Saved in edit.json as
// "frames". Drawn by PlayerFrame in the preview and by frame_filters in modal_app/render.py for the final video,
// with the same shapes (framePoints = frame_points) and the same placing (frameRect, framePicture = frame_place).

import { readClipSound } from "./clip-sound";

export type FrameShape = "circle" | "oval" | "square" | "rounded" | "triangle" | "star" | "heart";
export type FrameBack = "blur" | "color" | "file";

export const FRAME_SHAPES: { id: FrameShape; name: string; ratio: number }[] = [
	// ratio: the shape's height / width
	{ id: "circle", name: "Circle", ratio: 1 },
	{ id: "oval", name: "Oval", ratio: 1.3 },
	{ id: "square", name: "Square", ratio: 1 },
	{ id: "rounded", name: "Rounded", ratio: 1.25 },
	{ id: "triangle", name: "Triangle", ratio: 0.9 },
	{ id: "star", name: "Star", ratio: 1 },
	{ id: "heart", name: "Heart", ratio: 0.9 },
];

// start / end: seconds of the final video. x, y: the shape's middle, share of the width / height. size: the shape's width,
// share of the video's shorter side (its width on 9:16, its height on 16:9: the same frame fits on either). zoom: how big the speaker's picture is inside (1 = as big as the video). meX, meY: the point of
// the speaker's picture (share of its width / height) that sits in the shape's middle: the face, at first.
export type FrameMe = {
	id: string;
	start: number;
	end: number;
	shape: FrameShape;
	x: number;
	y: number;
	size: number;
	zoom: number;
	meX: number;
	meY: number;
	border: number; // px on the 1080-wide video, 0 = none
	borderColor: string;
	back: FrameBack;
	backColor: string; // back "color"
	dim: number; // back "blur": black laid over the blurred video, 0..FRAME.dim.max
	blur: number; // back "blur": px on the 1080-wide video
	file?: string; // back "file": a project file (Import), next to the video
	media?: "image" | "video";
	volume?: number; // a clip background's own sound (lib/clip-sound.ts)
	muted?: boolean;
	name?: string;
};

export const FRAME = {
	size: { min: 0.15, max: 1.2, start: 0.75 },
	zoom: { min: 0.2, max: 2.5, start: 0.75 },
	move: { min: -0.2, max: 1.2 }, // x, y: the shape may go partly off the screen
	border: { max: 40, start: 10 },
	dim: { max: 0.8, start: 0.3 },
	blur: { max: 60, start: 30 },
	maxItems: 10,
	seconds: 3,
	fade: 0.25, // seconds it takes to fade in, and out (coach, 12 Nov). FRAME_FADE in render.py
	me: { x: 0.5, y: 0.4 }, // where a face sits in the framed video (FACE_HEIGHT in framing.ts)
};

export const BORDER_COLORS = ["#FFFFFF", "#000000", "#FFE600", "#FF3B30", "#FF2D95", "#34C759", "#0A84FF"];
export const BACK_COLORS = ["#000000", "#FFFFFF", "#1C1C1E", "#FFE600", "#FF2D95", "#0A84FF", "#34C759"];

export const NEW_FRAME = (start: number, end: number, shape: FrameShape = "circle"): FrameMe => ({
	id: crypto.randomUUID(),
	start,
	end,
	shape,
	x: 0.5,
	y: 0.42,
	size: FRAME.size.start,
	zoom: FRAME.zoom.start,
	meX: FRAME.me.x,
	meY: FRAME.me.y,
	border: FRAME.border.start,
	borderColor: "#FFFFFF",
	back: "blur",
	backColor: "#000000",
	dim: FRAME.dim.start,
	blur: FRAME.blur.start,
});

// The frame showing at final-video second t: the last one in the list wins when two overlap (it is on top, lib/layers.ts).
// How far it has faded in at final-video second t: 0..1. Same fades as frame_filters in render.py.
// A frame shorter than both fades fades over half its time each way, so it still shows fully in its middle.
export function frameShown(f: FrameMe, t: number) {
	if (t < f.start || t >= f.end) return 0;
	const fade = Math.min(FRAME.fade, (f.end - f.start) / 2);
	return Math.max(0, Math.min(1, (t - f.start) / fade, (f.end - t) / fade));
}

export const frameAt = (frames: FrameMe[] | undefined, t: number) => frames?.findLast((f) => t >= f.start && t < f.end);

export const shapeRatio = (shape: FrameShape) => FRAME_SHAPES.find((s) => s.id === shape)?.ratio ?? 1;

// The shape's box on a W x H video, px.
export function frameRect(f: FrameMe, W: number, H: number) {
	const w = f.size * Math.min(W, H);
	const h = w * shapeRatio(f.shape);
	return { x: f.x * W - w / 2, y: f.y * H - h / 2, w, h };
}

// Where the speaker's whole picture goes on a W x H video: its top left corner, and its scale (zoom).
export const framePicture = (f: FrameMe, W: number, H: number) => ({ x: f.x * W - f.zoom * f.meX * W, y: f.y * H - f.zoom * f.meY * H, scale: f.zoom });

// The shape's outline, as points from -0.5 to 0.5 of its box (y down). Same numbers as frame_points in render.py.
const ROUND = 0.18; // Rounded: the corners' radius, share of the shorter side
export function framePoints(shape: FrameShape): [number, number][] {
	const ring = (n: number, at: (a: number) => [number, number]) => Array.from({ length: n }, (_, k) => at((2 * Math.PI * k) / n));
	switch (shape) {
		case "circle":
		case "oval":
			return ring(96, (a) => [0.5 * Math.cos(a), 0.5 * Math.sin(a)]);
		case "square":
			return [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
		case "rounded": {
			// In the box's own units: a circle's corner looks round once the box is stretched to its ratio.
			const r = ROUND;
			const ratio = shapeRatio("rounded");
			const ry = r / ratio;
			const corners: [number, number, number][] = [[0.5 - r, -0.5 + ry, -Math.PI / 2], [0.5 - r, 0.5 - ry, 0], [-0.5 + r, 0.5 - ry, Math.PI / 2], [-0.5 + r, -0.5 + ry, Math.PI]];
			return corners.flatMap(([cx, cy, from]) => Array.from({ length: 9 }, (_, k): [number, number] => {
				const a = from + (k / 8) * (Math.PI / 2);
				return [cx + r * Math.cos(a), cy + ry * Math.sin(a)];
			}));
		}
		case "triangle":
			return [[0, -0.5], [0.5, 0.5], [-0.5, 0.5]];
		case "star": {
			const points = Array.from({ length: 10 }, (_, k): [number, number] => {
				const a = -Math.PI / 2 + (k * Math.PI) / 5;
				const r = k % 2 ? 0.25 : 0.5;
				return [r * Math.cos(a), r * Math.sin(a)];
			});
			return fit(points);
		}
		case "heart":
			// The classic heart curve, stretched to fill its box.
			return fit(ring(120, (t) => [16 * Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]));
	}
}

// Stretched to fill -0.5..0.5 both ways, so the shape fills its box.
function fit(points: [number, number][]): [number, number][] {
	const xs = points.map((p) => p[0]);
	const ys = points.map((p) => p[1]);
	const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
	return points.map(([x, y]) => [(x - x0) / (x1 - x0) - 0.5, (y - y0) / (y1 - y0) - 0.5]);
}

// The shape as an SVG polygon's points, in a w x h box (px).
export const shapePolygon = (shape: FrameShape, w: number, h: number) => framePoints(shape).map(([x, y]) => `${((x + 0.5) * w).toFixed(2)},${((y + 0.5) * h).toFixed(2)}`).join(" ");

// A mask the shape of the frame, stretched to whatever box it is put on (CSS mask-image).
export function shapeMask(shape: FrameShape) {
	const points = framePoints(shape).map(([x, y]) => `${(x + 0.5).toFixed(4)},${(y + 0.5).toFixed(4)}`).join(" ");
	return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" preserveAspectRatio="none"><polygon points="${points}" fill="#fff"/></svg>`)}")`;
}

export const frameName = (f: FrameMe) => f.name || FRAME_SHAPES.find((s) => s.id === f.shape)?.name || "Frame";

// ---- checking what the browser sends ----

const num = (v: unknown, lo: number, hi: number, fallback: number) => {
	const n = Number(v);
	return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const round = (n: number, by = 1000) => Math.round(n * by) / by;
const HEX = /^#[0-9a-f]{6}$/i;
const colour = (v: unknown, fallback: string) => (typeof v === "string" && HEX.test(v) ? v.toUpperCase() : fallback);
const FRAME_FILE = /^(media|banner|insert)-[a-zA-Z0-9-]{1,40}\.(jpg|png|webp|gif|mp4|mov)$/;

export function readFrames(value: unknown): FrameMe[] | null {
	if (!Array.isArray(value)) return null;
	const frames: FrameMe[] = [];
	for (const f of value.slice(0, FRAME.maxItems) as Record<string, unknown>[]) {
		const start = Number(f?.start);
		const end = Number(f?.end);
		if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) continue;
		const shape = FRAME_SHAPES.some((s) => s.id === f.shape) ? (f.shape as FrameShape) : "circle";
		const file = typeof f.file === "string" && FRAME_FILE.test(f.file) ? f.file : undefined;
		const back: FrameBack = f.back === "color" ? "color" : f.back === "file" && file ? "file" : "blur";
		frames.push({
			id: String(f.id ?? "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40) || crypto.randomUUID(),
			start: round(start, 100),
			end: round(end, 100),
			shape,
			x: round(num(f.x, FRAME.move.min, FRAME.move.max, 0.5)),
			y: round(num(f.y, FRAME.move.min, FRAME.move.max, 0.42)),
			size: round(num(f.size, FRAME.size.min, FRAME.size.max, FRAME.size.start)),
			zoom: round(num(f.zoom, FRAME.zoom.min, FRAME.zoom.max, FRAME.zoom.start)),
			meX: round(num(f.meX, 0, 1, FRAME.me.x)),
			meY: round(num(f.meY, 0, 1, FRAME.me.y)),
			border: Math.round(num(f.border, 0, FRAME.border.max, 0)),
			borderColor: colour(f.borderColor, "#FFFFFF"),
			back,
			backColor: colour(f.backColor, "#000000"),
			dim: round(num(f.dim, 0, FRAME.dim.max, FRAME.dim.start), 100),
			blur: Math.round(num(f.blur, 0, FRAME.blur.max, FRAME.blur.start)),
			...(file && { file, media: /\.(mp4|mov)$/.test(file) ? ("video" as const) : ("image" as const) }),
			...readClipSound(f, Boolean(file && /\.(mp4|mov)$/.test(file))),
			...(typeof f.name === "string" && f.name.trim() && { name: f.name.replace(/[\n\r\t]/g, " ").trim().slice(0, 40) }),
		});
	}
	return frames;
}
