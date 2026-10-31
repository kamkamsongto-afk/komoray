import { fetchObject, siblingKey, VIDEO_KEY } from "@/lib/r2";
import { ownsVideo } from "@/lib/supabase/server";

// The small picture of a video for My projects (thumb.jpg, made by Modal with the preview copy).
// Only for the video's owner. 404 while it isn't made yet: the page shows a plain tile instead.
export async function GET(request: Request) {
	const key = new URL(request.url).searchParams.get("key");
	if (!key || !VIDEO_KEY.test(key) || !(await ownsVideo(key))) return new Response("Not found", { status: 404 });
	const res = await fetchObject(siblingKey(key, "thumb.jpg"));
	if (!res.ok) return new Response("Not found", { status: 404 });
	return new Response(res.body, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" } });
}
