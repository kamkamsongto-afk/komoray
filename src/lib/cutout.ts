// Cutout: the speaker cut out of the background, for parts of the video (windows, in seconds of the
// original video). Made on a GPU by modal_app/cutout.py; the files sit next to the video in R2:
//   cutout-job.json     { startedAt, windows, runs }   asked for (by /api/cutout)
//   cutout.json         { windows, frames, modelSeconds, ... }   done: matte.mp4 and proxy-cutout.mp4 are there
//   cutout-error.json   { error }   it failed
//   matte.mp4           the matte (white = person) for the whole video, 30 fps, for the final render
//   proxy-cutout.mp4    the editor's preview copy: picture on top, matte below
//   matte-local.h264    Fast and Balanced: the matte the customer's computer made (lib/cutout-local.ts)
//   matte-<q>.mp4, proxy-<q>.mp4, cutout-<q>.json    a cutout kept when another quality replaces it (savedFiles)
// Best is paid GPU time, so its seconds per month are per person (lib/features.ts, lib/access.ts).
// Fast and Balanced run on the customer's own computer: they take none of those seconds.

export type Window = [number, number];
export type CutoutTier = "fast" | "balanced" | "best";

export const CUTOUT_RUNS_PER_VIDEO = 5; // each Best run is paid GPU time; the admin has no limit
export const LOCAL_RUNS_PER_VIDEO = 30; // Fast and Balanced cost a moment of server time each to finish
export const LOCAL_MATTE = "matte-local.h264";
export const LOCAL_MATTE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
// Every quality made for a video stays until the video is deleted, so people can switch back and forth to
// compare without waiting or paying again (coach, 10 Nov). About 40 MB a minute of video for all three.
export const CUTOUT_TIERS: CutoutTier[] = ["fast", "balanced", "best"];
export function savedFiles(tier: CutoutTier) {
	const name = tier === "best" ? "slow" : tier;
	return { matte: `matte-${name}.mp4`, preview: `proxy-${name}.mp4`, done: `cutout-${name}.json` };
}
export const CUTOUT_TOO_OLD_MS = 95 * 60 * 1000; // a Best run still going after this has died (GPUs can queue a long time)
export const LOCAL_TOO_OLD_MS = 15 * 60 * 1000; // a page that asked to upload its matte and never finished

const MAX_WINDOWS = 400; // the whole kept video can be many short parts

// The windows asked for, cleaned: inside the video, at least half a second, a tenth of a second
// precise, sorted, overlapping ones joined.
export function cleanWindows(raw: unknown, duration: number): Window[] {
	if (!Array.isArray(raw)) return [];
	const tenth = (n: number) => Math.round(n * 10) / 10;
	const wins = raw
		.map((w) => (Array.isArray(w) ? [Number(w[0]), Number(w[1])] : [NaN, NaN]))
		.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b))
		.map(([a, b]): Window => [tenth(Math.max(0, a)), tenth(Math.min(duration, b))])
		.filter(([a, b]) => b - a >= 0.5)
		.sort((x, y) => x[0] - y[0]);
	const joined: Window[] = [];
	for (const w of wins) {
		const last = joined.at(-1);
		if (last && w[0] <= last[1]) last[1] = Math.max(last[1], w[1]);
		else joined.push([...w]);
	}
	return joined.slice(0, MAX_WINDOWS);
}

// How many seconds of these windows aren't in the ones already cut out: all that Best has to pay for.
export function newSeconds(wins: Window[], before: Window[]) {
	let seconds = 0;
	for (const [a, b] of wins) {
		let at = a;
		for (const [x, y] of before) {
			if (y <= at || x >= b) continue;
			if (x > at) seconds += x - at;
			at = Math.max(at, y);
		}
		if (at < b) seconds += b - at;
	}
	return Math.round(seconds * 10) / 10;
}

export const windowSeconds = (wins: Window[]) => Math.round(wins.reduce((sum, [a, b]) => sum + (b - a), 0) * 10) / 10;

export function clock(seconds: number) {
	const whole = Math.ceil(Math.max(0, seconds));
	return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

// Roughly how long Slow (tier "best") takes, for the countdown: the GPU reports no progress, so this is an
// estimate. Machine start + 4.5 s of model time per second of video (measured 9 Nov: 0.144 s a frame at 30 fps),
// shared like split_parts in modal_app/cutout.py (PART_SECONDS, MAX_PARTS) + putting the files together.
export function slowSeconds(wins: Window[]) {
	const seconds = windowSeconds(wins);
	const machines = Math.min(4, Math.max(1, Math.ceil(seconds / 45)));
	return 180 + (4.5 * seconds) / machines + 30;
}
