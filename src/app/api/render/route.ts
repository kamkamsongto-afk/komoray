import { getCloudflareContext } from "@opennextjs/cloudflare";
import { accessFor, JOB_TOO_OLD_MS, NO_INVITE, renderRunning } from "@/lib/access";
import { currentUser, ownsVideo } from "@/lib/supabase/server";
import { fontKeys, type OwnFont } from "@/lib/font-info";
import { logoPictureKey } from "@/lib/logo";
import { MY_FILE_ID, myFileKey } from "@/lib/my-files";
import { filesInUse } from "@/lib/media-library";
import { missingRefs, projectFileKey } from "@/lib/project-files";
import type { Faces } from "@/lib/framing";
import { allCuts, type EditCut, type Fix, fixedWords, type HandEdits } from "@/lib/edit";
import { cutThaiWords } from "@/lib/newmm";
import { type CutoutLayers, covered, cutoutWindows } from "@/lib/behind";
import type { Banner } from "@/lib/banners";
import type { FrameMe } from "@/lib/frame-me";
import type { VideoLayout } from "@/lib/layout";
import type { Window } from "@/lib/cutout";
import { FPS, keepSegments, totalFrames } from "@/lib/timeline";
import { jobFiles, PART_JOB, PART_RENDER, readRenderPart, type RenderPart, WHOLE_JOB } from "@/lib/render-part";
import { readStyle } from "@/lib/subtitle-style";
import { countRender, renderLimitReached } from "@/lib/render-limit";
import { deleteObject, exists, getJson, putObject, siblingKey, signedUrl, VIDEO_KEY } from "@/lib/r2";
import { WATERMARK } from "@/lib/watermark";
import { watermarkOn } from "@/lib/watermark-on";

// One render job lives in the video's folder:
//   render.json        written when the job starts (so we know it is in progress)
//   final.mp4          written by Modal when the video is ready
//   render-error.json  written by Modal if it failed
//   render-progress.json  { percent }, written by Modal while it works
const LINK_SECONDS = 3600;
// Part of every video's fingerprint (below). Change it whenever render.py makes the same edits look different
// (a fix or a new look): else a press that changed nothing hands back the video made before the fix.
const RENDER_REV = "2026-11-23a"; // e (22-23 Nov): subtitle lines never end on a leaning word or split a number from its unit, and "บาท" never starts one (coach 22-23 Nov); Layout zoom (meZoom) is new, old layouts unchanged. a: English lines never end on a word that leads on ("I", "the"), break at , . or a pause. b: two spaces typed = a new line; retyped English words keep their times. c: an English line ended by a pause gives a leading word ("I") to the next. d: a word half cut by hand still shows in the subtitles

async function fingerprintOf(parts: unknown) {
	const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(parts)));
	return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type RenderEnv = { RENDER_URL: string; RENDER_TOKEN: string };

// A valid video key that belongs to the signed-in user, or null.
async function readKey(key: string | null) {
	return key && VIDEO_KEY.test(key) && (await ownsVideo(key)) ? key : null;
}

// Start making the final video.
export async function POST(request: Request) {
	// part: only this stretch of the final video, seconds (Make this part, coach 14 Nov). Its job has files of its own
	// (lib/render-part.ts), so the whole video made before stays, and the admin pages only see whole videos.
	// again: Make it again anyway, after a press that changed nothing.
	const { key: rawKey, part: rawPart, again } = (await request.json()) as { key?: string; part?: unknown; again?: boolean };
	const key = await readKey(rawKey ?? null);
	if (!key) return Response.json({ error: "Unknown video" }, { status: 404 });
	const email = (await currentUser()).user?.email;
	const access = await accessFor(email);
	if (!access.allowed) return Response.json({ error: NO_INVITE }, { status: 403 });
	if (await renderRunning(key)) return Response.json({ error: "This video is already being made. Please wait for it to finish." }, { status: 409 });

	const edit = await getJson<{
		duration: number;
		cuts: EditCut[];
		words: { text: string; start: number; end: number }[];
		deleted?: number[];
		fixes?: Fix[];
		style?: unknown;
		cutout?: CutoutLayers;
		banners?: Banner[];
		frames?: FrameMe[];
		layouts?: VideoLayout[];
	} & HandEdits>(
		siblingKey(key, "edit.json"),
	);
	if (!edit) return Response.json({ error: "Find silences first" }, { status: 400 });
	const part = rawPart === undefined ? null : readRenderPart(rawPart, totalFrames(keepSegments(edit.duration, allCuts(edit))) / FPS);
	if (rawPart !== undefined && !part) return Response.json({ error: `Pick at least ${PART_RENDER.minSeconds} seconds of the video to make.` }, { status: 400 });

	// The logo picture is its own file (My files id, or an older upload's version) or the video is not made: never another
	// picture in its place, and before anything is counted or started (lib/logo.ts, coach 21 Nov: the video came out with
	// the Komoray logo). The same lookup as the preview's (logoPictureUrl).
	const logoWanted = readStyle(edit.style).logoImage;
	let logoFile: string | null = null;
	if (logoWanted) {
		const { user } = await currentUser();
		logoFile = user ? logoPictureKey(user.id, logoWanted) : null;
		if (!logoFile || !(await exists(logoFile))) {
			return Response.json({ error: "Your logo picture is missing. Please upload it again in Brand → Logo, then press Make video." }, { status: 409 });
		}
	}

	// Own fonts from My files (lib/my-files.ts): each the very file this project was given (ownFont.file), for the
	// subtitles and each banner. Kept in the projects that use them whatever the plan is now (coach 21 Nov: after a
	// downgrade they work in the projects that already have them; only new picks follow the plan). Missing = not made,
	// never another font in its place, as for the logo.
	const subtitleStyle = readStyle(edit.style);
	const ownFonts = [subtitleStyle.font === "own" ? subtitleStyle.ownFont : undefined, ...(edit.banners ?? []).map((b) => (b.font === "own" ? b.ownFont : undefined))];
	const pinnedFonts = new Map(ownFonts.flatMap((f) => (f?.file && MY_FILE_ID.test(f.file) ? [[f.file, f.family] as const] : [])));
	let fontFiles: Record<string, string> = {};
	if (pinnedFonts.size) {
		const { user } = await currentUser();
		const found = await Promise.all(
			[...pinnedFonts].map(async ([id, family]) => {
				const key = user ? myFileKey(user.id, id) : null;
				return { id, family, key, there: !!key && (await exists(key)) };
			}),
		);
		const missing = found.find((f) => !f.there);
		if (missing) return Response.json({ error: `Your font "${missing.family}" is missing. Please pick or upload it again in the font list, then press Make video.` }, { status: 409 });
		fontFiles = Object.fromEntries(found.map((f) => [f.id, f.key!]));
	}
	// Pictures and clips from My files (MY_REF) on the video: there, or the video is not made, as for the logo and fonts.
	const ownerId = (await currentUser()).user?.id ?? "";
	const usedNames = [...filesInUse({ ...edit, cutout: access.features.cutout.on ? edit.cutout : undefined })]; // Pic/Clip only goes in with Cutout on (below)
	const gone = await missingRefs(usedNames, ownerId);
	if (gone.length) return Response.json({ error: `${gone.length === 1 ? "A picture or clip" : `${gone.length} pictures or clips`} from My files on this video ${gone.length === 1 ? "is" : "are"} missing (deleted or replaced). Put another in its place, then press Make video.` }, { status: 409 });

	// The one own font from before My files, on a plan that has own fonts: there, or the video is not made (agent review
	// 21 Nov: it became Kanit without a word). On Free it is Kanit by the plan, as before (below).
	const olderFont = ownFonts.find((f) => f && !f.file);
	if (olderFont && access.perks.ownFont) {
		const { user } = await currentUser();
		if (!user || !(await exists(fontKeys(user.id).file))) {
			return Response.json({ error: `Your font "${olderFont.family}" is missing. Please pick or upload it again in the font list, then press Make video.` }, { status: 409 });
		}
	}

	// Cutout layers only go in where the speaker is cut out for them: else text behind the speaker lands
	// in front, and a picture fills the screen with no speaker (Codex review, 7 Nov). Layers saved while
	// Cutout was on for this person are left out once it is turned off on /admin.
	let layers = edit.cutout && (edit.cutout.texts.length || edit.cutout.inserts.length) ? edit.cutout : undefined;
	// A part only needs the speaker cut out where its own layers show (review 14 Nov: a part at 0:10 was refused for a
	// picture at 2:00). render.py leaves out the matte where no layer shows.
	const inPart = <T extends { start: number; end: number }>(list: T[]) => (part ? list.filter((x) => x.start < part.end && x.end > part.start) : list);
	const needed = layers && { ...layers, texts: inPart(layers.texts), inserts: inPart(layers.inserts) };
	if (layers && !access.features.cutout.on) layers = undefined;
	if (layers) {
		const done = await getJson<{ windows: Window[] }>(siblingKey(key, "cutout.json"));
		const need = cutoutWindows(needed ?? layers, keepSegments(edit.duration, allCuts(edit)));
		if (!done || !covered(need, done.windows)) {
			return Response.json({ error: "Press Cut me out in the Cutout box first: you aren't cut out yet where your text, pictures or clips show." }, { status: 409 });
		}
	}

	const files = jobFiles(part);
	const finalKey = siblingKey(key, files.out);
	const errorKey = siblingKey(key, files.error);

	// Nothing changed since the last video (or this part): hand that one back, at no cost and at once (coach 16 Nov:
	// pressing Make video over and over cost us every time). Everything that changes the picture is in here:
	// every edit, the part, whether Cutout is on and how far the speaker is cut out, the own font, render.py's rev.
	// The one own font from before My files is a paid plan's (lib/plans.ts): on Free the video is made in Kanit, as when no
	// font is uploaded. Fonts from My files are named by their content in the edit itself (pinnedFonts above).
	const ownFont = access.perks.ownFont && ownFonts.some((f) => f && !f.file);
	const fingerprint = await fingerprintOf({
		RENDER_REV,
		edit,
		part,
		cutout: layers ? await getJson(siblingKey(key, "cutout.json")) : null,
		font: ownFont ? await currentUser().then(({ user }) => (user ? getJson(fontKeys(user.id).info) : null)) : null,
		// Only when it is on (agent review, 18 Nov): always adding the key changed every saved video's fingerprint, so each
		// unchanged video would have been made again once. A Free video and the same one on a paid plan still differ.
		...(watermarkOn(access) && { watermark: WATERMARK.rev }),
	});
	const before = await getJson<{ fingerprint?: string; stoppedAt?: string }>(siblingKey(key, files.job)).catch(() => null);
	if (!again && before?.fingerprint === fingerprint && !before.stoppedAt && (await exists(finalKey))) return Response.json({ status: "done", unchanged: true });
	const limited = await renderLimitReached(email);
	if (limited) return Response.json({ error: limited }, { status: 429 });
	// Clear the previous attempt so the status check can't pick up an old result.
	const progressKey = siblingKey(key, files.progress);
	await Promise.all([deleteObject(finalKey), deleteObject(errorKey), deleteObject(progressKey)]);
	const job = { startedAt: new Date().toISOString(), fingerprint, ...(part && { part }) };
	await putObject(siblingKey(key, files.job), JSON.stringify(job), "application/json");

	// The user's own font: Modal gets a short-lived link to the file and the name to ask for.
	// A banner can have the own font too, while the subtitles don't (banner_events falls back to Kanit without it).
	const style: Record<string, unknown> = readStyle(edit.style);
	if (ownFont) {
		const { user } = await currentUser();
		const keys = user ? fontKeys(user.id) : null;
		const own = keys ? await getJson<OwnFont>(keys.info) : null;
		if (keys && own) Object.assign(style, { fontUrl: await signedUrl(keys.file, "GET", LINK_SECONDS), ownFamily: own.family });
		else if (style.font === "own" && !subtitleStyle.ownFont?.file) style.font = "kanit";
	} else if (style.font === "own" && !subtitleStyle.ownFont?.file) style.font = "kanit";
	// My files fonts: a short-lived link to each, by its id (render.py names each file by it: own_font_path).
	if (pinnedFonts.size) {
		style.fontUrls = Object.fromEntries(await Promise.all(Object.entries(fontFiles).map(async ([id, file]) => [id, await signedUrl(file, "GET", LINK_SECONDS)])));
	}

	// Uploaded banners (kind "file"): Modal gets a short-lived link to each one's file.
	const bannerNames = [...new Set((edit.banners ?? []).flatMap((b) => (b.kind === "file" && b.file ? [b.file] : [])))];
	const bannerFiles = Object.fromEntries(await Promise.all(bannerNames.map(async (name) => [name, await signedUrl(projectFileKey(key, name, ownerId), "GET", LINK_SECONDS)])));

	// Frame Me backgrounds that are a picture or clip from the project: a short-lived link to each (frame_filters in render.py).
	// Layout's other part too (layout_filters): the same list of links, by file name.
	const frameNames = [...new Set([...(edit.frames ?? []).flatMap((f) => (f.back === "file" && f.file ? [f.file] : [])), ...(edit.layouts ?? []).flatMap((l) => (l.file ? [l.file] : []))])];
	const frameFiles = Object.fromEntries(await Promise.all(frameNames.map(async (name) => [name, await signedUrl(projectFileKey(key, name, ownerId), "GET", LINK_SECONDS)])));

	// The logo picture: Modal gets a short-lived link to the very file checked above (no picture → the channel name).
	if (logoFile) style.logoUrl = await signedUrl(logoFile, "GET", LINK_SECONDS);

	// The Free plan's watermark (lib/watermark.ts, watermark_filters in render.py): our own picture's link, and the video's
	// id that picks its corners the same way the preview does.
	if (watermarkOn(access)) Object.assign(style, { watermarkUrl: new URL(WATERMARK.file, request.url).toString(), watermarkSeed: key.split("/")[1] });

	// Cutout layers (lib/behind.ts): links to the speaker's matte (once cut out) and each picture or clip.
	let cutout: (CutoutLayers & { matteUrl: string; files: Record<string, string> }) | undefined;
	if (layers) {
		const matte = await signedUrl(siblingKey(key, "matte.mp4"), "GET", LINK_SECONDS);
		const names = [...new Set(layers.inserts.map((i) => i.file))];
		const files = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await signedUrl(projectFileKey(key, name, ownerId), "GET", LINK_SECONDS)])));
		cutout = { ...layers, files, matteUrl: matte };
	}

	const env = getCloudflareContext().env as unknown as RenderEnv;
	const res = await fetch(env.RENDER_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			token: env.RENDER_TOKEN,
			// Modal just removes every cut, so hand it the deleted words and the timeline's hand cuts as cuts too,
			// and the words already fixed: it only uses them for subtitles.
			// faces: frame wide videos around the speaker, as the preview does (lib/framing.ts).
			edit: { ...edit, cuts: allCuts(edit), words: fixedWords(edit.words, edit.fixes, cutThaiWords, edit.deleted), faces: await getJson<Faces>(siblingKey(key, "faces.json")), cutout, bannerFiles, frameFiles, ...(part && { part }) },
			// How the subtitles look, from the editor (lib/subtitle-style.ts).
			style,
			// Modal only ever gets these one-file, time-limited links, never our R2 keys.
			videoUrl: await signedUrl(key, "GET", LINK_SECONDS),
			outputUrl: await signedUrl(finalKey, "PUT", LINK_SECONDS, "video/mp4"),
			errorUrl: await signedUrl(errorKey, "PUT", LINK_SECONDS, "application/json"),
			progressUrl: await signedUrl(progressKey, "PUT", LINK_SECONDS, "application/json"),
		}),
	});
	const data = (await res.json().catch(() => ({}))) as { callId?: string; error?: string };
	if (!res.ok || !data.callId) {
		const error = data.error ?? `Could not start the render (${res.status})`;
		await putObject(errorKey, JSON.stringify({ error, at: new Date().toISOString() }), "application/json");
		return Response.json({ error }, { status: 502 });
	}
	// Its Modal job, so Stop can end it (DELETE). Written again: the status check only reads startedAt and part.
	await putObject(siblingKey(key, files.job), JSON.stringify({ ...job, callId: data.callId }), "application/json");
	// A part counts as its share of the video. Never stops the video it is counting: a hiccup here only misses one.
	const total = totalFrames(keepSegments(edit.duration, allCuts(edit))) / FPS;
	await countRender(email, part && total ? (part.end - part.start) / total : 1).catch(() => null);
	return Response.json({ status: "processing" });
}

const STOPPED = "Stopped. Your edits are all here: press Make video when you're ready.";

// Stop making it (coach 15 Nov: Make video pressed by mistake). Closing the page never stopped it: Modal went on,
// and we paid for it. The job file says it was stopped, so the status check believes that even if Modal's own
// error report lands after ours.
export async function DELETE(request: Request) {
	const params = new URL(request.url).searchParams;
	const key = await readKey(params.get("key"));
	if (!key) return Response.json({ error: "Unknown video" }, { status: 404 });
	const files = params.get("part") ? PART_JOB : WHOLE_JOB;
	const jobKey = siblingKey(key, files.job);
	const job = await getJson<{ startedAt?: string; callId?: string; stoppedAt?: string }>(jobKey);
	if (!job?.startedAt || job.stoppedAt || (await exists(siblingKey(key, files.out)))) return Response.json({ status: "not running" });
	await putObject(jobKey, JSON.stringify({ ...job, stoppedAt: new Date().toISOString() }), "application/json");
	await putObject(siblingKey(key, files.error), JSON.stringify({ error: STOPPED, stopped: true, at: new Date().toISOString() }), "application/json");
	if (job.callId) {
		const env = getCloudflareContext().env as unknown as RenderEnv;
		// Best effort: if Modal can't be told, the job ends by itself and its video is simply not shown.
		await fetch(env.RENDER_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ token: env.RENDER_TOKEN, kind: "cancel", callId: job.callId }),
		}).catch(() => null);
	}
	return Response.json({ status: "stopped" });
}

// Where is the job at? The page asks this every few seconds.
export async function GET(request: Request) {
	const key = await readKey(new URL(request.url).searchParams.get("key"));
	if (!key) return Response.json({ error: "Unknown video" }, { status: 404 });

	// The newer of the whole video's job and a part's job is the one shown (each has its own files, lib/render-part.ts).
	// With a part shown, the whole video made before comes too (review 14 Nov: after a part, it could not be opened).
	const [whole, partJob] = await Promise.all([
		getJson<{ startedAt?: string; stoppedAt?: string }>(siblingKey(key, WHOLE_JOB.job)).catch(() => null),
		getJson<{ startedAt?: string; stoppedAt?: string; part?: unknown }>(siblingKey(key, PART_JOB.job)).catch(() => null),
	]);
	const part: RenderPart | null = partJob && (partJob.startedAt ?? "") > (whole?.startedAt ?? "") ? readRenderPart(partJob.part, Infinity) : null;
	const files = jobFiles(part);
	const finalKey = siblingKey(key, files.out);
	const wholeKey = siblingKey(key, WHOLE_JOB.out);
	const wholeLinks = async () =>
		part && (await exists(wholeKey))
			? { wholeUrl: await signedUrl(wholeKey, "GET", LINK_SECONDS), wholeDownloadUrl: await signedUrl(wholeKey, "GET", LINK_SECONDS, undefined, "komoray-video.mp4") }
			: {};
	if (await exists(finalKey)) {
		return Response.json({
			status: "done",
			videoUrl: await signedUrl(finalKey, "GET", LINK_SECONDS),
			downloadUrl: await signedUrl(finalKey, "GET", LINK_SECONDS, undefined, part ? "komoray-part.mp4" : "komoray-video.mp4"),
			...(part && { part }),
			...(await wholeLinks()),
		});
	}

	const job = part ? partJob : whole;
	if (job?.stoppedAt) return Response.json({ status: "failed", stopped: true, error: STOPPED, ...(part && { part }), ...(await wholeLinks()) });
	const failure = await getJson<{ error?: string }>(siblingKey(key, files.error));
	if (failure) return Response.json({ status: "failed", error: failure.error ?? "Render failed", ...(part && { part }), ...(await wholeLinks()) });

	if (!job?.startedAt) return Response.json({ status: "none" });
	// Older than any job runs (Modal stops it at 30 min) and nothing came back: it died without saying so, and the
	// page waited forever with Make video locked (coach, 14 Nov: stuck at 96%). Say so, so it can be made again.
	if (Date.now() - new Date(job.startedAt).getTime() > JOB_TOO_OLD_MS)
		return Response.json({ status: "failed", error: "This stopped before it finished. Please press Make video again.", ...(part && { part }), ...(await wholeLinks()) });
	// Only a number shown on the page: a problem reading it must never look like a failed video.
	const progress = await getJson<{ percent?: number }>(siblingKey(key, files.progress)).catch(() => null);
	return Response.json({ status: "processing", percent: progress?.percent, ...(part && { part }) });
}
