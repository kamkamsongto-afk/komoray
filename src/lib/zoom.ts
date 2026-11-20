// How close the picture is at every frame of the final video (Auto zoom).
//   "in"      the picture glides closer, stays there, and starts again at the next cut after that
//   "out"     the same the other way: starts close and glides back
//   "cuts"    every other kept piece a little closer: a jump at the cut, like a second camera
//   "smooth"  the picture glides slowly in and back out, across the cuts
// noZoom: parts the user turned zoom off for (source seconds, so they survive new cuts).
// parts: stretches with their own kind of zoom (picked on the timeline, or the AI's key moments), whatever
// the rest of the video does. Inside one, "in" pushes closer and stays, "out" starts close and pulls back,
// "smooth" goes in and back out once, "cuts" (Jump) is closer the whole time.
// Same sums as no_zoom_frames, zoom_shots, zoom_part_frames, part_zoom_expr and smooth_zoom_expr in
// render.py: change one, change the other.
import { FPS, type Segment } from "./timeline";

type Span = { start: number; end: number };

export type PartZoom = "in" | "out" | "smooth" | "cuts";
// amount: how close this part gets (coach 20 Nov: Zoom amount for this part), as the style's zoomAmount; left out:
// the whole video's. Same as the 6th item of zoom_part_frames' runs in render.py.
export type ZoomPart = Span & { zoom: PartZoom; amount?: number };
export const PART_AMOUNT = { min: 1.04, max: 1.3 }; // LIMITS.zoomAmount in subtitle-style.ts
export const PART_ZOOMS: PartZoom[] = ["in", "out", "smooth", "cuts"];
export const ZOOM_NAMES: Record<PartZoom, string> = { in: "Zoom in", out: "Zoom out", smooth: "Back and forth", cuts: "Jump cut" };
export const PART_GLIDE = 0.8; // seconds a part's push in (or pull back) takes, or the whole part if shorter
// A Zoom in part stays close until the next cut, and a Zoom out part is already close from the cut before, so the jump
// back is hidden by the cut (coach 16 Nov: jumping at the part's edge looked jerky, gliding back added a zoom nobody
// asked for). Only if that cut is this many seconds away at most; else it jumps at the edge. Same as PART_HOLD in render.py.
export const PART_HOLD = 2;
export const MAX_ZOOM_PARTS = 300;

// Parts checked as they come from the browser (or the AI): real kinds, inside the video, not over each other.
export function readZoomParts(value: unknown, duration: number): ZoomPart[] | null {
	if (!Array.isArray(value) || value.length > MAX_ZOOM_PARTS) return null;
	const parts: ZoomPart[] = [];
	for (const v of value as Partial<ZoomPart>[]) {
		const { start, end, zoom, amount } = v ?? {};
		if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end)) return null;
		if (!PART_ZOOMS.includes(zoom as PartZoom) || start < 0 || end <= start || start > duration) return null;
		const own = typeof amount === "number" && Number.isFinite(amount) ? Math.round(Math.min(PART_AMOUNT.max, Math.max(PART_AMOUNT.min, amount)) * 100) / 100 : undefined;
		parts.push({ start: Math.round(start * 1000) / 1000, end: Math.round(Math.min(end, duration) * 1000) / 1000, zoom: zoom as PartZoom, ...(own && { amount: own }) });
	}
	parts.sort((a, b) => a.start - b.start);
	return parts.filter((p, i) => i === 0 || p.start >= parts[i - 1].end - 0.0005);
}

// The parts with `span` given this kind (or taken out of them: null). Parts it overlaps keep what is outside it.
export function setZoomPart(parts: ZoomPart[], span: Span, zoom: PartZoom | null, amount?: number): ZoomPart[] {
	const out: ZoomPart[] = [];
	for (const p of parts) {
		if (p.end <= span.start || p.start >= span.end) out.push(p);
		else {
			if (p.start < span.start) out.push({ ...p, end: span.start });
			if (p.end > span.end) out.push({ ...p, start: span.end });
		}
	}
	if (zoom) out.push({ ...span, zoom, ...(amount && { amount }) });
	return out.sort((a, b) => a.start - b.start);
}

// Each part as frames of the final video: [from, to) with its kind. A part across a cut is one run, so
// its zoom carries on over the cut. Same as zoom_part_frames in render.py.
// at, span: where the part's own push in (or pull back) starts and how long the part was, before PART_HOLD moved its edge.
export type ZoomRun = { from: number; to: number; zoom: PartZoom; at: number; span: number; amount?: number };
export function zoomPartFrames(segments: Segment[], parts: ZoomPart[]): ZoomRun[] {
	const runs: ZoomRun[] = [];
	for (const p of parts) {
		let run: ZoomRun | null = null;
		for (const s of segments) {
			const a = Math.max(Math.round(p.start * FPS), s.trim);
			const b = Math.min(Math.round(p.end * FPS), s.trim + s.frames);
			if (b <= a) continue;
			const from = s.from + a - s.trim;
			const to = s.from + b - s.trim;
			if (run && from === run.to) run.to = to;
			else {
				if (run) runs.push(run);
				run = { from, to, zoom: p.zoom, at: from, span: 0, amount: p.amount };
			}
		}
		if (run) runs.push(run);
	}
	runs.sort((x, y) => x.from - y.from);
	for (const r of runs) r.span = r.to - r.from;
	// The hold (PART_HOLD) to the nearest cut, unless another part is in the way.
	const cuts = segments.slice(1).map((s) => s.from);
	const hold = PART_HOLD * FPS;
	const free = (a: number, b: number, self: ZoomRun) => !runs.some((r) => r !== self && r.from < b && r.to > a);
	for (const r of runs) {
		if (r.zoom === "in") {
			const cut = cuts.find((c) => c >= r.to);
			if (cut !== undefined && cut - r.to <= hold && free(r.to, cut, r)) r.to = cut;
		} else if (r.zoom === "out") {
			const cut = cuts.findLast((c) => c <= r.from);
			if (cut !== undefined && r.from - cut <= hold && free(cut, r.from, r)) r.from = cut;
		}
	}
	return runs;
}

// How close a part is at frame f (from..to of the final video). Same as part_zoom_expr in render.py.
export function partZoom(run: ZoomRun, f: number, amount: number) {
	if (run.zoom === "cuts") return amount;
	const length = run.to - run.from;
	if (run.zoom === "smooth") return 1 + (amount - 1) * Math.sin((Math.PI * (f - run.from)) / length);
	// From where the part starts (at), over its own length at most; held before it (out) or after it (in), see PART_HOLD.
	const x = Math.min(1, Math.max(0, (f - run.at) / Math.min(run.span, PART_GLIDE * FPS)));
	const k = x * x * (3 - 2 * x); // eased: starts and ends gently
	return 1 + (amount - 1) * (run.zoom === "in" ? k : 1 - k);
}

export const SMOOTH_FADE = 0.75; // seconds to glide out before (and back in after) a part with no zoom

// "in" and "out": the frame each kept piece's glide started on. A new glide starts at the first cut after the
// last one finished, so the jump back is hidden by a cut. Same as zoom_ramps in render.py.
export function zoomRamps(segments: Segment[], period: number) {
	let ramp = 0;
	return segments.map((s) => {
		if (s.from - ramp >= period * FPS) ramp = s.from;
		return ramp;
	});
}

// The style's zoom settings: how, how close it gets (zoomAmount) and how many seconds a glide in and back out takes (zoomPeriod).
export type ZoomStyle = { zoom: string; zoomAmount: number; zoomPeriod: number };

// The noZoom parts as frames of the final video: [from, to), merged where they touch.
export function noZoomFrames(segments: Segment[], noZoom: Span[]): [number, number][] {
	const ranges: [number, number][] = [];
	for (const s of segments) {
		for (const n of noZoom) {
			const a = Math.max(Math.round(n.start * FPS), s.trim);
			const b = Math.min(Math.round(n.end * FPS), s.trim + s.frames);
			if (b > a) ranges.push([s.from + a - s.trim, s.from + b - s.trim]);
		}
	}
	ranges.sort((x, y) => x[0] - y[0]);
	const merged: [number, number][] = [];
	for (const r of ranges) {
		const last = merged[merged.length - 1];
		if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
		else merged.push([r[0], r[1]]);
	}
	return merged;
}

// The zoom at a frame of the final video (1 = none): a part's own zoom, else the whole video's.
export function zoomTrack(segments: Segment[], noZoom: Span[], style: ZoomStyle, parts: ZoomPart[] = []): (frame: number) => number {
	const base = videoZoom(segments, noZoom, style);
	if (!parts.length) return base;
	const runs = zoomPartFrames(segments, parts);
	return (f) => {
		const run = runs.find((r) => f >= r.from && f < r.to);
		return run ? partZoom(run, f, run.amount ?? style.zoomAmount) : base(f);
	};
}

// The whole video's zoom (style.zoom), with noZoom turned off.
function videoZoom(segments: Segment[], noZoom: Span[], style: ZoomStyle): (frame: number) => number {
	const { zoom: mode, zoomAmount: amount, zoomPeriod: period } = style;
	if (mode === "off") return () => 1;
	const off = noZoomFrames(segments, noZoom);
	if (mode === "cuts") {
		return (f) => {
			if (off.some(([a, b]) => f >= a && f < b)) return 1;
			let piece = 0;
			for (let i = 0; i < segments.length && segments[i].from <= f; i++) piece = i;
			return piece % 2 === 1 ? amount : 1;
		};
	}
	const fade = SMOOTH_FADE * FPS;
	const ramps = zoomRamps(segments, period);
	const glide = (f: number) => {
		let piece = 0;
		for (let i = 0; i < segments.length && segments[i].from <= f; i++) piece = i;
		return Math.min(1, (f - (ramps[piece] ?? 0)) / (period * FPS));
	};
	return (f) => {
		let k = mode === "in" ? glide(f) : mode === "out" ? 1 - glide(f) : 0.5 - 0.5 * Math.cos((2 * Math.PI * f) / (period * FPS));
		for (const [a, b] of off) {
			const x = Math.min(1, Math.max(0, a - f, f - b) / fade);
			k *= x * x * (3 - 2 * x);
		}
		return 1 + (amount - 1) * k;
	};
}
