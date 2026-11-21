import { accessFor, canUseStudio, NO_INVITE } from "@/lib/access";
import type { Banner } from "@/lib/banners";
import type { CutoutLayers } from "@/lib/behind";
import type { FrameMe } from "@/lib/frame-me";
import type { VideoLayout } from "@/lib/layout";
import { cleanMediaName, filesInUse, isProjectFile, LIBRARY, LIBRARY_TYPES, type LibraryItem, MEDIA_FILE, PROJECT_FILE } from "@/lib/media-library";
import { MY_REF, myRefOf } from "@/lib/my-files";
import { myFilesOf } from "@/lib/my-files-usage";
import { projectFileKey } from "@/lib/project-files";
import { deleteObject, getJson, listObjects, putObject, siblingKey, signedUrl, VIDEO_KEY } from "@/lib/r2";
import { uploadBlocked } from "@/lib/storage";
import { currentUser, ownsVideo } from "@/lib/supabase/server";

// Import: the files a video's project keeps for its banners and Pic/Clip (lib/media-library.ts).
//   GET ?key=…                 { items }  Import's files and those added before it, newest first
//   (and every picture and clip in their My files, by reference: file my-<id>.<ext>, mine: true; coach 21 Nov)
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
		if (!isProjectFile(file)) return new Response("Not found", { status: 404 });
		// Kept by this browser for an hour (coach 19 Nov: a clip took a while to show in the preview): every ask made a new
		// signed link, so the browser could never reuse what it had already loaded of the same file. Private: only this
		// browser keeps it. The link itself lasts VIEW_SECONDS, well past the hour. A project file never changes (new name each upload).
		// Its own file, or the one in My files it points at (lib/project-files.ts). Neither ever changes.
		const { user } = await currentUser();
		const location = await signedUrl(projectFileKey(key, file, user?.id ?? ""), "GET", VIEW_SECONDS);
		return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "private, max-age=3600" } });
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
	// Then everything in My files a video can show (pictures and clips; coach 21 Nov: one place for every file), by
	// reference, so every picker (Banner, Pic/Clip, Frame Me, Layout) has them without a copy.
	const { user } = await currentUser();
	const mine: LibraryItem[] = user
		? (await myFilesOf(user.id)).flatMap((c) => {
				const ref = c.kind !== "font" ? myRefOf(c) : null;
				if (!ref) return [];
				return [{ file: ref, name: c.name, media: c.kind === "video" ? ("video" as const) : ("image" as const), size: c.size, at: c.at, mine: true, ...(c.clear && { clear: true }), ...(c.seconds && { seconds: c.seconds }) }];
			})
		: [];
	return Response.json({ items: [...items, ...mine].map((i) => ({ ...i, used: used.has(i.file) })) });
}

export async function POST(request: Request) {
	const body = (await request.json().catch(() => ({}))) as { key?: unknown; contentType?: unknown; size?: unknown };
	const key = await ownKey(body.key);
	if (!key) return Response.json({ error: "Unknown video" }, { status: 404 });
	const { supabase, user } = await currentUser();
	if (!(await canUseStudio(user?.email))) return Response.json({ error: NO_INVITE }, { status: 403 });
	const type = typeof body.contentType === "string" ? LIBRARY_TYPES[body.contentType] : undefined;
	if (!type) return Response.json({ error: "Please pick a JPG, PNG, WebP or GIF picture, or an MP4 clip." }, { status: 400 });
	const max = LIBRARY.maxBytes[type.media];
	if (typeof body.size !== "number" || !Number.isInteger(body.size) || body.size <= 0 || body.size > max) {
		return Response.json({ error: `That file is too big. ${type.media === "image" ? "Pictures" : "Clips"} can be up to ${Math.round(max / 1_000_000)} MB.` }, { status: 400 });
	}
	const full = await uploadBlocked(supabase, await accessFor(user?.email), body.size); // the plan's storage (lib/storage.ts)
	if (full) return Response.json({ error: full, storageFull: true }, { status: 413 });
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
	if (typeof body.file !== "string" || !PROJECT_FILE.test(body.file)) {
		return Response.json({ error: MY_REF.test(String(body.file)) ? "This one is kept in My files: delete it there." : "Unknown file" }, { status: 400 });
	}
	// Checked on the saved video: a banner or Pic/Clip still showing it would come out empty.
	if (filesInUse(await getJson<Edit>(siblingKey(key, "edit.json"))).has(body.file)) {
		return Response.json({ error: "This file is still on your video. Delete it from Banners, Pic/Clip, Frame Me or Layout first." }, { status: 409 });
	}
	await deleteObject(siblingKey(key, body.file));
	const library = await getJson<Library>(libraryKey(key));
	if (library) await putObject(libraryKey(key), JSON.stringify({ items: library.items.filter((i) => i.file !== body.file) }), "application/json");
	return Response.json({ ok: true });
}
