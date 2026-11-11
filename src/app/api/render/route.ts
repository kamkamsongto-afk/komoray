import { getCloudflareContext } from "@opennextjs/cloudflare";
import { accessFor, canUseStudio, NO_INVITE, renderRunning } from "@/lib/access";
import { currentUser, ownsVideo } from "@/lib/supabase/server";
import { fontKeys, type OwnFont } from "@/lib/font-info";
import { logoKey } from "@/lib/logo";
import type { Faces } from "@/lib/framing";
import { allCuts, type EditCut, type Fix, fixedWords, type HandEdits } from "@/lib/edit";
import { type CutoutLayers, covered, cutoutWindows } from "@/lib/behind";
import type { Banner } from "@/lib/banners";
import type { Window } from "@/lib/cutout";
import { keepSegments } from "@/lib/timeline";
import { readStyle } from "@/lib/subtitle-style";
import { deleteObject, exists, getJson, putObject, siblingKey, signedUrl, VIDEO_KEY } from "@/lib/r2";

// One render job lives in the video's folder:
//   render.json        written when the job starts (so we know it is in progress)
//   final.mp4          written by Modal when the video is ready
//   render-error.json  written by Modal if it failed
//   render-progress.json  { percent }, written by Modal while it works
const LINK_SECONDS = 3600;

type RenderEnv = { RENDER_URL: string; RENDER_TOKEN: string };

// A valid video key that belongs to the signed-in user, or null.
async function readKey(key: string | null) {
	return key && VIDEO_KEY.test(key) && (await ownsVideo(key)) ? key : null;
}

// Start making the final video.
export async function POST(request: Request) {
	const { key: rawKey } = (await request.json()) as { key?: string };
	const key = await readKey(rawKey ?? null);
	if (!key) return Response.json({ error: "Unknown video" }, { status: 404 });
	if (!(await canUseStudio((await currentUser()).user?.email))) return Response.json({ error: NO_INVITE }, { status: 403 });
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
	} & HandEdits>(
		siblingKey(key, "edit.json"),
	);
	if (!edit) return Response.json({ error: "Find silences first" }, { status: 400 });

	// Cutout layers only go in where the speaker is cut out for them: else text behind the speaker lands
	// in front, and a picture fills the screen with no speaker (Codex review, 7 Nov). Layers saved while
	// Cutout was on for this person are left out once it is turned off on /admin.
	let layers = edit.cutout && (edit.cutout.texts.length || edit.cutout.inserts.length) ? edit.cutout : undefined;
	if (layers && !(await accessFor((await currentUser()).user?.email)).features.cutout.on) layers = undefined;
	if (layers) {
		const done = await getJson<{ windows: Window[] }>(siblingKey(key, "cutout.json"));
		const need = cutoutWindows(layers, keepSegments(edit.duration, allCuts(edit)));
		if (!done || !covered(need, done.windows)) {
			return Response.json({ error: "Press Cut me out in the Cutout box first: you aren't cut out yet where your text, pictures or clips show." }, { status: 409 });
		}
	}

	const finalKey = siblingKey(key, "final.mp4");
	const errorKey = siblingKey(key, "render-error.json");
	// Clear the previous attempt so the status check can't pick up an old result.
	const progressKey = siblingKey(key, "render-progress.json");
	await Promise.all([deleteObject(finalKey), deleteObject(errorKey), deleteObject(progressKey)]);
	await putObject(siblingKey(key, "render.json"), JSON.stringify({ startedAt: new Date().toISOString() }), "application/json");

	// The user's own font: Modal gets a short-lived link to the file and the name to ask for.
	// A banner can have the own font too, while the subtitles don't (banner_events falls back to Kanit without it).
	const style: Record<string, unknown> = readStyle(edit.style);
	if (style.font === "own" || edit.banners?.some((b) => b.font === "own")) {
		const { user } = await currentUser();
		const keys = user ? fontKeys(user.id) : null;
		const own = keys ? await getJson<OwnFont>(keys.info) : null;
		if (keys && own) Object.assign(style, { fontUrl: await signedUrl(keys.file, "GET", LINK_SECONDS), ownFamily: own.family });
		else if (style.font === "own") style.font = "kanit";
	}

	// Uploaded banners (kind "file"): Modal gets a short-lived link to each one's file.
	const bannerNames = [...new Set((edit.banners ?? []).flatMap((b) => (b.kind === "file" && b.file ? [b.file] : [])))];
	const bannerFiles = Object.fromEntries(await Promise.all(bannerNames.map(async (name) => [name, await signedUrl(siblingKey(key, name), "GET", LINK_SECONDS)])));

	// The logo picture: Modal gets a short-lived link to it (no picture saved → the channel name instead).
	if (style.logoImage) {
		const { user } = await currentUser();
		if (user && (await exists(logoKey(user.id)))) style.logoUrl = await signedUrl(logoKey(user.id), "GET", LINK_SECONDS);
	}

	// Cutout layers (lib/behind.ts): links to the speaker's matte (once cut out) and each picture or clip.
	let cutout: (CutoutLayers & { matteUrl: string; files: Record<string, string> }) | undefined;
	if (layers) {
		const matte = await signedUrl(siblingKey(key, "matte.mp4"), "GET", LINK_SECONDS);
		const names = [...new Set(layers.inserts.map((i) => i.file))];
		const files = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await signedUrl(siblingKey(key, name), "GET", LINK_SECONDS)])));
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
			edit: { ...edit, cuts: allCuts(edit), words: fixedWords(edit.words, edit.fixes), faces: await getJson<Faces>(siblingKey(key, "faces.json")), cutout, bannerFiles },
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
	return Response.json({ status: "processing" });
}

// Where is the job at? The page asks this every few seconds.
export async function GET(request: Request) {
	const key = await readKey(new URL(request.url).searchParams.get("key"));
	if (!key) return Response.json({ error: "Unknown video" }, { status: 404 });

	const finalKey = siblingKey(key, "final.mp4");
	if (await exists(finalKey)) {
		return Response.json({
			status: "done",
			videoUrl: await signedUrl(finalKey, "GET", LINK_SECONDS),
			downloadUrl: await signedUrl(finalKey, "GET", LINK_SECONDS, undefined, "komoray-video.mp4"),
		});
	}

	const failure = await getJson<{ error?: string }>(siblingKey(key, "render-error.json"));
	if (failure) return Response.json({ status: "failed", error: failure.error ?? "Render failed" });

	const started = await exists(siblingKey(key, "render.json"));
	if (!started) return Response.json({ status: "none" });
	// Only a number shown on the page: a problem reading it must never look like a failed video.
	const progress = await getJson<{ percent?: number }>(siblingKey(key, "render-progress.json")).catch(() => null);
	return Response.json({ status: "processing", percent: progress?.percent });
}
