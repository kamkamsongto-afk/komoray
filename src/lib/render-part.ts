// Make this part (coach, 14 Nov): Make video for only a stretch of the final video, to check it quickly.
// A part job has files of its own next to the video, apart from the whole video's: so the whole video made before
// (final.mp4) stays and can still be watched, and the admin pages, which read the whole video's files (render.json,
// final.mp4, render-error.json), never see a part (review 14 Nov: a failed part showed there as a failed video).
// render.py makes a part from the same pieces as the whole video, so it looks exactly like that stretch of it.

export type RenderPart = { start: number; end: number }; // seconds of the final video

export const PART_RENDER = { minSeconds: 1 };

// The files of a job: the record written when it starts, the video, its error and its progress.
export type JobFiles = { job: string; out: string; error: string; progress: string };
export const WHOLE_JOB: JobFiles = { job: "render.json", out: "final.mp4", error: "render-error.json", progress: "render-progress.json" };
export const PART_JOB: JobFiles = { job: "part.json", out: "part.mp4", error: "part-error.json", progress: "part-progress.json" };
export const jobFiles = (part: RenderPart | null | undefined) => (part ? PART_JOB : WHOLE_JOB);

// A part as the browser sent it (or as part.json has it), inside a final video of `total` seconds; null if it isn't one.
export function readRenderPart(value: unknown, total: number): RenderPart | null {
	if (!value || typeof value !== "object") return null;
	const raw = value as { start?: unknown; end?: unknown };
	const start = Math.max(0, Number(raw.start));
	const end = Math.min(total, Number(raw.end));
	if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < PART_RENDER.minSeconds) return null;
	return { start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000 };
}
