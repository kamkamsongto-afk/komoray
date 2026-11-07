import { getCloudflareContext } from "@opennextjs/cloudflare";
import { accessFor } from "@/lib/access";
import type { CutoutLayers } from "@/lib/behind";
import { cleanWindows, CUTOUT_RUNS_PER_VIDEO, CUTOUT_TOO_OLD_MS, type Window, windowSeconds } from "@/lib/cutout";
import { mediaUrl } from "@/lib/proxy";
import { deleteObject, getJson, putObject, siblingKey, signedUrl, VIDEO_KEY } from "@/lib/r2";
import { currentUser, ownsVideo } from "@/lib/supabase/server";

// Cut the speaker out of the background for some windows of a video (lib/cutout.ts), on Modal's GPU.
//   POST { key, windows: [[start, end], ...] }   start (only people with Cutout on, see /admin)
//   GET  ?key=…   { status: none | processing | done | failed, windows, previewUrl?, error?, files }
//                 files: a link to each picture or clip the video's layers show (lib/behind.ts)
const LINK_SECONDS = 3600;

type CutoutEnv = { CUTOUT_URL: string; RENDER_TOKEN: string };
type Job = { startedAt: string; windows: Window[]; runs: number };

async function readKey(key: unknown) {
	return typeof key === "string" && VIDEO_KEY.test(key) && (await ownsVideo(key)) ? key : null;
}

async function status(key: string) {
	const [job, done, failure] = await Promise.all([
		getJson<Job>(siblingKey(key, "cutout-job.json")),
		getJson<{ windows: Window[] }>(siblingKey(key, "cutout.json")),
		getJson<{ error?: string }>(siblingKey(key, "cutout-error.json")),
	]);
	if (done) return { status: "done" as const, windows: done.windows, runs: job?.runs ?? 1 };
	if (failure) return { status: "failed" as const, windows: job?.windows ?? [], runs: job?.runs ?? 1, error: failure.error ?? "The cutout failed" };
	if (job && Date.now() - new Date(job.startedAt).getTime() < CUTOUT_TOO_OLD_MS) return { status: "processing" as const, windows: job.windows, runs: job.runs };
	if (job) return { status: "failed" as const, windows: job.windows, runs: job.runs, error: "This took too long and stopped. Please try again." };
	return { status: "none" as const, windows: [] as Window[], runs: 0 };
}

export async function GET(request: Request) {
	const key = await readKey(new URL(request.url).searchParams.get("key"));
	if (!key) return Response.json({ error: "Unknown video" }, { status: 404 });
	const [now, edit] = await Promise.all([status(key), getJson<{ cutout?: CutoutLayers }>(siblingKey(key, "edit.json"))]);
	const names = [...new Set((edit?.cutout?.inserts ?? []).map((i) => i.file))];
	const files = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await signedUrl(siblingKey(key, name), "GET", LINK_SECONDS)])));
	if (now.status !== "done") return Response.json({ ...now, files });
	const env = getCloudflareContext().env as unknown as CutoutEnv;
	return Response.json({ ...now, files, previewUrl: await mediaUrl(key, "proxy-cutout.mp4", env.RENDER_TOKEN) });
}

export async function POST(request: Request) {
	const body = (await request.json().catch(() => ({}))) as { key?: unknown; windows?: unknown };
	const key = await readKey(body.key);
	if (!key) return Response.json({ error: "Unknown video" }, { status: 404 });

	// Checked here, not just by hiding the button: this is paid GPU time.
	const { user } = await currentUser();
	const access = await accessFor(user?.email);
	if (!access.allowed || !access.features.cutout.on) return Response.json({ error: "Cutout isn't turned on for your account yet." }, { status: 403 });

	const edit = await getJson<{ duration: number }>(siblingKey(key, "edit.json"));
	if (!edit?.duration) return Response.json({ error: "Please wait until the script is ready." }, { status: 400 });
	const windows = cleanWindows(body.windows, edit.duration);
	if (windows.length === 0) return Response.json({ error: "Pick at least half a second to cut out." }, { status: 400 });
	const limit = access.features.cutout.seconds;
	if (windowSeconds(windows) > limit + 0.05) {
		return Response.json({ error: `You can cut out up to ${limit} seconds of each video. You picked ${windowSeconds(windows)} seconds.` }, { status: 400 });
	}

	const now = await status(key);
	if (now.status === "processing") return Response.json({ error: "The cutout is still being made. Please wait for it to finish." }, { status: 409 });
	if (!access.unlimited && now.runs >= CUTOUT_RUNS_PER_VIDEO) {
		return Response.json({ error: `This video has been cut out ${CUTOUT_RUNS_PER_VIDEO} times. Please email hello@komoray.com for more.` }, { status: 429 });
	}

	const files = { done: siblingKey(key, "cutout.json"), error: siblingKey(key, "cutout-error.json"), job: siblingKey(key, "cutout-job.json") };
	await Promise.all([deleteObject(files.done), deleteObject(files.error)]);
	await putObject(files.job, JSON.stringify({ startedAt: new Date().toISOString(), windows, runs: now.runs + 1 } satisfies Job), "application/json");

	const env = getCloudflareContext().env as unknown as CutoutEnv;
	const res = await fetch(env.CUTOUT_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			token: env.RENDER_TOKEN,
			windows,
			videoUrl: await signedUrl(key, "GET", LINK_SECONDS),
			matteUrl: await signedUrl(siblingKey(key, "matte.mp4"), "PUT", LINK_SECONDS, "video/mp4"),
			previewUrl: await signedUrl(siblingKey(key, "proxy-cutout.mp4"), "PUT", LINK_SECONDS, "video/mp4"),
			doneUrl: await signedUrl(files.done, "PUT", LINK_SECONDS, "application/json"),
			errorUrl: await signedUrl(files.error, "PUT", LINK_SECONDS, "application/json"),
		}),
	}).catch(() => null);
	const data = (await res?.json().catch(() => ({}))) as { callId?: string; error?: string } | undefined;
	if (!res?.ok || !data?.callId) {
		const error = data?.error ?? `Could not start the cutout (${res?.status ?? "no answer"})`;
		await putObject(files.error, JSON.stringify({ error, at: new Date().toISOString() }), "application/json");
		return Response.json({ error }, { status: 502 });
	}
	return Response.json({ status: "processing", windows });
}

