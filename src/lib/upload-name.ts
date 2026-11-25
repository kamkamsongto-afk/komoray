// The name a new video is stored under in R2. Everything the system writes about a video sits in the same folder under
// fixed names (final.mp4, proxy.mp4, access.json ...), and the video used to be stored under the uploader's own name:
// one called "final.mp4" was deleted by its own Make video, and one called "access.json" could stand in for the record of
// what was paid. "src-" keeps every upload apart from all of them, and it always ends as a video. My projects shows the
// uploader's own name (projects.filename), not this one.
export function uploadName(filename: string, contentType: string) {
	const safe = (filename || "video").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
	return `src-${/\.(mp4|mov)$/i.test(safe) ? safe : `${safe}${contentType === "video/quicktime" ? ".mov" : ".mp4"}`}`;
}

// An upload from before 25 Nov may still carry a name Cutout writes its own files under: cutting it out would write over
// the video.
export const CUTOUT_WRITES = /^(proxy-(cutout|fast|balanced|slow)|matte(-(fast|balanced|slow))?)\.mp4$/;

// The file name to show for a stored key: without the "src-" uploadName put in front.
export const shownName = (key: string) => (key.split("/").pop() ?? key).replace(/^src-/, "");
