import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyCallback } from "@/lib/callback";
import { MEDIA_FILES, mediaMessage } from "@/lib/proxy";
import { fetchObject, siblingKey, VIDEO_KEY } from "@/lib/r2";

// The editor's own player reads the preview copy piece by piece (HTTP Range). Reading R2 directly
// from the page would need R2 to allow the Range header for other sites, so the bytes come
// through here instead, on our own site. Links are signed and expire (made by mediaUrl in
// lib/proxy.ts), so no sign-in check is needed for every piece.
export async function GET(request: Request) {
	const params = new URL(request.url).searchParams;
	const key = params.get("key") ?? "";
	const file = params.get("file") ?? "";
	const exp = Number(params.get("exp"));
	const sig = params.get("sig") ?? "";
	if (!VIDEO_KEY.test(key) || !MEDIA_FILES.includes(file) || !(exp > Date.now() / 1000)) return new Response("Not found", { status: 404 });
	const { RENDER_TOKEN } = getCloudflareContext().env as unknown as { RENDER_TOKEN: string };
	if (!(await verifyCallback(mediaMessage(key, file, exp), sig, RENDER_TOKEN))) return new Response("Not found", { status: 404 });

	const res = await fetchObject(siblingKey(key, file), request.headers.get("range"));
	if (!res.ok) return new Response("Not found", { status: res.status === 416 ? 416 : 404 });
	const headers = new Headers({ "Cache-Control": "private, max-age=3600", "Accept-Ranges": "bytes" });
	for (const name of ["Content-Type", "Content-Length", "Content-Range", "ETag"]) {
		const value = res.headers.get(name);
		if (value) headers.set(name, value);
	}
	return new Response(res.body, { status: res.status, headers });
}
