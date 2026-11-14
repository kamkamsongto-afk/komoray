// Make this part (coach, 14 Nov): Make video for only a stretch of the final video, to check it quickly. The job
// (api/render) keeps it in part.mp4, so the whole video made before (final.mp4) stays, and the admin pages, which
// count final.mp4 as a made video, don't count a part. render.json says which one the last job made ({ part }).
// render.py makes it from the same pieces as the whole video, so it looks exactly like that stretch of it.

export type RenderPart = { start: number; end: number }; // seconds of the final video

export const PART_RENDER = { file: "part.mp4", minSeconds: 1 };

// The file a job writes: part.mp4 for a part, final.mp4 for the whole video.
export const renderOutput = (part: RenderPart | null | undefined) => (part ? PART_RENDER.file : "final.mp4");

// A part as the browser sent it (or as render.json has it), inside a final video of `total` seconds; null if it isn't one.
export function readRenderPart(value: unknown, total: number): RenderPart | null {
	if (!value || typeof value !== "object") return null;
	const raw = value as { start?: unknown; end?: unknown };
	const start = Math.max(0, Number(raw.start));
	const end = Math.min(total, Number(raw.end));
	if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < PART_RENDER.minSeconds) return null;
	return { start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000 };
}
