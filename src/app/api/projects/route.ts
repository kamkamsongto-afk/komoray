import { accessFor, NO_INVITE } from "@/lib/access";
import { OWNER_FILE } from "@/lib/admin-activity";
import { copyObject, deleteObject, listObjects, putObject, siblingKey, VIDEO_KEY } from "@/lib/r2";
import { currentUser, ownsVideo } from "@/lib/supabase/server";
import { uploadLimitReached } from "@/lib/upload-limit";

// Files a copy leaves behind: the finished video and a part of it (Make video makes them again), jobs, locks, progress
// and errors from the original's own runs, the phone hand-off, and owner.json (written fresh below).
const NOT_COPIED = /^(final\.mp4|render(-[a-z]+)?\.json|part(-[a-z]+)?\.(json|mp4)|phone\.json|.*-lock-.*|.*-(error|progress)\.json|.*\.started|owner\.json)$/;

// Duplicate (coach, 18 Nov): the same video with everything done to it, as a new project to take another way
// (another shape, another subtitle style). Copied inside R2, so nothing is listened to again and no minutes are taken;
// counts as an upload for the 24-hour limit. Files first, then the row, so My projects never shows a half copy.
export async function POST(request: Request) {
	const { key } = (await request.json().catch(() => ({}))) as { key?: string };
	if (!key || !VIDEO_KEY.test(key) || !(await ownsVideo(key))) return Response.json({ error: "Unknown video" }, { status: 404 });
	const { supabase, user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in first" }, { status: 401 });
	if (!(await accessFor(user.email)).allowed) return Response.json({ error: NO_INVITE }, { status: 403 });
	const limit = await uploadLimitReached(supabase, user);
	if (limit) return Response.json({ error: limit }, { status: 429 });

	const id = crypto.randomUUID();
	const name = key.split("/")[2];
	const newKey = `uploads/${id}/${name}`;
	const { data: from } = await supabase.from("projects").select("*").eq("video_key", key).maybeSingle<{ filename: string; size: number; folder_id?: string | null }>();
	if (!from) return Response.json({ error: "Unknown video" }, { status: 404 });

	const files = (await listObjects(siblingKey(key, ""))).filter((file) => !NOT_COPIED.test(file.key.split("/").slice(2).join("/")));
	const copied: string[] = [];
	try {
		await Promise.all(
			files.map(async (file) => {
				const to = `uploads/${id}/${file.key.split("/").slice(2).join("/")}`;
				await copyObject(file.key, to);
				copied.push(to);
			}),
		);
		const row = { id, video_key: newKey, filename: `${from.filename} (copy)`, size: from.size, ...(from.folder_id ? { folder_id: from.folder_id } : {}) };
		const { error } = await supabase.from("projects").insert(row);
		if (error) throw new Error(error.message);
		await putObject(`uploads/${id}/${OWNER_FILE}`, JSON.stringify({ email: user.email?.toLowerCase() }), "application/json").catch(() => {}); // for the Activity tab
		return Response.json({ project: { ...row, created_at: new Date().toISOString(), folder_id: from.folder_id ?? null } });
	} catch (error) {
		console.error("Duplicate failed:", error);
		await Promise.all(copied.map((file) => deleteObject(file).catch(() => {}))); // no half copy left in R2
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
