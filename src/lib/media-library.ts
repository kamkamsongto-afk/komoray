// Import: pictures and clips the customer brings into a video's project once, then uses as a banner or in
// Pic/Clip as often as they like, without uploading again (Yoshi, 12 Nov). Kept next to the video in R2 as
// media-<id>.<ext>, listed in library.json there (names, kinds, sizes). So they go when the project goes
// (beta: 14 days). Files added before Import (a banner's banner-…, a Pic/Clip's insert-…) show in it too.
import type { Banner } from "./banners";
import type { CutoutLayers } from "./behind";

export type LibraryItem = {
	file: string; // its name in the video's folder
	name: string; // what the customer sees (the file's name, without its ending)
	media: "image" | "video";
	size: number; // bytes
	at: string; // when it was added
	clear?: boolean; // a picture with see-through parts
	seconds?: number; // a clip: how long it plays
	used?: boolean; // in this video now, as a banner or in Pic/Clip (worked out on every look, not saved)
};

export const MEDIA_FILE = /^media-[a-zA-Z0-9-]{1,40}\.(jpg|png|webp|gif|mp4)$/;
// Every file a project can show on its video: Import's own, and those added before it.
export const PROJECT_FILE = /^(media|banner|insert)-[a-zA-Z0-9-]{1,40}\.(jpg|png|webp|gif|mp4|mov)$/;
export const LIBRARY = { maxItems: 40, maxName: 60, maxBytes: { image: 10_000_000, video: 150_000_000 } };
// What the browser can show in the preview and render.py can put on the final video. Clips: MP4 only for now.
export const LIBRARY_TYPES: Record<string, { ext: string; media: "image" | "video" }> = {
	"image/jpeg": { ext: "jpg", media: "image" },
	"image/png": { ext: "png", media: "image" },
	"image/webp": { ext: "webp", media: "image" },
	"image/gif": { ext: "gif", media: "image" },
	"video/mp4": { ext: "mp4", media: "video" },
};
export const LIBRARY_ACCEPT = Object.keys(LIBRARY_TYPES).join(",");

export const cleanMediaName = (name: unknown) =>
	String(name ?? "")
		.replace(/\.[^.]+$/, "")
		.replace(/[\n\r\t\\{}]/g, " ")
		.trim()
		.slice(0, LIBRARY.maxName);

// The files this video uses now: deleting one of them would leave a hole in the video.
export function filesInUse(edit: { banners?: Banner[]; cutout?: CutoutLayers } | null) {
	const used = new Set<string>();
	for (const b of edit?.banners ?? []) if (b.kind === "file" && b.file) used.add(b.file);
	for (const i of edit?.cutout?.inserts ?? []) used.add(i.file);
	return used;
}

// Where the preview gets a project file: through /api/library for the video this page edits (/edit?key=…).
export function projectFileSrc(file: string) {
	const key = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("key");
	return key ? `/api/library?key=${encodeURIComponent(key)}&file=${encodeURIComponent(file)}` : "";
}

// ---- in the browser, on a file just picked ----

// Does this picture really have clear parts? A PNG or GIF can be solid too, and a solid one works like a JPG.
export async function hasClearParts(file: File) {
	if (!/^image\/(png|webp|gif)$/.test(file.type)) return false;
	try {
		const picture = await createImageBitmap(file);
		const canvas = document.createElement("canvas");
		canvas.width = canvas.height = 64;
		const draw = canvas.getContext("2d", { willReadFrequently: true });
		if (!draw) return false;
		draw.drawImage(picture, 0, 0, 64, 64);
		picture.close();
		const { data } = draw.getImageData(0, 0, 64, 64);
		for (let k = 3; k < data.length; k += 4) if (data[k] < 250) return true;
	} catch {}
	return false;
}

// How long a clip plays, seconds (null if the browser can't tell).
export function clipLength(file: File): Promise<number | null> {
	return new Promise((resolve) => {
		const video = document.createElement("video");
		const url = URL.createObjectURL(file);
		video.preload = "metadata";
		video.onloadedmetadata = () => {
			resolve(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null);
			URL.revokeObjectURL(url);
		};
		video.onerror = () => {
			resolve(null);
			URL.revokeObjectURL(url);
		};
		video.src = url;
	});
}
