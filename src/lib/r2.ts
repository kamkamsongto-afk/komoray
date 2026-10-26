import { getCloudflareContext } from "@opennextjs/cloudflare";
import { AwsClient } from "aws4fetch";

type R2Env = {
	R2_ACCOUNT_ID: string;
	R2_ACCESS_KEY_ID: string;
	R2_SECRET_ACCESS_KEY: string;
	R2_BUCKET: string;
};

function r2() {
	const env = getCloudflareContext().env as unknown as R2Env;
	const client = new AwsClient({
		accessKeyId: env.R2_ACCESS_KEY_ID,
		secretAccessKey: env.R2_SECRET_ACCESS_KEY,
		service: "s3",
		region: "auto",
	});
	const objectUrl = (key: string) =>
		new URL(`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/${key}`);
	return { client, objectUrl };
}

// A link that lets whoever holds it do one thing (PUT or GET) to one file, for a limited time.
export async function signedUrl(key: string, method: "PUT" | "GET", seconds: number, contentType?: string) {
	const { client, objectUrl } = r2();
	const url = objectUrl(key);
	url.searchParams.set("X-Amz-Expires", String(seconds));
	const headers = contentType ? { "Content-Type": contentType } : undefined;
	const signed = await client.sign(new Request(url, { method, headers }), { aws: { signQuery: true } });
	return signed.url;
}

// Server-side write, e.g. saving edit.json next to the video.
export async function putObject(key: string, body: string, contentType: string) {
	const { client, objectUrl } = r2();
	// Sign first, then send plain bytes: R2 rejects streamed bodies with no known size (HTTP 411).
	const bytes = new TextEncoder().encode(body);
	const signed = await client.sign(objectUrl(key), {
		method: "PUT",
		body: bytes,
		headers: { "Content-Type": contentType },
	});
	const res = await fetch(signed.url, { method: "PUT", headers: signed.headers, body: bytes });
	if (!res.ok) throw new Error(`R2 write failed (${res.status})`);
}
