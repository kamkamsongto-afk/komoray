import { getCloudflareContext } from "@opennextjs/cloudflare";
import { accessFor, bestSecondsUsed, chargeBest, lockBest, refundBest } from "@/lib/access";
import { covered, type CutoutLayers } from "@/lib/behind";
import { cleanWindows, CUTOUT_RUNS_PER_VIDEO, CUTOUT_TIERS, CUTOUT_TOO_OLD_MS, type CutoutTier, LOCAL_MATTE, LOCAL_TOO_OLD_MS, LOCAL_RUNS_PER_VIDEO, newSeconds, savedFiles, type Window } from "@/lib/cutout";
import { mediaUrl } from "@/lib/proxy";
import { copyObject, deleteObject, exists, getJson, putIfAbsent, putObject, siblingKey, signedUrl, VIDEO_KEY } from "@/lib/r2";
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
	if (running) return { status: "processing" as const, windows: job.windows, runs, localRuns, tier: job.local ?? ("best" as const), startedAt: job.startedAt };
	return { status: "none" as const, windows: [] as Window[], runs, localRuns };
}

export async function GET(request: Request) {
	const key = await readKey(new URL(request.url).searchParams.get("key"));
	if (!key) return Response.json({ error: "Unknown video" }, { status: 404 });
	const { user } = await currentUser();
	const [now, edit, access, notes] = await Promise.all([status(key), getJson<{ cutout?: CutoutLayers }>(siblingKey(key, "edit.json")), accessFor(user?.email), Promise.all(CUTOUT_TIERS.map((tier) => getJson<Done>(siblingKey(key, savedFiles(tier).done))))]);
	// What each quality would not have to make (or charge for) again.
	const saved = Object.fromEntries(CUTOUT_TIERS.map((tier, i) => [tier, now.status === "done" && now.tier === tier ? now.windows : (notes[i]?.windows ?? [])]));
	const best = {
		unlimited: access.unlimited,
		limit: access.features.cutout.seconds,
		used: !access.unlimited && user?.email ? await bestSecondsUsed(user.email) : 0,
	};
	const names = [...new Set((edit?.cutout?.inserts ?? []).map((i) => i.file))];
	const files = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await signedUrl(siblingKey(key, name), "GET", LINK_SECONDS)])));
	if (now.status !== "done") return Response.json({ ...now, files, best, saved });
	const env = getCloudflareContext().env as unknown as CutoutEnv;
	return Response.json({ ...now, files, best, saved, previewUrl: await mediaUrl(key, "proxy-cutout.mp4", env.RENDER_TOKEN, PREVIEW_LINK_SECONDS) });
}

export async function POST(request: Request) {
	const body = (await request.json().catch(() => ({}))) as { key?: unknown; windows?: unknown; tier?: unknown; restore?: unknown };
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

	// One change at a time per video: matte, preview and cutout.json are written in steps, and two changes
	// interleaving would leave one quality's label on another's files (Codex review, 10 Nov).
	const unlockVideo = await lockVideo(key);
	if (!unlockVideo) return Response.json({ error: "Your cutout is changing. Please wait a moment and try again." }, { status: 409 });
	try {
		return await changeCutout(key, windows, tier, body.restore === true, access, user?.email);
	} finally {
		await unlockVideo();
	}
}

// Named by the minute, and the minute before also counts: a lock left by a crash clears itself, and two
// requests either side of a new minute still can't both get in. null = busy.
async function lockVideo(key: string) {
	const minute = Math.floor(Date.now() / 60000);
	const lock = siblingKey(key, `cutout-lock-${minute}.json`);
	if (!(await putIfAbsent(lock, "{}", "application/json"))) return null;
	const unlock = () => deleteObject(lock).catch(() => {});
	if (await exists(siblingKey(key, `cutout-lock-${minute - 1}.json`))) {
		await unlock();
		return null;
	}
	return unlock;
}

async function changeCutout(key: string, windows: Window[], tier: CutoutTier, restore: boolean, access: Awaited<ReturnType<typeof accessFor>>, email?: string | null) {
	// Switching to a quality already made: no GPU, no seconds, no run used up.
	if (restore) {
		const now = await status(key);
		if (now.status === "processing") return Response.json({ error: "The cutout is still being made. Please wait for it to finish." }, { status: 409 });
		const note = await savedCutout(key, tier);
		if (!note || !covered(windows, note.windows)) return Response.json({ error: "That cutout isn't saved for this video." }, { status: 404 });
		return bringBack(key, tier, note, now);
	}

	if (tier === "best") {
		const unlock = email ? await lockBest(email) : null;
		if (!unlock) return Response.json({ error: "A cutout is already starting. Please wait a moment." }, { status: 409 });
		try {
			return await startBest(key, windows, access, email);
		} finally {
			await unlock();
		}
	}

	const now = await status(key);
	if (now.status === "processing") return Response.json({ error: "The cutout is still being made. Please wait for it to finish." }, { status: 409 });

	if (!access.unlimited && now.localRuns >= LOCAL_RUNS_PER_VIDEO) return Response.json({ error: "This video has been cut out too many times today. Please email hello@komoray.com." }, { status: 429 });
	const files = cutoutFiles(key);
	// Another quality is about to be written over this one. Failing to keep it mustn't waste the work
	// just done on this computer: going back then simply means cutting again.
	if (now.status === "done" && now.tier !== tier) await keepCurrent(key, now).catch(() => {});
	await Promise.all([deleteObject(files.done), deleteObject(files.error), deleteObject(siblingKey(key, LOCAL_MATTE))]);
	await putObject(files.job, JSON.stringify({ startedAt: new Date().toISOString(), windows, runs: now.runs, localRuns: now.localRuns + 1, local: tier } satisfies Job), "application/json");
	return Response.json({ uploadUrl: await signedUrl(siblingKey(key, LOCAL_MATTE), "PUT", LINK_SECONDS, "video/h264") });
}

const cutoutFiles = (key: string) => ({ done: siblingKey(key, "cutout.json"), error: siblingKey(key, "cutout-error.json"), job: siblingKey(key, "cutout-job.json"), matte: siblingKey(key, "matte.mp4") });

// Copies the cutout in use aside, under its quality's own names. The note is written last and removed
// first, so it only ever describes two complete files. Already kept (same version): nothing to copy.
async function keepCurrent(key: string, now: { windows: Window[]; tier: CutoutTier; version: string }) {
	const names = savedFiles(now.tier);
	const noteKey = siblingKey(key, names.done);
	if ((await getJson<Done>(noteKey))?.at === now.version) return;
	await deleteObject(noteKey);
	await Promise.all([copyObject(siblingKey(key, "matte.mp4"), siblingKey(key, names.matte)), copyObject(siblingKey(key, "proxy-cutout.mp4"), siblingKey(key, names.preview))]);
	await putObject(noteKey, JSON.stringify({ windows: now.windows, tier: now.tier, at: now.version } satisfies Done), "application/json");
}

async function savedCutout(key: string, tier: CutoutTier) {
	const names = savedFiles(tier);
	const note = await getJson<Done>(siblingKey(key, names.done));
	if (!note) return null;
	const [matte, preview] = await Promise.all([exists(siblingKey(key, names.matte)), exists(siblingKey(key, names.preview))]);
	return matte && preview ? note : null;
}

// Puts a kept cutout back in use. It keeps its own version (at), so switching back and forth doesn't
// light the "your cutout is ready" dot every time.
async function bringBack(key: string, tier: CutoutTier, note: Done, now: Awaited<ReturnType<typeof status>>) {
	const files = cutoutFiles(key);
	const names = savedFiles(tier);
	try {
		// Inside the try: if the one in use can't be kept, stop here rather than copy over the only good copy.
		if (now.status === "done" && now.tier !== tier) await keepCurrent(key, now);
		await deleteObject(files.done);
		await Promise.all([copyObject(siblingKey(key, names.matte), files.matte), copyObject(siblingKey(key, names.preview), siblingKey(key, "proxy-cutout.mp4"))]);
		await deleteObject(files.error);
		await putObject(files.done, JSON.stringify({ windows: note.windows, tier, at: note.at ?? new Date().toISOString() } satisfies Done), "application/json");
	} catch {
		return Response.json({ error: "Could not switch to that cutout. Please try again." }, { status: 502 });
	}
	return Response.json({ status: "done", windows: note.windows });
}

async function startBest(key: string, windows: Window[], access: Awaited<ReturnType<typeof accessFor>>, email?: string | null) {
	const now = await status(key);
	if (now.status === "processing") return Response.json({ error: "The cutout is still being made. Please wait for it to finish." }, { status: 409 });
	const files = cutoutFiles(key);
	const current = now.status === "done" && now.tier === "best" && (await exists(files.matte));
	const saved = current ? null : await savedCutout(key, "best");

	// Everything asked for is already in the kept Best cutout: put it back.
	if (saved && covered(windows, saved.windows)) return bringBack(key, "best", saved, now);
	// Already there. Without this it would start a GPU that nobody pays for (the button is off, a forged request isn't).
	if (current && covered(windows, now.windows)) return Response.json({ status: "done", windows: now.windows });

	if (!access.unlimited && now.runs >= CUTOUT_RUNS_PER_VIDEO) {
		return Response.json({ error: `This video has been cut out ${CUTOUT_RUNS_PER_VIDEO} times with Slow. Please email hello@komoray.com for more.` }, { status: 429 });
	}

	// What an earlier Best cutout made is reused and not charged again. A Fast or Balanced matte is never reused.
	const previous = current ? now.windows : (saved?.windows ?? []);
	const previousFile = current ? files.matte : siblingKey(key, savedFiles("best").matte);
	const charged = newSeconds(windows, previous);
	let usageKey: string | undefined;
	if (!access.unlimited && email) {
		const left = access.features.cutout.seconds - (await bestSecondsUsed(email));
		if (charged > left + 0.05) return Response.json({ error: `Slow needs ${charged} seconds and you have ${Math.max(0, Math.floor(left))} left this month. Try Fast or Normal.` }, { status: 402 });
		usageKey = await chargeBest(email, key, charged);
	}

	const env = getCloudflareContext().env as unknown as CutoutEnv;
	let payload: string;
	try {
		// The links first: if making them fails, nothing is deleted and the seconds go straight back.
		const previousUrl = previous.length ? await signedUrl(previousFile, "GET", 2 * LINK_SECONDS) : undefined;
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
		return Response.json({ error: "Could not start the cutout. Your Slow seconds are back. Please try again." }, { status: 502 });
	}
	if (now.status === "done" && now.tier !== "best") await keepCurrent(key, now).catch(() => {});
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
