import { type Banner, readBanners } from "@/lib/banners";
import { type CutoutLayers, readCutout } from "@/lib/behind";
import { type FrameMe, readFrames } from "@/lib/frame-me";
import { readLayouts, type VideoLayout } from "@/lib/layout";
import { type Cut, findSilences, type Pace, readPace } from "@/lib/silences";
import type { Word } from "@/lib/transcribe";
import { ownsVideo } from "@/lib/supabase/server";
import { type Fix, readFixes, readSpans } from "@/lib/edit";
import { getJson, putObject, siblingKey, VIDEO_KEY } from "@/lib/r2";
import { readStyle } from "@/lib/subtitle-style";
import { readZoomParts, type ZoomPart } from "@/lib/zoom";

// Save the user's edits from the editor into edit.json, next to the silences:
//   deleted  word positions deleted in the script (Make video cuts them)
//   fixes    words retyped in the script (subtitles read the fixed text)
//   style    subtitle size / outline / position
//   banners  price tags, calls to action, "follow me" (lib/banners.ts)
//   manual   parts cut by hand on the timeline (source seconds)
//   keep     silences kept by hand on the timeline
//   noZoom   parts with Auto zoom turned off on the timeline
//   zoomParts  parts with their own kind of zoom (picked on the timeline, or the AI's key moments)
//   zoomMomentsApplied  the AI's key moments were put in once, as Auto zoom asks when uploading
//   cutout   text behind the speaker, pictures and clips behind a smaller speaker (lib/behind.ts)
//   frames   Frame Me: the speaker inside a shape over a background, for a stretch of the video (lib/frame-me.ts)
//   layouts  Layout: the screen split, the speaker in one part and a picture or clip in the other (lib/layout.ts)
//   pace    tight / natural / relaxed: finds the silences again (answers with the new cuts)
//   badTakesApplied  the AI's bad takes were cut once, as asked when uploading (never again by themselves)
//   spellingApplied  the AI's spelling fixes were put on once (api/spelling)
// Any of them can be sent on its own.
export async function PUT(request: Request) {
	const { key, deleted, fixes, dictionaryApplied, takesApplied, badTakesApplied, spellingApplied, style, banners, pace, manual, keep, noZoom, zoomParts, zoomMomentsApplied, cutout, frames, layouts } = (await request.json()) as {
		key?: string;
		pace?: unknown;
		deleted?: unknown;
		fixes?: unknown;
		dictionaryApplied?: unknown;
		takesApplied?: unknown;
		badTakesApplied?: unknown;
		spellingApplied?: unknown;
		style?: unknown;
		banners?: unknown;
		manual?: unknown;
		keep?: unknown;
		noZoom?: unknown;
		zoomParts?: unknown;
		zoomMomentsApplied?: unknown;
		cutout?: unknown;
		frames?: unknown;
		layouts?: unknown;
	};
	if (!key || !VIDEO_KEY.test(key) || !(await ownsVideo(key))) return Response.json({ error: "Unknown video" }, { status: 404 });

	const editKey = siblingKey(key, "edit.json");
	const edit = await getJson<{
		duration: number;
		words: Word[];
		cuts: Cut[];
		pace?: Pace;
		deleted?: number[];
		fixes?: Fix[];
		dictionaryApplied?: boolean;
		takesApplied?: boolean;
		badTakesApplied?: boolean;
		spellingApplied?: boolean;
		style?: unknown;
		banners?: Banner[];
		manual?: { start: number; end: number }[];
		keep?: { start: number; end: number }[];
		noZoom?: { start: number; end: number }[];
		zoomParts?: ZoomPart[];
		zoomMomentsApplied?: boolean;
		cutout?: CutoutLayers;
		frames?: FrameMe[];
		layouts?: VideoLayout[];
	}>(editKey);
	if (!edit) return Response.json({ error: "Find silences first" }, { status: 400 });

	if (deleted !== undefined) {
		const count = edit.words.length;
		if (!Array.isArray(deleted) || !deleted.every((i) => Number.isInteger(i) && i >= 0 && i < count)) {
			return Response.json({ error: "Bad word list" }, { status: 400 });
		}
		edit.deleted = [...new Set(deleted as number[])].sort((a, b) => a - b);
	}
	if (fixes !== undefined) {
		const checked = readFixes(fixes, edit.words.length);
		if (!checked) return Response.json({ error: "Bad word fixes" }, { status: 400 });
		edit.fixes = checked;
	}
	for (const [name, value] of [
		["manual", manual],
		["keep", keep],
		["noZoom", noZoom],
	] as const) {
		if (value === undefined) continue;
		const checked = readSpans(value, edit.duration);
		if (!checked) return Response.json({ error: "Bad timeline cuts" }, { status: 400 });
		edit[name] = checked;
	}
	if (dictionaryApplied === true) edit.dictionaryApplied = true;
	if (takesApplied === true) edit.takesApplied = true;
	if (badTakesApplied === true) edit.badTakesApplied = true;
	if (spellingApplied === true) edit.spellingApplied = true;
	if (zoomMomentsApplied === true) edit.zoomMomentsApplied = true;
	if (zoomParts !== undefined) {
		const checked = readZoomParts(zoomParts, edit.duration);
		if (!checked) return Response.json({ error: "Bad zoom parts" }, { status: 400 });
		edit.zoomParts = checked;
	}
	if (style !== undefined) edit.style = readStyle(style);
	if (banners !== undefined) {
		const checked = readBanners(banners);
		if (!checked) return Response.json({ error: "Bad banners" }, { status: 400 });
		edit.banners = checked;
	}
	if (cutout !== undefined) {
		const checked = readCutout(cutout);
		if (!checked) return Response.json({ error: "Bad cutout layers" }, { status: 400 });
		edit.cutout = checked;
	}
	if (frames !== undefined) {
		const checked = readFrames(frames);
		if (!checked) return Response.json({ error: "Bad Frame Me" }, { status: 400 });
		edit.frames = checked;
	}
	if (layouts !== undefined) {
		const checked = readLayouts(layouts);
		if (!checked) return Response.json({ error: "Bad layouts" }, { status: 400 });
		edit.layouts = checked;
	}

	// A new pace: the silences are found again in the words we already have (no new transcript).
	if (pace !== undefined) {
		const checked = readPace(pace);
		if (!checked) return Response.json({ error: "Bad pace" }, { status: 400 });
		edit.pace = checked;
		edit.cuts = findSilences({ duration: edit.duration, words: edit.words }, checked);
	}

	await putObject(editKey, JSON.stringify(edit, null, 2), "application/json");
	return Response.json({ ok: true, cuts: edit.cuts });
}
