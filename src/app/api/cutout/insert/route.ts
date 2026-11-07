import { accessFor } from "@/lib/access";
import { INSERT } from "@/lib/behind";
import { signedUrl, siblingKey, VIDEO_KEY } from "@/lib/r2";
import { currentUser, ownsVideo } from "@/lib/supabase/server";

// A picture or short clip to show behind the cut-out speaker (lib/behind.ts), uploaded next to the video.
//   POST { key, contentType, size }  →  { uploadUrl, file }   (the browser PUTs the file to uploadUrl)
// Only for people with Cutout on, only pictures and clips, never too big. How long a clip shows is
// limited where it costs: the seconds cut out (/api/cutout).
const TYPES: Record<string, { ext: string; kind: "image" | "video" }> = {
	"image/jpeg": { ext: "jpg", kind: "image" },
	"image/png": { ext: "png", kind: "image" },
	"image/webp": { ext: "webp", kind: "image" },
	"video/mp4": { ext: "mp4", kind: "video" },
	"video/quicktime": { ext: "mov", kind: "video" },
};
const URL_LIFETIME_SECONDS = 600;

export async function POST(request: Request) {
	const { key, contentType, size } = (await request.json().catch(() => ({}))) as { key?: unknown; contentType?: unknown; size?: unknown };
	if (typeof key !== "string" || !VIDEO_KEY.test(key) || !(await ownsVideo(key))) return Response.json({ error: "Unknown video" }, { status: 404 });
	const { user } = await currentUser();
	const access = await accessFor(user?.email);
	if (!access.allowed || !access.features.cutout.on) return Response.json({ error: "Cutout isn't turned on for your account yet." }, { status: 403 });

	const type = typeof contentType === "string" ? TYPES[contentType] : undefined;
	if (!type) return Response.json({ error: "Please pick a JPG, PNG or WebP picture, or an MP4 or MOV clip." }, { status: 400 });
	const max = INSERT.maxBytes[type.kind];
	if (typeof size !== "number" || !Number.isInteger(size) || size <= 0 || size > max) {
		return Response.json({ error: `That file is too big. ${type.kind === "image" ? "Pictures" : "Clips"} can be up to ${Math.round(max / 1_000_000)} MB.` }, { status: 400 });
	}

	const file = `insert-${crypto.randomUUID()}.${type.ext}`;
	const uploadUrl = await signedUrl(siblingKey(key, file), "PUT", URL_LIFETIME_SECONDS, contentType as string, undefined, size);
	return Response.json({ uploadUrl, file, kind: type.kind });
}
