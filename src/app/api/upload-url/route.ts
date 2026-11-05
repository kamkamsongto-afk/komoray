import { accessFor, NO_INVITE } from "@/lib/access";
import { signedUrl } from "@/lib/r2";
import { currentUser } from "@/lib/supabase/server";
import { uploadLimitReached } from "@/lib/upload-limit";

// Only videos, and not too big, so strangers can't fill the bucket with junk.
const ALLOWED_TYPES = ["video/mp4", "video/quicktime"];
const MAX_SIZE = 500 * 1024 * 1024; // 500 MB
const URL_LIFETIME_SECONDS = 600; // the upload link works for 10 minutes

export async function POST(request: Request) {
	const { supabase, user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in first" }, { status: 401 });
	const access = await accessFor(user.email);
	if (!access.allowed) return Response.json({ error: NO_INVITE }, { status: 403 });
	if (!access.left) return Response.json({ error: `You've used your ${access.limit} minutes this month. They renew on ${access.resets}.` }, { status: 429 });
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
	if (!Number.isInteger(size) || !size || size < 0 || size > MAX_SIZE) {
		return Response.json({ error: "File must be 500 MB or smaller" }, { status: 400 });
	}

	// Each upload gets its own folder so two files with the same name never overwrite each other.
	const safeName = (filename ?? "video").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
	const id = crypto.randomUUID();
	const key = `uploads/${id}/${safeName}`;

	// Remember whose video this is, so only they can see it and work on it.
	const { error } = await supabase.from("projects").insert({ id, video_key: key, filename: filename ?? safeName, size });
	if (error) return Response.json({ error: "Could not save your project" }, { status: 500 });

	const uploadUrl = await signedUrl(key, "PUT", URL_LIFETIME_SECONDS, contentType, undefined, size);
	return Response.json({ uploadUrl, key });
}
