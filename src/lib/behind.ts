// Cutout layers: big text behind the speaker, and a picture or clip shown behind a smaller speaker.
// Saved in edit.json as "cutout": { texts, inserts }. Drawn by PlayerFrame in the preview and by
// behind_events / behind_motion / insert filters in modal_app/render.py for the final video: the motion
// is worked out frame by frame with the same formulas on both sides (behindMotion = behind_motion).
// The speaker is cut out by modal_app/cutout.py only for the windows these layers cover (cutoutWindows).
import { FONTS, type FontId } from "./subtitle-style";
import { FPS, type Segment } from "./timeline";
import type { Window } from "./cutout";

// How a text arrives. run*: slides across the screen all the time it shows (a news ticker).
export type BehindFx = "fade" | "burst" | "drop" | "pulse" | "runLeft" | "runRight";
export const BEHIND_FX: Record<BehindFx, string> = {
	fade: "Fade in",
	burst: "Burst from behind",
	drop: "Drop and slam",
	pulse: "Heartbeat",
	runLeft: "Run right to left",
	runRight: "Run left to right",
};
export type BehindSpeed = "slow" | "normal" | "fast";
// Running text: px per second. The other kinds: how long their arrival takes, 1 = normal.
export const RUN_SPEED: Record<BehindSpeed, number> = { slow: 150, normal: 300, fast: 600 };
export const ARRIVE_TIME: Record<BehindSpeed, number> = { slow: 1.6, normal: 1, fast: 0.6 };

// start / end: seconds of the final video. size: px on the 1080-wide video. y: where its middle is, share of the height.
export type BehindText = {
	id: string;
	text: string;
	start: number;
	end: number;
	font: FontId;
	size: number;
	color: string;
	stroke: number; // outline width, px
	strokeColor: string;
	fx: BehindFx;
	speed: BehindSpeed;
	y: number;
};

// A picture or clip (uploaded next to the video as insert-<id>.<ext>) filling the screen behind the speaker,
// who becomes smaller (speakerScale, middle at speakerX, feet on the bottom edge) or hidden.
export type Insert = {
	id: string;
	kind: "image" | "video";
	file: string; // its name in R2, next to the video
	start: number;
	end: number;
	speakerScale: number;
	speakerX: number;
	hidden: boolean;
};

export type CutoutLayers = { texts: BehindText[]; inserts: Insert[] };
export const NO_LAYERS: CutoutLayers = { texts: [], inserts: [] };

export const BEHIND = { size: { min: 80, max: 420, start: 260 }, stroke: { max: 24 }, maxText: 40, maxItems: 10, seconds: 3, fade: 0.25, y: 0.16 };
// edgeFade: a smaller speaker fades out over this share of their width at the left and right. The camera
// often cuts the shoulders off at the frame's side, which else ends in a hard straight line (7 Nov test).
// Same as INSERT_EDGE_FADE in render.py.
export const INSERT = { scale: { min: 0.25, max: 1, start: 0.5 }, fade: 0.25, edgeFade: 0.12, maxBytes: { image: 10_000_000, video: 150_000_000 } };
// Running text: the words, again and again, so the screen stays full for as long as it runs. Counted the
// same way here and in render.py (run_repeats), so both draw the same string.
export const RUN_GAP = "   •   ";

export function runRepeats(t: BehindText, width: number) {
	const reach = width + RUN_SPEED[t.speed] * (t.end - t.start);
	const each = 0.4 * t.size * Array.from(t.text + RUN_GAP).length; // a low guess of its width: never too few
	return Math.min(40, Math.ceil(reach / Math.max(1, each)) + 1);
}
export const runText = (t: BehindText, width: number) => Array(runRepeats(t, width)).fill(t.text).join(RUN_GAP);

const smooth = (p: number) => {
	const q = Math.min(1, Math.max(0, p));
	return q * q * (3 - 2 * q);
};
const easeOutBack = (p: number) => 1 + 2.9 * (p - 1) ** 3 + 1.9 * (p - 1) ** 2;

// Where a text is at final-video second t, on a width x height video. align: which point x is
// (its middle, or its left / right end for running text). ghosts: fading copies (Burst).
export type Pose = { opacity: number; x: number; y: number; sx: number; sy: number; align: "center" | "left" | "right" };
export function behindMotion(b: BehindText, t: number, width: number, height: number): Pose[] {
	if (t < b.start || t >= b.end) return [];
	const s = t - b.start;
	const k = ARRIVE_TIME[b.speed];
	const out = Math.min(1, (b.end - t) / BEHIND.fade);
	const y = b.y * height;
	const pose = (opacity: number, py = y, sx = 1, sy = sx, x = width / 2, align: Pose["align"] = "center"): Pose => ({ opacity: opacity * out, x, y: py, sx, sy, align });
	switch (b.fx) {
		case "fade": {
			const p = smooth(s / (0.8 * k));
			return [pose(p, y + 40 * (1 - p))];
		}
		case "pulse": {
			const q = s % 0.9;
			const beat = 0.09 * Math.exp(-(((q - 0.05) / 0.05) ** 2)) + 0.05 * Math.exp(-(((q - 0.25) / 0.05) ** 2));
			return [pose(Math.min(1, s / 0.2), y, 1 + beat)];
		}
		case "burst": {
			const span = 0.45 * k;
			const scale = 0.25 + 0.75 * easeOutBack(Math.min(s / span, 1));
			const py = y + 0.12 * height * (1 - smooth(s / (0.3 * k)));
			const poses = [pose(Math.min(1, s / 0.08), py, scale)];
			const fade = Math.max(0, 1 - s / span);
			if (fade > 0) poses.push(pose(0.35 * fade, py, scale * (1 + 0.18 * (1 - fade))), pose(0.15 * fade, py, scale * (1 + 0.4 * (1 - fade))));
			return poses;
		}
		case "drop": {
			const fall = 0.32 * k;
			if (s < fall) return [pose(1, -b.size + (y + b.size) * (s / fall) ** 2)];
			const q = s - fall;
			const squash = Math.exp(-q / 0.07) * Math.cos(q * 45);
			return [pose(1, y + 20 * squash, 1 + 0.12 * squash, 1 - 0.18 * squash)];
		}
		case "runLeft":
			return [pose(Math.min(1, s / 0.3), y, 1, 1, 0.1 * width - RUN_SPEED[b.speed] * s, "left")];
		case "runRight":
			return [pose(Math.min(1, s / 0.3), y, 1, 1, 0.9 * width + RUN_SPEED[b.speed] * s, "right")];
	}
}

// How much of the inserted picture shows (it fades in and out), at final-video second t.
export function insertShown(i: Insert, t: number) {
	if (t < i.start || t >= i.end) return 0;
	return Math.min(1, (t - i.start) / INSERT.fade, (i.end - t) / INSERT.fade);
}

// The parts of the source video the speaker must be cut out for: every layer's time on the final video,
// back on the source, a little wider so a cut-in-between never shows the edge.
export function cutoutWindows(layers: CutoutLayers, segments: Segment[]): Window[] {
	const spans: Window[] = [];
	for (const item of [...layers.texts, ...layers.inserts]) {
		const a = item.start * FPS;
		const b = item.end * FPS;
		for (const seg of segments) {
			const from = Math.max(a, seg.from);
			const to = Math.min(b, seg.from + seg.frames);
			if (to > from) spans.push([(seg.trim + from - seg.from) / FPS - 0.1, (seg.trim + to - seg.from) / FPS + 0.1]);
		}
	}
	return spans;
}

// Every part of the source video that stays in the final video: Cut me out covers all of it, so a text or
// picture can then go anywhere without cutting out again. Gaps under a second are bridged: it costs almost
// nothing and a short part on its own would be too short to ask for.
export function keptWindows(segments: Segment[]): Window[] {
	const parts: Window[] = [];
	for (const seg of segments) {
		const start = Math.max(0, seg.trim / FPS - 0.1);
		const end = (seg.trim + seg.frames) / FPS + 0.1;
		const last = parts.at(-1);
		if (last && start - last[1] < 1) last[1] = Math.max(last[1], end);
		else parts.push([start, end]);
	}
	return parts.map(([a, b]): Window => [a, Math.max(b, a + 0.5)]);
}

// Are these windows (what the layers need) all inside the ones already cut out?
export const covered = (need: Window[], done: Window[]) => need.every(([a, b]) => done.some(([c, d]) => c <= a + 0.15 && d >= b - 0.15));

// ---- checking what the browser sends ----

const HEX = /^#[0-9a-f]{6}$/i;
const num = (v: unknown, lo: number, hi: number, fallback: number) => {
	const n = Number(v);
	return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const round = (n: number, by = 100) => Math.round(n * by) / by;
export const cleanBehindText = (text: string) =>
	text
		.replace(/\p{Extended_Pictographic}|‍|️/gu, "")
		.replace(/[\\{}\n\r]/g, "")
		.trim()
		.slice(0, BEHIND.maxText);
const id = (v: unknown) => String(v ?? "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40) || crypto.randomUUID();
const INSERT_FILE = /^insert-[a-zA-Z0-9-]{1,40}\.(jpg|png|webp|mp4|mov)$/;

export function readCutout(value: unknown): CutoutLayers | null {
	if (!value || typeof value !== "object") return null;
	const raw = value as { texts?: unknown; inserts?: unknown };
	const texts: BehindText[] = [];
	for (const t of (Array.isArray(raw.texts) ? raw.texts : []).slice(0, BEHIND.maxItems) as Record<string, unknown>[]) {
		const start = Number(t?.start);
		const end = Number(t?.end);
		const text = cleanBehindText(String(t?.text ?? ""));
		if (!text || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) continue;
		texts.push({
			id: id(t.id),
			text,
			start: round(start),
			end: round(end),
			font: typeof t.font === "string" && t.font in FONTS ? (t.font as FontId) : "kanit",
			size: Math.round(num(t.size, BEHIND.size.min, BEHIND.size.max, BEHIND.size.start)),
			color: typeof t.color === "string" && HEX.test(t.color) ? t.color.toUpperCase() : "#FFFFFF",
			stroke: Math.round(num(t.stroke, 0, BEHIND.stroke.max, 8)),
			strokeColor: typeof t.strokeColor === "string" && HEX.test(t.strokeColor) ? t.strokeColor.toUpperCase() : "#000000",
			fx: typeof t.fx === "string" && t.fx in BEHIND_FX ? (t.fx as BehindFx) : "fade",
			speed: t.speed === "slow" || t.speed === "fast" ? t.speed : "normal",
			y: round(num(t.y, 0.03, 0.97, BEHIND.y), 1000),
		});
	}
	const inserts: Insert[] = [];
	for (const i of (Array.isArray(raw.inserts) ? raw.inserts : []).slice(0, BEHIND.maxItems) as Record<string, unknown>[]) {
		const start = Number(i?.start);
		const end = Number(i?.end);
		if (typeof i?.file !== "string" || !INSERT_FILE.test(i.file) || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) continue;
		inserts.push({
			id: id(i.id),
			kind: /\.(mp4|mov)$/.test(i.file) ? "video" : "image",
			file: i.file,
			start: round(start),
			end: round(end),
			speakerScale: round(num(i.speakerScale, INSERT.scale.min, INSERT.scale.max, INSERT.scale.start)),
			speakerX: round(num(i.speakerX, 0, 1, 0.25), 1000),
			hidden: i.hidden === true,
		});
	}
	return { texts, inserts };
}
