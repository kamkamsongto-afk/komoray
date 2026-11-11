import { canUseStudio, NO_INVITE } from "@/lib/access";
import { BANNER_FILE, BANNER_FILE_NAME } from "@/lib/banners";
import { signedUrl, siblingKey, VIDEO_KEY } from "@/lib/r2";
import { currentUser, ownsVideo } from "@/lib/supabase/server";

// The customer's own finished banner (a picture, GIF or clip: kind "file" in lib/banners.ts), uploaded next to the video.
//   POST { key, contentType, size }  →  { uploadUrl, file, media }   (the browser PUTs the file to uploadUrl)
//   GET ?key=…&file=banner-….png      →  a short-lived link to it, for the preview
// MPEG (.mpg), AVI and the like are not taken: a browser can't play them, so the preview couldn't show them.
const TYPES: Record<string, { ext: string; media: "image" | "video" }> = {
	"image/jpeg": { ext: "jpg", media: "image" },
	"image/png": { ext: "png", media: "image" },
	"image/webp": { ext: "webp", media: "image" },
	"image/gif": { ext: "gif", media: "image" },
	"video/mp4": { ext: "mp4", media: "video" },
	"video/quicktime": { ext: "mov", media: "video" },
	"video/webm": { ext: "webm", media: "video" },
};
const URL_LIFETIME_SECONDS = 600;
const VIEW_SECONDS = 3 * 3600;

export async function POST(request: Request) {
	const { key, contentType, size } = (await request.json().catch(() => ({}))) as { key?: unknown; contentType?: unknown; size?: unknown };
	if (typeof key !== "string" || !VIDEO_KEY.test(key) || !(await ownsVideo(key))) return Response.json({ error: "Unknown video" }, { status: 404 });
	if (!(await canUseStudio((await currentUser()).user?.email))) return Response.json({ error: NO_INVITE }, { status: 403 });

	const type = typeof contentType === "string" ? TYPES[contentType] : undefined;
	if (!type) return Response.json({ error: "Please pick a JPG, PNG, WebP or GIF picture, or an MP4, MOV or WebM clip." }, { status: 400 });
	const max = BANNER_FILE.maxBytes[type.media];
	if (typeof size !== "number" || !Number.isInteger(size) || size <= 0 || size > max) {
		return Response.json({ error: `That file is too big. ${type.media === "image" ? "Pictures" : "Clips"} can be up to ${Math.round(max / 1_000_000)} MB.` }, { status: 400 });
	}

	const file = `banner-${crypto.randomUUID()}.${type.ext}`;
	const uploadUrl = await signedUrl(siblingKey(key, file), "PUT", URL_LIFETIME_SECONDS, contentType as string, undefined, size);
	return Response.json({ uploadUrl, file, media: type.media });
}

export async function GET(request: Request) {
	const params = new URL(request.url).searchParams;
	const key = params.get("key");
	const file = params.get("file");
	if (!key || !VIDEO_KEY.test(key) || !file || !BANNER_FILE_NAME.test(file) || !(await ownsVideo(key))) return new Response("Not found", { status: 404 });
	return Response.redirect(await signedUrl(siblingKey(key, file), "GET", VIEW_SECONDS), 302);
}
