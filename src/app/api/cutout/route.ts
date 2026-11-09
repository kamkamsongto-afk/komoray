import { getCloudflareContext } from "@opennextjs/cloudflare";
import { accessFor, bestSecondsUsed, chargeBest, lockBest, refundBest } from "@/lib/access";
import type { CutoutLayers } from "@/lib/behind";
import { cleanWindows, CUTOUT_RUNS_PER_VIDEO, CUTOUT_TOO_OLD_MS, type CutoutTier, LOCAL_MATTE, LOCAL_TOO_OLD_MS, LOCAL_RUNS_PER_VIDEO, newSeconds, type Window } from "@/lib/cutout";
import { mediaUrl } from "@/lib/proxy";
import { deleteObject, exists, getJson, putObject, siblingKey, signedUrl, VIDEO_KEY } from "@/lib/r2";
import { currentUser, ownsVideo } from "@/lib/supabase/server";

// Cut the speaker out of the background for some windows of a video (lib/cutout.ts).
//   POST { key, windows: [[start, end], ...], tier }   only people with Cutout on, see /admin
//        Best starts on Modal's GPU. Fast and Balanced were already made on the customer's computer:
//        this answers with where to upload the matte, then /api/cutout/finish takes over.
//   GET  ?key=…   { status: none | processing | done | failed, windows, tier, version, previewUrl?, error?, files, best }
//                 files: a link to each picture or clip the video's layers show (lib/behind.ts)
//                 best: how many seconds of Best this person has left this month
const LINK_SECONDS = 3600;
const PREVIEW_LINK_SECONDS = 3 * 3600; // the player keeps the link it started with for as long as the page is open (ScriptView)

type CutoutEnv = { CUTOUT_URL: string; RENDER_TOKEN: string };
type Done = { windows: Window[]; at?: string; tier?: CutoutTier };
// local: Fast or Balanced. usageKey and charged: what a failed Best gives back; settled: it did.
type Job = { startedAt: string; windows: Window[]; runs: number; localRuns?: number; local?: CutoutTier; usageKey?: string; charged?: number; settled?: boolean };

async function readKey(key: unknown) {
	return typeof key === "string" && VIDEO_KEY.test(key) && (await ownsVideo(key)) ? key : null;
}

const isTier = (tier: unknown): tier is CutoutTier => tier === "fast" || tier === "balanced" || tier === "best";

async function status(key: string) {
	const jobKey = siblingKey(key, "cutout-job.json");
	const [job, done, failure] = await Promise.all([getJson<Job>(jobKey), getJson<Done>(siblingKey(key, "cutout.json")), getJson<{ error?: string }>(siblingKey(key, "cutout-error.json"))]);
	const runs = job?.runs ?? (done ? 1 : 0);
	const localRuns = job?.localRuns ?? 0;
	if (done) return { status: "done" as const, windows: done.windows, runs, localRuns, tier: done.tier ?? ("best" as const), version: done.at ?? "1" };
	const running = job && Date.now() - new Date(job.startedAt).getTime() < (job.local ? LOCAL_TOO_OLD_MS : CUTOUT_TOO_OLD_MS);
	// It failed or never reported back: the Best seconds go back, once.
	if ((failure || (job && !running)) && job?.usageKey && job.charged && !job.settled) {
		await refundBest(job.usageKey, job.charged).catch(() => {});
		await putObject(jobKey, JSON.stringify({ ...job, settled: true } satisfies Job), "application/json");
	}
	if (failure) return { status: "failed" as const, windows: job?.windows ?? [], runs, localRuns, error: failure.error ?? "The cutout failed" };
	if (running) return { status: "processing" as const, windows: job.windows, runs, localRuns, tier: job.local ?? ("best" as const) };
	return { status: "none" as const, windows: [] as Window[], runs, localRuns };
}

export async function GET(request: Request) {
	const key = await readKey(new URL(request.url).searchParams.get("key"));
	if (!key) return Response.json({ error: "Unknown video" }, { status: 404 });
	const { user } = await currentUser();
	const [now, edit, access] = await Promise.all([status(key), getJson<{ cutout?: CutoutLayers }>(siblingKey(key, "edit.json")), accessFor(user?.email)]);
	const best = {
		unlimited: access.unlimited,
		limit: access.features.cutout.seconds,
		used: !access.unlimited && user?.email ? await bestSecondsUsed(user.email) : 0,
	};
	const names = [...new Set((edit?.cutout?.inserts ?? []).map((i) => i.file))];
	const files = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await signedUrl(siblingKey(key, name), "GET", LINK_SECONDS)])));
	if (now.status !== "done") return Response.json({ ...now, files, best });
	const env = getCloudflareContext().env as unknown as CutoutEnv;
	return Response.json({ ...now, files, best, previewUrl: await mediaUrl(key, "proxy-cutout.mp4", env.RENDER_TOKEN, PREVIEW_LINK_SECONDS) });
}

export async function POST(request: Request) {
	const body = (await request.json().catch(() => ({}))) as { key?: unknown; windows?: unknown; tier?: unknown };
	const key = await readKey(body.key);
	if (!key) return Response.json({ error: "Unknown video" }, { status: 404 });
	const tier: CutoutTier = isTier(body.tier) ? body.tier : "best";

	// Checked here, not just by hiding the button: Best is paid GPU time.
	const { user } = await currentUser();
	const access = await accessFor(user?.email);
	if (!access.allowed || !access.features.cutout.on) return Response.json({ error: "Cutout isn't turned on for your account yet." }, { status: 403 });

	const edit = await getJson<{ duration: number }>(siblingKey(key, "edit.json"));
	if (!edit?.duration) return Response.json({ error: "Please wait until the script is ready." }, { status: 400 });
	const windows = cleanWindows(body.windows, edit.duration);
	if (windows.length === 0) return Response.json({ error: "Pick at least half a second to cut out." }, { status: 400 });

	if (tier === "best") {
		const unlock = user?.email ? await lockBest(user.email) : null;
		if (!unlock) return Response.json({ error: "A cutout is already starting. Please wait a moment." }, { status: 409 });
		try {
			return await startBest(key, windows, access, user?.email);
		} finally {
			await unlock();
		}
	}

	const now = await status(key);
	if (now.status === "processing") return Response.json({ error: "The cutout is still being made. Please wait for it to finish." }, { status: 409 });

	if (!access.unlimited && now.localRuns >= LOCAL_RUNS_PER_VIDEO) return Response.json({ error: "This video has been cut out too many times today. Please email hello@komoray.com." }, { status: 429 });
	const files = cutoutFiles(key);
	await Promise.all([deleteObject(files.done), deleteObject(files.error), deleteObject(siblingKey(key, LOCAL_MATTE))]);
	await putObject(files.job, JSON.stringify({ startedAt: new Date().toISOString(), windows, runs: now.runs, localRuns: now.localRuns + 1, local: tier } satisfies Job), "application/json");
	return Response.json({ uploadUrl: await signedUrl(siblingKey(key, LOCAL_MATTE), "PUT", LINK_SECONDS, "video/h264") });
}

const cutoutFiles = (key: string) => ({ done: siblingKey(key, "cutout.json"), error: siblingKey(key, "cutout-error.json"), job: siblingKey(key, "cutout-job.json"), matte: siblingKey(key, "matte.mp4") });

async function startBest(key: string, windows: Window[], access: Awaited<ReturnType<typeof accessFor>>, email?: string | null) {
	const now = await status(key);
	if (now.status === "processing") return Response.json({ error: "The cutout is still being made. Please wait for it to finish." }, { status: 409 });
	const files = cutoutFiles(key);
	if (!access.unlimited && now.runs >= CUTOUT_RUNS_PER_VIDEO) {
		return Response.json({ error: `This video has been cut out ${CUTOUT_RUNS_PER_VIDEO} times with Best. Please email hello@komoray.com for more.` }, { status: 429 });
	}

	// What the last Best cutout made is kept and not charged again. A Fast or Balanced matte is never reused.
	const previous = now.status === "done" && now.tier === "best" && (await exists(files.matte)) ? now.windows : [];
	const charged = newSeconds(windows, previous);
	let usageKey: string | undefined;
	if (!access.unlimited && email) {
		const left = access.features.cutout.seconds - (await bestSecondsUsed(email));
		if (charged > left + 0.05) return Response.json({ error: `Best needs ${charged} seconds and you have ${Math.max(0, Math.floor(left))} left this month. Try Fast or Balanced.` }, { status: 402 });
		usageKey = await chargeBest(email, key, charged);
	}

	const env = getCloudflareContext().env as unknown as CutoutEnv;
	let payload: string;
	try {
		// The links first: if making them fails, nothing is deleted and the seconds go straight back.
		const previousUrl = previous.length ? await signedUrl(files.matte, "GET", 2 * LINK_SECONDS) : undefined;
		payload = JSON.stringify({
			token: env.RENDER_TOKEN,
			windows,
			previousUrl,
			previousWindows: previous.length ? previous : undefined,
			videoUrl: await signedUrl(key, "GET", 2 * LINK_SECONDS),
			matteUrl: await signedUrl(files.matte, "PUT", 2 * LINK_SECONDS, "video/mp4"),
			previewUrl: await signedUrl(siblingKey(key, "proxy-cutout.mp4"), "PUT", 2 * LINK_SECONDS, "video/mp4"),
			doneUrl: await signedUrl(files.done, "PUT", 2 * LINK_SECONDS, "application/json"),
			errorUrl: await signedUrl(files.error, "PUT", 2 * LINK_SECONDS, "application/json"),
		});
		await putObject(files.job, JSON.stringify({ startedAt: new Date().toISOString(), windows, runs: now.runs + 1, localRuns: now.localRuns, usageKey, charged } satisfies Job), "application/json");
	} catch {
		if (usageKey) await refundBest(usageKey, charged).catch(() => {});
		return Response.json({ error: "Could not start the cutout. Your Best seconds are back. Please try again." }, { status: 502 });
	}
	await Promise.all([deleteObject(files.done), deleteObject(files.error)]);

	const res = await fetch(env.CUTOUT_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload }).catch(() => null);
	const data = (await res?.json().catch(() => ({}))) as { callId?: string; error?: string } | undefined;
	if (!res?.ok || !data?.callId) {
		const error = data?.error ?? `Could not start the cutout (${res?.status ?? "no answer"})`;
		await putObject(files.error, JSON.stringify({ error, at: new Date().toISOString() }), "application/json");
		return Response.json({ error }, { status: 502 });
	}
	return Response.json({ status: "processing", windows });
}
