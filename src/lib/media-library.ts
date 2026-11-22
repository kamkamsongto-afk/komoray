// Import: pictures and clips the customer brings into a video's project once, then uses as a banner or in
// Pic/Clip as often as they like, without uploading again (Yoshi, 12 Nov). Kept next to the video in R2 as
// media-<id>.<ext>, listed in library.json there (names, kinds, sizes). So they go when the project goes
// (beta: 14 days). Files added before Import (a banner's banner-…, a Pic/Clip's insert-…) show in it too.
import type { Banner } from "./banners";
import type { CutoutLayers } from "./behind";
import type { FrameMe } from "./frame-me";
import type { VideoLayout } from "./layout";
import { MY_REF, type MyFile, myRefOf } from "./my-files";
import { uploadToMyFiles } from "./my-files-upload";

export type LibraryItem = {
	file: string; // its name in the video's folder
	name: string; // what the customer sees (the file's name, without its ending)
	media: "image" | "video";
	size: number; // bytes
	at: string; // when it was added
	clear?: boolean; // a picture with see-through parts
	seconds?: number; // a clip: how long it plays
	used?: boolean; // in this video now, as a banner or in Pic/Clip (worked out on every look, not saved)
	mine?: boolean; // kept in My files (file is a reference, MY_REF), not in this project's folder
};

export const MEDIA_FILE = /^media-[a-zA-Z0-9-]{1,40}\.(jpg|png|webp|gif|mp4)$/;
// Every file a project can show on its video: Import's own, and those added before it.
export const PROJECT_FILE = /^(media|banner|insert)-[a-zA-Z0-9-]{1,40}\.(jpg|png|webp|gif|mp4|mov)$/;
// Or one from My files by reference (MY_REF in my-files.ts, coach 21 Nov): what a project can show, wherever it is kept.
export const isProjectFile = (file: string) => PROJECT_FILE.test(file) || MY_REF.test(file);
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
export function filesInUse(edit: { banners?: Banner[]; cutout?: CutoutLayers; frames?: FrameMe[]; layouts?: VideoLayout[] } | null) {
	const used = new Set<string>();
	for (const b of edit?.banners ?? []) if (b.kind === "file" && b.file) used.add(b.file);
	for (const i of edit?.cutout?.inserts ?? []) used.add(i.file);
	for (const f of edit?.frames ?? []) if (f.back === "file" && f.file) used.add(f.file);
	for (const l of edit?.layouts ?? []) if (l.file) used.add(l.file);
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

// How long a clip plays, seconds (null if the browser can't tell). Never waits more than CLIP_LENGTH_WAIT_MS: a file
// the browser can't open may say nothing at all, and the upload behind it sat there with no word (coach 16 Nov).
const CLIP_LENGTH_WAIT_MS = 5000;
export function clipLength(file: File): Promise<number | null> {
	return new Promise((resolve) => {
		const video = document.createElement("video");
		const url = URL.createObjectURL(file);
		const done = (seconds: number | null) => {
			clearTimeout(timer);
			resolve(seconds);
			URL.revokeObjectURL(url);
		};
		const timer = setTimeout(() => done(null), CLIP_LENGTH_WAIT_MS);
		video.preload = "metadata";
		video.onloadedmetadata = () => done(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null);
		video.onerror = () => done(null);
		video.src = url;
	});
}

// One file into My files (coach 21 Nov: every new file goes there, by reference), as the My files box does it: for a
// picture or clip dropped straight on the video (Layout, coach 14 Nov). A file named like one already there is kept
// as well ("name (2)"): no question to answer mid-drop. In the browser only. key: unused now, kept for the callers.
export async function addToLibrary(_key: string, file: File, onProgress?: (percent: number) => void): Promise<{ item: LibraryItem } | { error: string }> {
	const sent = await uploadToMyFiles(file, "keep", ["image", "video"], onProgress);
	if ("error" in sent) return sent;
	if ("conflict" in sent) return { error: `${file.name}: could not upload` };
	return { item: itemOfMyFile(sent.file) };
}

// A My files picture or clip as a project can use it (by reference, MY_REF).
export function itemOfMyFile(f: MyFile): LibraryItem {
	return { file: myRefOf(f) ?? "", name: f.name, media: f.kind === "video" ? "video" : "image", size: f.size, at: f.at, mine: true, ...(f.clear && { clear: true }), ...(f.seconds && { seconds: f.seconds }) };
}

// The Import list, kept in this tab per video (coach 15 Nov: the box stood empty for 3–4 s each time it opened, as if
// the files had gone). The editor asks for it as it opens; the box shows what it has at once, then the fresh list.
// One question at a time per video: a second asker gets the one on its way, unless it wants a list from after a
// change (fresh: just uploaded or deleted). Only the latest question's answer is kept.
const libraries = new Map<string, { items?: LibraryItem[]; asking?: Promise<LibraryItem[]>; n: number }>();
export const knownLibrary = (key: string | null) => (key ? libraries.get(key)?.items : undefined);
export function loadLibrary(key: string, fresh = false): Promise<LibraryItem[]> {
	const kept = libraries.get(key) ?? { n: 0 };
	if (kept.asking && !fresh) return kept.asking;
	const n = kept.n + 1;
	const asking = fetch(`/api/library?key=${encodeURIComponent(key)}`)
		.then(async (res) => (res.ok ? (((await res.json()) as { items?: LibraryItem[] }).items ?? null) : null))
		.catch(() => null)
		.then((items) => {
			const now = libraries.get(key);
			if (now?.n !== n) return now?.asking ?? now?.items ?? items ?? [];
			libraries.set(key, { items: items ?? now.items ?? [], n });
			return items ?? now.items ?? [];
		});
	libraries.set(key, { ...kept, asking, n });
	return asking;
}
