// How close the picture is at every frame of the final video (Auto zoom).
//   "cuts"    every other kept piece a little closer: a jump at the cut, like a second camera
//   "smooth"  the picture glides slowly in and back out, across the cuts
// noZoom: parts the user turned zoom off for (source seconds, so they survive new cuts).
// Same sums as no_zoom_frames, zoom_shots and smooth_zoom_expr in render.py: change one, change the other.
import { FPS, type Segment } from "./timeline";

type Span = { start: number; end: number };

export const ZOOM = 1.12; // the closest it gets
export const SMOOTH_PERIOD = 12; // seconds to glide in and back out
export const SMOOTH_FADE = 0.75; // seconds to glide out before (and back in after) a part with no zoom

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

// The zoom at a frame of the final video (1 = none).
export function zoomTrack(segments: Segment[], noZoom: Span[], mode: string): (frame: number) => number {
	if (mode !== "cuts" && mode !== "smooth") return () => 1;
	const off = noZoomFrames(segments, noZoom);
	if (mode === "cuts") {
		return (f) => {
			if (off.some(([a, b]) => f >= a && f < b)) return 1;
			let piece = 0;
			for (let i = 0; i < segments.length && segments[i].from <= f; i++) piece = i;
			return piece % 2 === 1 ? ZOOM : 1;
		};
	}
	const fade = SMOOTH_FADE * FPS;
	return (f) => {
		let k = 0.5 - 0.5 * Math.cos((2 * Math.PI * f) / (SMOOTH_PERIOD * FPS));
		for (const [a, b] of off) {
			const x = Math.min(1, Math.max(0, a - f, f - b) / fade);
			k *= x * x * (3 - 2 * x);
		}
		return 1 + (ZOOM - 1) * k;
	};
}
