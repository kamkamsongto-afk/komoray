import { accessFor, hashEmail, LISTENS_PER_VIDEO, NO_INVITE } from "@/lib/access";
import { OWNER_FILE } from "@/lib/admin-activity";
import { copyObject, deleteObject, exists, getJson, listObjects, putObject, siblingKey, updateJson, VIDEO_KEY } from "@/lib/r2";
import { currentUser, ownsVideo } from "@/lib/supabase/server";
import { uploadBlocked } from "@/lib/storage";
import { uploadLimitReached } from "@/lib/upload-limit";

// Files a copy leaves behind: the finished video and a part of it (Make video makes them again), jobs, locks, progress
// and errors from the original's own runs, the phone hand-off, and owner.json (written fresh below).
const NOT_COPIED = /^(final\.mp4|render(-[a-z]+)?\.json|part(-[a-z]+)?\.(json|mp4)|phone\.json|.*-lock-.*|.*-(error|progress)\.json|.*\.started|owner\.json)$/;
const DUPLICATES_PER_DAY = 20; // copies keep the original's date (below), so the upload limit alone doesn't count them

// Files that hold the original's charges: written fresh for the copy, never copied as they are (agent review, 18 Nov).
// analyze.json and cutout-job.json carry a usageKey pointing at the ORIGINAL's minutes or Best seconds: a copy that
// thought its job had died would hand those back (settleDeadListen, cutout status()). access.json counts listens: a
// copy starts with none left, else each copy could be listened to again ("Wrong language?") without paying minutes.
const without = (json: Record<string, unknown>, ...names: string[]) => Object.fromEntries(Object.entries(json).filter(([name]) => !names.includes(name)));
const REWRITTEN: Record<string, (json: Record<string, unknown>) => Record<string, unknown>> = {
	"analyze.json": (json) => without(json, "usageKey"),
	"cutout-job.json": (json) => ({ ...without(json, "usageKey", "charged"), settled: true }),
	"access.json": (json) => ({ ...json, listens: LISTENS_PER_VIDEO }),
};

// Duplicate (coach, 18 Nov): the same video with everything done to it, as a new project to take another way
// (another shape, another subtitle style). Copied inside R2, so nothing is listened to again and no minutes are taken.
// Only once the video is ready and no Cutout is running. Files first, then the row, so My projects never shows a
// half copy. The copy keeps the original's date, so it is deleted when the original is (no way around retention).
export async function POST(request: Request) {
	const { key } = (await request.json().catch(() => ({}))) as { key?: string };
	if (!key || !VIDEO_KEY.test(key) || !(await ownsVideo(key))) return Response.json({ error: "Unknown video" }, { status: 404 });
	const { supabase, user } = await currentUser();
	if (!user?.email) return Response.json({ error: "Please sign in first" }, { status: 401 });
	const access = await accessFor(user.email);
	if (!access.allowed) return Response.json({ error: NO_INVITE }, { status: 403 });
	const limit = await uploadLimitReached(supabase, user);
	if (limit) return Response.json({ error: limit }, { status: 429 });

	const [ready, cutoutJob, cutoutDone, cutoutFailed] = await Promise.all([
		exists(siblingKey(key, "edit.json")),
		getJson<{ settled?: boolean }>(siblingKey(key, "cutout-job.json")),
		exists(siblingKey(key, "cutout.json")),
		exists(siblingKey(key, "cutout-error.json")),
	]);
	if (!ready) return Response.json({ error: "This video isn't ready yet. Please wait until its script is done." }, { status: 409 });
	if (cutoutJob && !cutoutDone && !cutoutFailed && !cutoutJob.settled) return Response.json({ error: "Cutout is still working on this video. Please try again when it's done." }, { status: 409 });

	const id = crypto.randomUUID();
	const name = key.split("/")[2];
	const newKey = `uploads/${id}/${name}`;
	const { data: from } = await supabase.from("projects").select("*").eq("video_key", key).maybeSingle<{ filename: string; size: number; created_at: string; folder_id?: string | null }>();
	if (!from) return Response.json({ error: "Unknown video" }, { status: 404 });

	// The video itself always comes along, whatever its name matches (one with "-lock-" in it was left behind).
	const files = (await listObjects(siblingKey(key, ""))).filter((file) => file.key === key || !NOT_COPIED.test(file.key.split("/").slice(2).join("/")));
	// A copy takes as much storage as what it copies (lib/storage.ts): not over the plan's storage either.
	const full = await uploadBlocked(supabase, access, files.reduce((sum, f) => sum + f.size, 0));
	if (full) return Response.json({ error: full, storageFull: true }, { status: 413 });
	// One of the day's copies is taken before copying: counted afterwards, 100 asked together were all made (26 Nov).
	const countKey = `access/duplicates/${await hashEmail(user.email)}/${new Date().toISOString().slice(0, 10)}.json`;
	const turn = await updateJson<{ count: number }, boolean>(countKey, (c) => ((c?.count ?? 0) >= DUPLICATES_PER_DAY ? { result: false } : { next: { count: (c?.count ?? 0) + 1 }, result: true }));
	if (!turn) return Response.json({ error: "Komoray is busy with your account right now. Please try again in a moment." }, { status: 429 });
	if (!turn.result) return Response.json({ error: `You've made ${DUPLICATES_PER_DAY} copies today. Please try again tomorrow.` }, { status: 429 });
	const copied: string[] = [];
	// allSettled: every copy has finished (or failed) before any clean-up, so none lands after it.
	const results = await Promise.allSettled(
		files.map(async (file) => {
			const rel = file.key.split("/").slice(2).join("/");
			const to = `uploads/${id}/${rel}`;
			const rewrite = REWRITTEN[rel];
			if (rewrite) {
				const json = await getJson<Record<string, unknown>>(file.key);
				if (json) await putObject(to, JSON.stringify(rewrite(json)), "application/json");
			} else await copyObject(file.key, to);
			copied.push(to);
		}),
	);
	try {
		const failed = results.find((r) => r.status === "rejected");
		if (failed) throw failed.reason;
		const row = { id, video_key: newKey, filename: `${from.filename} (copy)`, size: from.size, created_at: from.created_at, ...(from.folder_id ? { folder_id: from.folder_id } : {}) };
		const { error } = await supabase.from("projects").insert(row);
		if (error) throw new Error(error.message);
		await putObject(`uploads/${id}/${OWNER_FILE}`, JSON.stringify({ email: user.email.toLowerCase() }), "application/json").catch(() => {}); // for the Activity tab
		return Response.json({ project: { ...row, folder_id: from.folder_id ?? null } });
	} catch (error) {
		console.error("Duplicate failed:", error);
		await Promise.all(copied.map((file) => deleteObject(file).catch(() => {}))); // no half copy left in R2
		// Nothing was made: the day's count is given back.
		await updateJson<{ count: number }, null>(countKey, (c) => ({ next: { count: Math.max(0, (c?.count ?? 1) - 1) }, result: null })).catch(() => null);
		return Response.json({ error: "Could not duplicate this video. Please try again." }, { status: 500 });
	}
}

// Delete one of the user's videos for good: every file in its folder, then its row in My projects.
// Files first: if something fails, the row stays and they can press delete again.
export async function DELETE(request: Request) {
	const key = new URL(request.url).searchParams.get("key");
	if (!key || !VIDEO_KEY.test(key) || !(await ownsVideo(key))) return Response.json({ error: "Unknown video" }, { status: 404 });

	const files = await listObjects(siblingKey(key, ""));
	await Promise.all(files.map((file) => deleteObject(file.key)));

	const { supabase } = await currentUser();
	const { error } = await supabase.from("projects").delete().eq("video_key", key);
	if (error) return Response.json({ error: "Could not delete the project" }, { status: 500 });
	return Response.json({ ok: true });
}
