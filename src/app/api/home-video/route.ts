import { fetchObject } from "@/lib/r2";

// The home page's clips, read piece by piece (HTTP Range): iPhones and iPads won't play a video
// without it, and static files on this site ignore Range. Only these files can be named here.
// All filmed by the coach (20 Nov: no AI-made pictures on the home page). A new cut gets a new name (-v2…),
// since browsers keep these for a week. cutout: the picture on top, the person's matte below (LandingDemos).
const FILES: Record<string, string> = {
	before: "site/home-before-v1.mp4",
	after: "site/home-after-v2.mp4",
	words: "site/home-words-v1.mp4",
	frame: "site/home-frame-v1.mp4",
	cutout: "site/home-cutout-v1.mp4",
	layout: "site/home-layout-v1.mp4",
	zoo: "site/home-zoo-v1.mp4",
	zoom: "site/home-zoom-v1.mp4",
	banner: "site/home-banner-v1.mp4",
};

export async function GET(request: Request) {
	const key = FILES[new URL(request.url).searchParams.get("name") ?? ""];
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
