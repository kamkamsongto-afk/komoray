// Cutout: the speaker cut out of the background, for parts of the video (windows, in seconds of the
// original video). Made on a GPU by modal_app/cutout.py; the files sit next to the video in R2:
//   cutout-job.json     { startedAt, windows, runs }   asked for (by /api/cutout)
//   cutout.json         { windows, frames, modelSeconds, ... }   done: matte.mp4 and proxy-cutout.mp4 are there
//   cutout-error.json   { error }   it failed
//   matte.mp4           the matte (white = person) for the whole video, 30 fps, for the final render
//   proxy-cutout.mp4    the editor's preview copy: picture on top, matte below
// How many seconds one video may have cut out is per person (lib/features.ts).

export type Window = [number, number];

export const CUTOUT_RUNS_PER_VIDEO = 5; // each run is paid GPU time; the admin has no limit
export const CUTOUT_TOO_OLD_MS = 30 * 60 * 1000; // a run still going after this has died

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
	return joined.slice(0, 20);
}

export const windowSeconds = (wins: Window[]) => Math.round(wins.reduce((sum, [a, b]) => sum + (b - a), 0) * 10) / 10;
