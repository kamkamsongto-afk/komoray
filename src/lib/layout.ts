// Layout (coach, 14 Nov): for a stretch of the video, the screen is split in two: the speaker in one part, a project
// picture or clip (or a colour) in the other. Top / bottom or side by side. Saved in edit.json as "layouts". Drawn by
// PlayerFrame in the preview and by layout_filters in modal_app/render.py for the final video, with the same boxes
// (layoutBoxes = layout_boxes) and the same moves (layoutProgress = layout_ease_expr, layoutFlash = LAYOUT_FLASH).
//
// The speaker's picture is never made smaller or bigger: it fills the whole width (top / bottom) or the whole height
// (side by side) already, so it is only moved, until the point picked (meX, meY: the face, at first) sits in the middle
// of its part, as far as the picture still covers the part. Moving only, the final video stays as sharp as before.

import { readClipSound } from "./clip-sound";

export type LayoutKind = "stack" | "side"; // stack: top / bottom. side: left / right
export type LayoutEnter = "slide" | "flash" | "cut";

// start / end: seconds of the final video. meFirst: the speaker on top (stack) or on the left (side).
// split: the speaker's share of the height (stack) or width (side). meX, meY: the point of the speaker's picture
// (share of its width / height) put in the middle of the speaker's part. file: a project file (Import) for the other
// part, else color fills it.
export type VideoLayout = {
	id: string;
	start: number;
	end: number;
	kind: LayoutKind;
	meFirst: boolean;
	split: number;
	meX: number;
	meY: number;
	color: string;
	enter: LayoutEnter;
	file?: string;
	media?: "image" | "video";
	volume?: number; // a clip's own sound (lib/clip-sound.ts)
	muted?: boolean;
	name?: string;
};

export const LAYOUT = {
	split: { min: 0.3, max: 0.7, start: 0.5 },
	me: { x: 0.5, y: 0.4 }, // where a face sits in the framed video (FACE_HEIGHT in framing.ts)
	slide: 0.5, // seconds the other part takes to slide in, and out. LAYOUT_SLIDE in render.py
	flash: 0.15, // seconds the white flash takes to come up, and to go, at each edge. LAYOUT_FLASH in render.py
	maxItems: 10,
	seconds: 5,
};

export const LAYOUT_KINDS: { id: LayoutKind; name: string }[] = [
	{ id: "stack", name: "Top / bottom" },
	{ id: "side", name: "Side by side" },
];
export const LAYOUT_ENTERS: { id: LayoutEnter; name: string; note: string }[] = [
	{ id: "slide", name: "Slide", note: "The other half slides in and pushes you over" },
	{ id: "flash", name: "Flash", note: "A white flash, and the screen is split" },
	{ id: "cut", name: "Cut", note: "Splits at once" },
];
export const LAYOUT_COLORS = ["#000000", "#FFFFFF", "#1C1C1E", "#FFE600", "#FF2D95", "#0A84FF", "#34C759"];

export const NEW_LAYOUT = (start: number, end: number, kind: LayoutKind = "stack"): VideoLayout => ({
	id: crypto.randomUUID(),
	start,
	end,
	kind,
	meFirst: true,
	split: LAYOUT.split.start,
	meX: LAYOUT.me.x,
	meY: LAYOUT.me.y,
	color: "#000000",
	enter: "slide",
});

// The layout showing at final-video second t: the last one in the list wins when two overlap (it is on top, lib/layers.ts).
export const layoutAt = (layouts: VideoLayout[] | undefined, t: number) => layouts?.findLast((l) => t >= l.start && t < l.end);

const ease = (u: number) => (u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2);

// How far it is split at final-video second t: 0 = the whole screen is the speaker, 1 = split. Only Slide moves;
// a layout shorter than both slides slides over half its time each way. Same as layout_ease_expr in render.py.
export function layoutProgress(l: VideoLayout, t: number) {
	if (t < l.start || t >= l.end) return 0;
	if (l.enter !== "slide") return 1;
	const d = Math.min(LAYOUT.slide, (l.end - l.start) / 2);
	return ease(Math.max(0, Math.min(1, (t - l.start) / d, (l.end - t) / d)));
}

// The white flash over the picture at final-video second t, 0..1: up to full at each edge of a Flash layout, from
// LAYOUT.flash before it to LAYOUT.flash after it. Same as layout_flashes in render.py.
export function layoutFlash(layouts: VideoLayout[] | undefined, t: number) {
	let most = 0;
	for (const l of layouts ?? []) {
		if (l.enter !== "flash") continue;
		for (const edge of [l.start, l.end]) most = Math.max(most, 1 - Math.abs(t - edge) / LAYOUT.flash);
	}
	return most;
}

type Box = { x: number; y: number; w: number; h: number };

// On a W x H video, px: the speaker's part, the other part, and where the speaker's whole picture goes once split
// (its top left corner; it keeps its size). Same as layout_boxes in render.py.
export function layoutBoxes(l: VideoLayout, W: number, H: number): { me: Box; other: Box; picture: { x: number; y: number } } {
	const stack = l.kind === "stack";
	// Even px, so both parts are whole for the final video's colour samples (2 x 2 px each). js_round(...) * 2 in render.py.
	const mine = 2 * Math.round((l.split * (stack ? H : W)) / 2);
	const me: Box = stack ? { x: 0, y: l.meFirst ? 0 : H - mine, w: W, h: mine } : { x: l.meFirst ? 0 : W - mine, y: 0, w: mine, h: H };
	const other: Box = stack ? { x: 0, y: l.meFirst ? mine : 0, w: W, h: H - mine } : { x: l.meFirst ? mine : 0, y: 0, w: W - mine, h: H };
	// The picked point in the middle of the speaker's part, as far as the picture still covers all of it.
	const along = (middle: number, point: number, from: number, size: number, whole: number) => Math.min(from, Math.max(from + size - whole, middle - point));
	const picture = { x: along(me.x + me.w / 2, l.meX * W, me.x, me.w, W), y: along(me.y + me.h / 2, l.meY * H, me.y, me.h, H) };
	return { me, other, picture };
}

// Where everything is at progress p (layoutProgress): the speaker's picture moved p of the way, the other part slid in
// from its own edge of the screen. Same as the overlay x / y expressions in layout_filters (render.py).
export function layoutPose(l: VideoLayout, p: number, W: number, H: number) {
	const { me, other, picture } = layoutBoxes(l, W, H);
	const away = 1 - p;
	const slid = l.kind === "stack" ? { x: other.x, y: other.y + (l.meFirst ? 1 : -1) * away * other.h } : { x: other.x + (l.meFirst ? 1 : -1) * away * other.w, y: other.y };
	return { me, other: { ...other, ...slid }, picture: { x: p * picture.x, y: p * picture.y } };
}

export const layoutName = (l: VideoLayout) => l.name?.trim() || LAYOUT_KINDS.find((k) => k.id === l.kind)?.name || "Layout";

// ---- checking what the browser sends ----

const num = (v: unknown, lo: number, hi: number, fallback: number) => {
	const n = Number(v);
	return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const round = (n: number, by = 1000) => Math.round(n * by) / by;
const HEX = /^#[0-9a-f]{6}$/i;
const LAYOUT_FILE = /^(media|banner|insert)-[a-zA-Z0-9-]{1,40}\.(jpg|png|webp|gif|mp4|mov)$/;

export function readLayouts(value: unknown): VideoLayout[] | null {
	if (!Array.isArray(value)) return null;
	const layouts: VideoLayout[] = [];
	for (const l of value.slice(0, LAYOUT.maxItems) as Record<string, unknown>[]) {
		const start = Number(l?.start);
		const end = Number(l?.end);
		if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) continue;
		const file = typeof l.file === "string" && LAYOUT_FILE.test(l.file) ? l.file : undefined;
		const clip = Boolean(file && /\.(mp4|mov)$/.test(file));
		layouts.push({
			id: String(l.id ?? "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40) || crypto.randomUUID(),
			start: round(start, 100),
			end: round(end, 100),
			kind: l.kind === "side" ? "side" : "stack",
			meFirst: l.meFirst !== false,
			split: round(num(l.split, LAYOUT.split.min, LAYOUT.split.max, LAYOUT.split.start)),
			meX: round(num(l.meX, 0, 1, LAYOUT.me.x)),
			meY: round(num(l.meY, 0, 1, LAYOUT.me.y)),
			color: typeof l.color === "string" && HEX.test(l.color) ? l.color.toUpperCase() : "#000000",
			enter: LAYOUT_ENTERS.some((e) => e.id === l.enter) ? (l.enter as LayoutEnter) : "slide",
			...(file && { file, media: clip ? ("video" as const) : ("image" as const) }),
			...readClipSound(l, clip),
			...(typeof l.name === "string" && l.name.trim() && { name: l.name.replace(/[\n\r\t]/g, " ").trim().slice(0, 40) }),
		});
	}
	return layouts;
}
