import { fetchObject } from "@/lib/r2";

// The home page banner's video, read piece by piece (HTTP Range): iPhones and iPads won't play a video
// without it, and static files on this site ignore Range. Only these two files can be named here.
const FILES: Record<string, string> = {
	large: "site/hero-manta-v1-1600.mp4",
	small: "site/hero-manta-v1-960.mp4",
};

export async function GET(request: Request) {
	const key = FILES[new URL(request.url).searchParams.get("size") ?? ""];
	if (!key) return new Response("Not found", { status: 404 });
	const res = await fetchObject(key, request.headers.get("range"));
	// A range past the end: say how big the file is, so the player can ask again.
	if (res.status === 416) return new Response(null, { status: 416, headers: { "Content-Range": res.headers.get("Content-Range") ?? "bytes */*" } });
	if (!res.ok) return new Response("Not found", { status: 404 });
	const headers = new Headers({ "Cache-Control": "public, max-age=604800", "Accept-Ranges": "bytes" });
	for (const name of ["Content-Type", "Content-Length", "Content-Range", "ETag"]) {
		const value = res.headers.get(name);
		if (value) headers.set(name, value);
	}
	return new Response(res.body, { status: res.status, headers });
}
