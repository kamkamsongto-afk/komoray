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
// downloadName makes browsers save the file under that name instead of playing it.
export async function signedUrl(
	key: string,
	method: "PUT" | "GET",
	seconds: number,
	contentType?: string,
	downloadName?: string,
) {
	const { client, objectUrl } = r2();
	const url = objectUrl(key);
	url.searchParams.set("X-Amz-Expires", String(seconds));
	if (downloadName) url.searchParams.set("response-content-disposition", `attachment; filename="${downloadName}"`);
	const headers = contentType ? { "Content-Type": contentType } : undefined;
	const signed = await client.sign(new Request(url, { method, headers }), { aws: { signQuery: true } });
	return signed.url;
}

// Server-side write, e.g. saving edit.json next to the video (or a small file's bytes).
export async function putObject(key: string, body: string | Uint8Array<ArrayBuffer>, contentType: string) {
	const { client, objectUrl } = r2();
	// Sign first, then send plain bytes: R2 rejects streamed bodies with no known size (HTTP 411).
	const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
	const signed = await client.sign(objectUrl(key), {
		method: "PUT",
		body: bytes,
		headers: { "Content-Type": contentType },
	});
	const res = await fetch(signed.url, { method: "PUT", headers: signed.headers, body: bytes });
	if (!res.ok) throw new Error(`R2 write failed (${res.status})`);
}

export async function getJson<T>(key: string): Promise<T | null> {
	const { client, objectUrl } = r2();
	const res = await client.fetch(objectUrl(key));
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`R2 read failed (${res.status})`);
	return (await res.json()) as T;
}

// Server-side read of part of a file (range: an HTTP Range header such as "bytes=0-1023"), as R2 answers it.
export async function fetchObject(key: string, range?: string | null) {
	const { client, objectUrl } = r2();
	return client.fetch(objectUrl(key), { headers: range ? { Range: range } : {} });
}

export async function exists(key: string) {
	const { client, objectUrl } = r2();
	const res = await client.fetch(objectUrl(key), { method: "HEAD" });
	return res.ok;
}

export async function deleteObject(key: string) {
	const { client, objectUrl } = r2();
	const res = await client.fetch(objectUrl(key), { method: "DELETE" });
	if (!res.ok && res.status !== 404) throw new Error(`R2 delete failed (${res.status})`);
}

export type ObjectInfo = { key: string; size: number; lastModified: string };

// Every file under a prefix (R2 returns at most 1000 per page, so follow the pages).
export async function listObjects(prefix: string) {
	const { client, objectUrl } = r2();
	const items: ObjectInfo[] = [];
	let token: string | null = null;
	do {
		const url = objectUrl("");
		url.searchParams.set("list-type", "2");
		url.searchParams.set("prefix", prefix);
		if (token) url.searchParams.set("continuation-token", token);
		const res = await client.fetch(url);
		if (!res.ok) throw new Error(`R2 list failed (${res.status})`);
		const xml = await res.text();
		const tag = (block: string, name: string) => block.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1] ?? "";
		for (const [, block] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
			items.push({ key: tag(block, "Key"), size: Number(tag(block, "Size")), lastModified: tag(block, "LastModified") });
		}
		token = tag(xml, "IsTruncated") === "true" ? tag(xml, "NextContinuationToken") : null;
	} while (token);
	return items;
}

// uploads/<id>/<name> → the job folder's other files live next to the video.
export const VIDEO_KEY = /^uploads\/[0-9a-f-]{36}\/[a-zA-Z0-9._-]+$/;
export const siblingKey = (videoKey: string, name: string) => videoKey.replace(/[^/]+$/, name);
