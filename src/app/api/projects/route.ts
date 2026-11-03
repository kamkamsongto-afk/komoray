import { deleteObject, listObjects, siblingKey, VIDEO_KEY } from "@/lib/r2";
import { currentUser, ownsVideo } from "@/lib/supabase/server";

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
