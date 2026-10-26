import { getCloudflareContext } from "@opennextjs/cloudflare";
import { AwsClient } from "aws4fetch";

// Only videos, and not too big, so strangers can't fill the bucket with junk.
const ALLOWED_TYPES = ["video/mp4", "video/quicktime"];
const MAX_SIZE = 500 * 1024 * 1024; // 500 MB
const URL_LIFETIME_SECONDS = 600; // the upload link works for 10 minutes

type R2Env = {
	R2_ACCOUNT_ID: string;
	R2_ACCESS_KEY_ID: string;
	R2_SECRET_ACCESS_KEY: string;
	R2_BUCKET: string;
};

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

	const env = getCloudflareContext().env as unknown as R2Env;

	// Each upload gets its own folder so two files with the same name never overwrite each other.
	const safeName = (filename ?? "video").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
	const key = `uploads/${crypto.randomUUID()}/${safeName}`;

	const r2 = new AwsClient({
		accessKeyId: env.R2_ACCESS_KEY_ID,
		secretAccessKey: env.R2_SECRET_ACCESS_KEY,
		service: "s3",
		region: "auto",
	});

	const url = new URL(`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/${key}`);
	url.searchParams.set("X-Amz-Expires", String(URL_LIFETIME_SECONDS));

	const signed = await r2.sign(new Request(url, { method: "PUT", headers: { "Content-Type": contentType } }), {
		aws: { signQuery: true },
	});

	return Response.json({ uploadUrl: signed.url, key });
}
