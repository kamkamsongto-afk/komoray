import { signedUrl } from "@/lib/r2";

// Only videos, and not too big, so strangers can't fill the bucket with junk.
const ALLOWED_TYPES = ["video/mp4", "video/quicktime"];
const MAX_SIZE = 500 * 1024 * 1024; // 500 MB
const URL_LIFETIME_SECONDS = 600; // the upload link works for 10 minutes

export async function POST(request: Request) {
	const { filename, contentType, size } = (await request.json()) as {
		filename?: string;
		contentType?: string;
		size?: number;
	};

	if (!contentType || !ALLOWED_TYPES.includes(contentType)) {
		return Response.json({ error: "Only .mp4 and .mov videos are allowed" }, { status: 400 });
	}
	if (!size || size > MAX_SIZE) {
		return Response.json({ error: "File must be 500 MB or smaller" }, { status: 400 });
	}

	// Each upload gets its own folder so two files with the same name never overwrite each other.
	const safeName = (filename ?? "video").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
	const key = `uploads/${crypto.randomUUID()}/${safeName}`;

	const uploadUrl = await signedUrl(key, "PUT", URL_LIFETIME_SECONDS, contentType);
	return Response.json({ uploadUrl, key });
}
