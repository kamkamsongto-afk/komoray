import { accessFor, NO_INVITE } from "@/lib/access";
import { OWNER_FILE } from "@/lib/admin-activity";
import { FILE_TOO_BIG, MAX_FILE_BYTES, OUT_OF_MINUTES } from "@/lib/limits";
import { putObject, signedUrl } from "@/lib/r2";
import { currentUser } from "@/lib/supabase/server";
import { uploadLimitReached } from "@/lib/upload-limit";

// Only videos, and not too big, so strangers can't fill the bucket with junk.
const ALLOWED_TYPES = ["video/mp4", "video/quicktime"];
const URL_LIFETIME_SECONDS = 3600; // a 2 GB file on a slow connection can take a while, same as /api/phone

export async function POST(request: Request) {
	const { supabase, user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in first" }, { status: 401 });
	const access = await accessFor(user.email);
	if (!access.allowed) return Response.json({ error: NO_INVITE }, { status: 403 });
	if (!access.left) return Response.json({ error: OUT_OF_MINUTES }, { status: 429 });
	const limit = await uploadLimitReached(supabase, user);
	if (limit) return Response.json({ error: limit }, { status: 429 });

	const { filename, contentType, size } = (await request.json()) as {
		filename?: string;
		contentType?: string;
		size?: number;
	};

	if (!contentType || !ALLOWED_TYPES.includes(contentType)) {
		return Response.json({ error: "Only .mp4 and .mov videos are allowed" }, { status: 400 });
	}
	if (!Number.isInteger(size) || !size || size < 0 || size > MAX_FILE_BYTES) {
		return Response.json({ error: FILE_TOO_BIG }, { status: 400 });
	}

	// Each upload gets its own folder so two files with the same name never overwrite each other.
	const safeName = (filename ?? "video").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
	const id = crypto.randomUUID();
	const key = `uploads/${id}/${safeName}`;

	// Remember whose video this is, so only they can see it and work on it.
	const { error } = await supabase.from("projects").insert({ id, video_key: key, filename: filename ?? safeName, size });
	if (error) return Response.json({ error: "Could not save your project" }, { status: 500 });
	await putObject(`uploads/${id}/${OWNER_FILE}`, JSON.stringify({ email: user.email?.toLowerCase() }), "application/json").catch(() => {}); // for the Activity tab, never worth failing an upload

	const uploadUrl = await signedUrl(key, "PUT", URL_LIFETIME_SECONDS, contentType, undefined, size);
	return Response.json({ uploadUrl, key });
}
