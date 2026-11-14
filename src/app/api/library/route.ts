import { canUseStudio, NO_INVITE } from "@/lib/access";
import type { Banner } from "@/lib/banners";
import type { CutoutLayers } from "@/lib/behind";
import type { FrameMe } from "@/lib/frame-me";
import type { VideoLayout } from "@/lib/layout";
import { cleanMediaName, filesInUse, LIBRARY, LIBRARY_TYPES, type LibraryItem, MEDIA_FILE, PROJECT_FILE } from "@/lib/media-library";
import { deleteObject, getJson, listObjects, putObject, siblingKey, signedUrl, VIDEO_KEY } from "@/lib/r2";
import { currentUser, ownsVideo } from "@/lib/supabase/server";

// Import: the files a video's project keeps for its banners and Pic/Clip (lib/media-library.ts).
//   GET ?key=…                 { items }  Import's files and those added before it, newest first
//   GET ?key=…&file=…          a short-lived link to one of them (for the preview)
//   POST { key, contentType, size }       { uploadUrl, file }  then the browser PUTs the file there
//   PUT  { key, file, name, clear?, seconds? }  { item }  the upload finished: list it
//   DELETE { key, file }       removes it, unless the video uses it now (409)
const UPLOAD_SECONDS = 600;
const VIEW_SECONDS = 3 * 3600;
type Library = { items: LibraryItem[] };
type Edit = { banners?: Banner[]; cutout?: CutoutLayers; frames?: FrameMe[]; layouts?: VideoLayout[] };

async function ownKey(key: unknown) {
	return typeof key === "string" && VIDEO_KEY.test(key) && (await ownsVideo(key)) ? key : null;
}
const libraryKey = (key: string) => siblingKey(key, "library.json");
const mediaOf = (file: string): LibraryItem["media"] => (/\.(mp4|mov)$/.test(file) ? "video" : "image");

export async function GET(request: Request) {
	const params = new URL(request.url).searchParams;
	const key = await ownKey(params.get("key"));
	if (!key) return Response.json({ error: "Unknown video" }, { status: 404 });
	const file = params.get("file");
	if (file !== null) {
		if (!PROJECT_FILE.test(file)) return new Response("Not found", { status: 404 });
		return Response.redirect(await signedUrl(siblingKey(key, file), "GET", VIEW_SECONDS), 302);
	}

	const [library, edit, folder] = await Promise.all([getJson<Library>(libraryKey(key)), getJson<Edit>(siblingKey(key, "edit.json")), listObjects(siblingKey(key, ""))]);
	const used = filesInUse(edit);
	const there = new Map(folder.map((o) => [o.key.split("/").pop() ?? "", o]));
	const items: LibraryItem[] = (library?.items ?? []).filter((i) => there.has(i.file));
	// Files added before Import (as a banner or in Pic/Clip), and an Import file library.json lost (two uploads
	// listed at the same moment, Codex review 12 Nov): shown anyway, named as the video names them, so none gets stuck.
	const names = new Map<string, string>();
	const lengths = new Map<string, number>(); // a clip used as a banner: as long as it was shown, its own length unknown here
	for (const b of edit?.banners ?? []) {
		if (b.kind !== "file" || !b.file) continue;
		names.set(b.file, b.text);
		if (b.media === "video") lengths.set(b.file, Math.max(lengths.get(b.file) ?? 0, Math.round((b.end - b.start) * 100) / 100));
	}
	for (const i of edit?.cutout?.inserts ?? []) names.set(i.file, i.name ?? "");
	for (const [file, info] of there) {
		if (!PROJECT_FILE.test(file) || items.some((i) => i.file === file)) continue;
		items.push({ file, name: names.get(file) || (mediaOf(file) === "video" ? "Clip" : "Picture"), media: mediaOf(file), size: info.size, at: info.lastModified, ...(lengths.get(file) && { seconds: lengths.get(file) }) });
	}
	items.sort((a, b) => b.at.localeCompare(a.at));
	return Response.json({ items: items.map((i) => ({ ...i, used: used.has(i.file) })) });
}

export async function POST(request: Request) {
	const body = (await request.json().catch(() => ({}))) as { key?: unknown; contentType?: unknown; size?: unknown };
	const key = await ownKey(body.key);
	if (!key) return Response.json({ error: "Unknown video" }, { status: 404 });
	if (!(await canUseStudio((await currentUser()).user?.email))) return Response.json({ error: NO_INVITE }, { status: 403 });
	const type = typeof body.contentType === "string" ? LIBRARY_TYPES[body.contentType] : undefined;
	if (!type) return Response.json({ error: "Please pick a JPG, PNG, WebP or GIF picture, or an MP4 clip." }, { status: 400 });
	const max = LIBRARY.maxBytes[type.media];
	if (typeof body.size !== "number" || !Number.isInteger(body.size) || body.size <= 0 || body.size > max) {
		return Response.json({ error: `That file is too big. ${type.media === "image" ? "Pictures" : "Clips"} can be up to ${Math.round(max / 1_000_000)} MB.` }, { status: 400 });
	}
	const library = await getJson<Library>(libraryKey(key));
	if ((library?.items.length ?? 0) >= LIBRARY.maxItems) return Response.json({ error: `A project keeps up to ${LIBRARY.maxItems} files. Delete one you don't use first.` }, { status: 400 });
	const file = `media-${crypto.randomUUID()}.${type.ext}`;
	const uploadUrl = await signedUrl(siblingKey(key, file), "PUT", UPLOAD_SECONDS, body.contentType as string, undefined, body.size);
	return Response.json({ uploadUrl, file });
}

export async function PUT(request: Request) {
	const body = (await request.json().catch(() => ({}))) as { key?: unknown; file?: unknown; name?: unknown; clear?: unknown; seconds?: unknown };
	const key = await ownKey(body.key);
	if (!key) return Response.json({ error: "Unknown video" }, { status: 404 });
	if (typeof body.file !== "string" || !MEDIA_FILE.test(body.file)) return Response.json({ error: "Unknown file" }, { status: 400 });
	// Only what really arrived is listed, at its real size.
	const found = (await listObjects(siblingKey(key, body.file))).find((o) => o.key === siblingKey(key, body.file as string));
	if (!found) return Response.json({ error: "The upload didn't arrive. Please try again." }, { status: 409 });
	const library = (await getJson<Library>(libraryKey(key))) ?? { items: [] };
	const seconds = Number(body.seconds);
	const item: LibraryItem = {
		file: body.file,
		name: cleanMediaName(body.name) || (mediaOf(body.file) === "video" ? "Clip" : "Picture"),
		media: mediaOf(body.file),
		size: found.size,
		at: new Date().toISOString(),
		...(body.clear === true && mediaOf(body.file) === "image" && { clear: true }),
		...(mediaOf(body.file) === "video" && Number.isFinite(seconds) && seconds > 0 && { seconds: Math.round(seconds * 100) / 100 }),
	};
	const items = [item, ...library.items.filter((i) => i.file !== item.file)].slice(0, LIBRARY.maxItems);
	await putObject(libraryKey(key), JSON.stringify({ items }), "application/json");
	return Response.json({ item });
}

export async function DELETE(request: Request) {
	const body = (await request.json().catch(() => ({}))) as { key?: unknown; file?: unknown };
	const key = await ownKey(body.key);
	if (!key) return Response.json({ error: "Unknown video" }, { status: 404 });
	if (typeof body.file !== "string" || !PROJECT_FILE.test(body.file)) return Response.json({ error: "Unknown file" }, { status: 400 });
	// Checked on the saved video: a banner or Pic/Clip still showing it would come out empty.
	if (filesInUse(await getJson<Edit>(siblingKey(key, "edit.json"))).has(body.file)) {
		return Response.json({ error: "This file is still on your video. Delete it from Banners, Pic/Clip or Frame Me first." }, { status: 409 });
	}
	await deleteObject(siblingKey(key, body.file));
	const library = await getJson<Library>(libraryKey(key));
	if (library) await putObject(libraryKey(key), JSON.stringify({ items: library.items.filter((i) => i.file !== body.file) }), "application/json");
	return Response.json({ ok: true });
}
