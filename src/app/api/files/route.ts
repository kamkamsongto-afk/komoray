import { accessFor } from "@/lib/access";
import { readFontInfo } from "@/lib/font-info";
import { logoType } from "@/lib/logo";
import { asOwnFont, cleanFileName, fileId, freeName, MY_FILE_ID, MY_FILE_KINDS, type MyFile, type MyFileKind, myFileCardKey, myFileKey, myFilesPrefix, myIncomingPrefix } from "@/lib/my-files";
import { readKits } from "@/lib/brand-kits";
import { bannersKey, filesUse, FONTS_LOCKED, myFilesOf, type Pins, projectIdsOf } from "@/lib/my-files-usage";
import { copyObject, deleteObject, exists, fetchObject, getJson, listObjects, putIfAbsent, putObject, signedUrl } from "@/lib/r2";
import { uploadBlocked } from "@/lib/storage";
import { currentUser } from "@/lib/supabase/server";

// My files (lib/my-files.ts): the signed-in person's own files, used again and again.
//   GET ?id=…                       the file itself (its bytes never change, so the browser may keep it)
//   GET ?kind=logo|font             { files, limit } of that kind, newest first. limit: fonts the plan holds (null: no cap).
//   POST ?kind=…&name=…[&then=]     the file as the body → { file, same? }
//     same: this very file was already there (nothing new is stored).
//     409 { conflict }: another file of this kind has that name. Ask, then send again with
//     then=use (take that one, nothing stored) or then=keep (store this one as "name (2)").
//   POST ?kind=…&replace=<id>       the file in place of that one: it takes its name (the old one becomes "name (old)") and
//     every Brand Kit using the old one uses this one → { file, kits }. Projects made before keep theirs (lib/my-files.ts).
//     The old one goes when nothing uses it any more.
//   GET ?all=1                      { files, use, fontLimit }: every file, and where each is used (lib/my-files-usage.ts)
//   PATCH { id, name }              renames it (the id never changes) → { file }; 409 when another of its kind has the name
//   DELETE ?id=…                    removes it, only when nothing uses it (409 { use } otherwise)
const kindOf = (value: string | null): MyFileKind | null => (value && value in MY_FILE_KINDS ? (value as MyFileKind) : null);

async function cardsOf(userId: string, kind: MyFileKind) {
	const keys = (await listObjects(myFilesPrefix(userId))).map((o) => o.key).filter((k) => k.endsWith(".json"));
	const cards = await Promise.all(keys.map((k) => getJson<MyFile>(k)));
	return cards.filter((c): c is MyFile => !!c && c.kind === kind).sort((a, b) => b.at.localeCompare(a.at));
}

export async function GET(request: Request) {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	const params = new URL(request.url).searchParams;
	const id = params.get("id");
	if (id !== null) {
		// link: a short-lived link to it instead of its bytes through here (a clip of up to 150 MB, played with Range).
		if (params.has("link") && MY_FILE_ID.test(id)) {
			const location = await signedUrl(myFileKey(user.id, id), "GET", 3 * 3600);
			return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "private, max-age=3600" } });
		}
		const res = MY_FILE_ID.test(id) ? await fetchObject(myFileKey(user.id, id)) : null;
		if (!res?.ok) {
			await res?.body?.cancel();
			return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
		}
		return new Response(res.body, { headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/octet-stream", "Cache-Control": "private, max-age=31536000, immutable" } });
	}
	if (params.has("all")) {
		const [files, use, access] = await Promise.all([myFilesOf(user.id), whereAllUsed(user.id), accessFor(user.email)]);
		return Response.json({ files, use: Object.fromEntries(use), fontLimit: access.perks.fonts });
	}
	const kind = kindOf(params.get("kind"));
	if (!kind) return Response.json({ error: "Unknown kind" }, { status: 400 });
	const limit = kind === "font" ? (await accessFor(user.email)).perks.fonts : null;
	return Response.json({ files: await cardsOf(user.id, kind), limit });
}

// Where each file is used now, read fresh from their kits, saved banners and projects (lib/my-files-usage.ts). Throws
// when any read fails: then nothing is deleted (when unsure, keep).
async function whereAllUsed(userId: string) {
	const { supabase } = await currentUser();
	return filesUse(userId, await projectIdsOf(supabase));
}
const whereUsed = async (userId: string, id: string) => (await whereAllUsed(userId)).get(id) ?? { kits: [], banners: 0, projects: 0 };
const inUse = (u: { kits: string[]; banners: number; projects: number }) => u.kits.length > 0 || u.banners > 0 || u.projects > 0;
const UNSURE = "Could not check where it is used. Nothing was deleted: please try again.";
// How many of each My files keeps (fonts: the plan, below). Storage is the real limit; these keep the lists quick to read.
const MAX_COUNT: Partial<Record<MyFileKind, number>> = { logo: 100, image: 300, video: 200 };

export async function PATCH(request: Request) {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	const body = (await request.json().catch(() => ({}))) as { id?: unknown; name?: unknown };
	const id = typeof body.id === "string" && MY_FILE_ID.test(body.id) ? body.id : null;
	const card = id ? await getJson<MyFile>(myFileCardKey(user.id, id)) : null;
	if (!id || !card) return Response.json({ error: "That file is gone" }, { status: 404 });
	const name = cleanFileName(body.name, "");
	if (!name) return Response.json({ error: "Please type a name" }, { status: 400 });
	const clash = (await cardsOf(user.id, card.kind)).find((c) => c.id !== id && c.name.toLowerCase() === name.toLowerCase());
	if (clash) return Response.json({ error: `Another ${MY_FILE_KINDS[card.kind].label} is called "${clash.name}"` }, { status: 409 });
	// Only the card is written again, for its name: the file itself is never touched (lib/my-files.ts).
	const file = { ...card, name };
	await putObject(myFileCardKey(user.id, id), JSON.stringify(file), "application/json");
	return Response.json({ file });
}

export async function DELETE(request: Request) {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	const id = new URL(request.url).searchParams.get("id");
	const card = id && MY_FILE_ID.test(id) ? await getJson<MyFile>(myFileCardKey(user.id, id)) : null;
	if (!id || !card) return Response.json({ error: "That file is gone" }, { status: 404 });
	// A font may go even when it is used (coach 23 Nov, force=1 after the creator was told in red where): what used it shows
	// the standard font from then on (the preview does at once; Make video: api/render). Pictures, clips and logos never go
	// while used: a Brand Kit would lose its logo and a project's Make video would stop (api/render).
	const force = new URL(request.url).searchParams.get("force") === "1" && card.kind === "font";
	if (!force) {
		const use = await whereUsed(user.id, id).catch(() => null);
		if (!use) return Response.json({ error: UNSURE }, { status: 503 });
		if (inUse(use)) return Response.json({ error: "It is still used", use }, { status: 409 });
	}
	await deleteObject(myFileKey(user.id, id));
	await deleteObject(myFileCardKey(user.id, id));
	return Response.json({ ok: true });
}

// Every Brand Kit pointing at `from` points at `to` instead (Replace). Their names, for the answer.
async function kitsToNewFile(userId: string, from: string, to: MyFile) {
	const key = `brand/${userId}.json`;
	const saved = await readKits(key);
	const moved: string[] = [];
	for (const kit of saved.kits) {
		const style = kit.style;
		let changed = false;
		if (style.logoImage && "file" in style.logoImage && style.logoImage.file === from) {
			style.logoImage = { file: to.id };
			changed = true;
		}
		if (style.font === "own" && style.ownFont?.file === from) {
			style.ownFont = asOwnFont(to);
			changed = true;
		}
		if (changed) moved.push(kit.name);
	}
	if (moved.length) await putObject(key, JSON.stringify({ ...saved, updatedAt: new Date().toISOString() }), "application/json");
	return moved;
}

// Every saved banner (My banners) with `from` as its own font uses `to` instead (Replace), as the kits do.
async function bannersToNewFile(userId: string, from: string, to: MyFile) {
	const saved = await getJson<{ templates?: NonNullable<Pins["banners"]> }>(bannersKey(userId));
	const templates = saved?.templates ?? [];
	let moved = 0;
	for (const b of templates) {
		if (b.font === "own" && b.ownFont?.file === from) {
			b.ownFont = asOwnFont(to);
			moved += 1;
		}
	}
	if (moved) await putObject(bannersKey(userId), JSON.stringify({ templates, updatedAt: new Date().toISOString() }), "application/json");
}

// Replace: the kits and saved banners move to the new file, then the old one goes if nothing (no project) uses it any
// more. Unsure where it is used: it stays.
async function swap(userId: string, old: MyFile, now: MyFile) {
	const kits = await kitsToNewFile(userId, old.id, now);
	if (now.kind === "font") await bannersToNewFile(userId, old.id, now);
	const use = await whereUsed(userId, old.id).catch(() => null);
	if (use && !inUse(use)) {
		await deleteObject(myFileKey(userId, old.id));
		await deleteObject(myFileCardKey(userId, old.id));
	}
	return kits;
}

// Own fonts per plan (coach 21 Nov: Free none, Starter 5, Pro 20). Fonts kept from a bigger plan stay in My files and in
// the projects that use them; only new uploads and new picks follow the plan (openFonts in lib/my-files-usage.ts).

// What the bytes are, if they are a file of this kind we can use: its content type, and a font's name and height.
function checkFile(kind: MyFileKind, bytes: Uint8Array) {
	if (kind === "logo") {
		const type = logoType(bytes);
		return type ? { type } : { error: "Please use a PNG, JPG or WebP picture" };
	}
	if (kind === "image") {
		const gif = String.fromCharCode(...bytes.subarray(0, 6));
		const type = logoType(bytes) ?? (gif === "GIF87a" || gif === "GIF89a" ? "image/gif" : null);
		return type ? { type } : { error: "Please use a JPG, PNG, WebP or GIF picture" };
	}
	if (kind === "video") return { error: "Clips go up in two steps (step=start, then step=done)" };
	const info = readFontInfo(bytes);
	if (!info) return { error: "This isn't a .ttf or .otf font we can use" };
	const otf = String.fromCharCode(...bytes.subarray(0, 4)) === "OTTO";
	return { type: otf ? "font/otf" : "font/ttf", family: info.family, height: info.height };
}

export async function POST(request: Request) {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	const params = new URL(request.url).searchParams;
	const kind = kindOf(params.get("kind"));
	if (!kind) return Response.json({ error: "Unknown kind" }, { status: 400 });
	if (kind === "video") return clipUpload(request, user.id, user.email, params);
	const then = params.get("then");
	const replaceId = params.get("replace");
	const replacing = replaceId && MY_FILE_ID.test(replaceId) ? await getJson<MyFile>(myFileCardKey(user.id, replaceId)) : null;
	if (replaceId && (!replacing || replacing.kind !== kind)) return Response.json({ error: "The file to replace is gone" }, { status: 404 });

	const limit = kind === "font" ? (await accessFor(user.email)).perks.fonts : null;
	if (limit === 0) return Response.json({ error: FONTS_LOCKED }, { status: 403 });
	const { maxBytes, label } = MY_FILE_KINDS[kind];
	const bytes = new Uint8Array(await request.arrayBuffer());
	if (!bytes.length || bytes.length > maxBytes) return Response.json({ error: `The ${label} must be ${maxBytes / 1024 / 1024} MB or smaller` }, { status: 400 });
	const checked = checkFile(kind, bytes);
	if ("error" in checked) return Response.json({ error: checked.error }, { status: 400 });
	const { type, ...font } = checked;
	if (replacing && (replacing.type === "image/gif") !== (type === "image/gif")) {
		return Response.json({ error: replacing.type === "image/gif" ? "Replace a GIF with another GIF." : "Replace a still picture with another still picture (JPG, PNG or WebP)." }, { status: 400 });
	}

	// This very file already: hand that one back, whatever it was called (nothing new stored, nothing asked).
	const id = await fileId(bytes);
	const cardKey = myFileCardKey(user.id, id);
	const before = await getJson<MyFile>(cardKey);
	if (before && replacing) return Response.json({ file: before, same: true, kits: before.id === replacing.id ? [] : await swap(user.id, replacing, before) });
	if (before) return Response.json({ file: before, same: true });
	const full = await uploadBlocked((await currentUser()).supabase, await accessFor(user.email), bytes.length);
	if (full) return Response.json({ error: full }, { status: 413 });

	// How many it may hold, checked before anything is written (agent review 21 Nov: Replace at the limit renamed the old
	// one, then failed). A Replace takes the old one's place, so it doesn't count as one more.
	let cards = await cardsOf(user.id, kind);
	const holding = cards.length - (replacing ? 1 : 0);
	if (limit !== null && holding >= limit) {
		return Response.json({ error: `You have ${holding} fonts, the most your plan holds (${limit}).${limit < 20 ? " Pro holds 20." : ""} Delete one in My files first.` }, { status: 403 });
	}
	const most = MAX_COUNT[kind];
	if (most !== undefined && holding >= most) return Response.json({ error: `You have ${holding} ${MY_FILE_KINDS[kind].label}s, the most My files holds. Delete some in My files first.` }, { status: 403 });

	// Another file with this name: the customer picks (never written over). Replace: it takes the old one's name and its
	// place in the order (openFonts counts the first uploaded), and the old one becomes "name (old)", last in the order.
	const now = new Date().toISOString();
	if (replacing) {
		const old = freeName(`${replacing.name.slice(0, 50)} (old)`, cards.map((c) => c.name));
		await putObject(myFileCardKey(user.id, replacing.id), JSON.stringify({ ...replacing, name: old, at: now }), "application/json");
		cards = cards.map((c) => (c.id === replacing.id ? { ...c, name: old } : c));
	}
	let name = replacing ? replacing.name : cleanFileName(params.get("name"), "family" in font && font.family ? font.family : "Logo");
	const clash = cards.find((c) => c.name.toLowerCase() === name.toLowerCase());
	if (clash && then === "use") return Response.json({ file: clash, same: true });
	if (clash && then !== "keep") return Response.json({ conflict: clash }, { status: 409 });
	if (clash) name = freeName(name, cards.map((c) => c.name));

	const clear = kind === "image" && params.get("clear") === "1" && type !== "image/jpeg" ? { clear: true } : {};
	const file: MyFile = { id, kind, name, type, size: bytes.length, at: replacing ? replacing.at : now, ...font, ...clear };
	await putIfAbsent(myFileKey(user.id, id), bytes, type); // false: the same bytes are there already, which is the same file
	if (!(await putIfAbsent(cardKey, JSON.stringify(file), "application/json"))) {
		return Response.json({ file: (await getJson<MyFile>(cardKey)) ?? file, same: true }); // uploaded twice at once
	}
	if (replacing) return Response.json({ file, kits: await swap(user.id, replacing, file) });
	return Response.json({ file });
}

// A clip (up to 150 MB) is too big to come through here, so it goes straight to R2 (as Import's did), in two steps:
//   POST ?kind=video&step=start  { id, name, size, type, seconds } → { uploadUrl, upload } (or { file, same } / 409 { conflict })
//   (the browser PUTs the file to uploadUrl: a place of its own in incoming/, never a file already in My files)
//   POST ?kind=video&step=done   { id, name, type, seconds, upload, then? } → { file }: it arrived, at that size, and is an
//     MP4 or MOV (its first bytes); then it is moved in and its card is written. A clip left in incoming/ (the page closed)
//     isn't listed or counted, and goes after a day (agent review 22 Nov).
// Its id comes from the browser (a sample of the file, lib/my-files-upload.ts): a Worker can't read 150 MB in time. A wrong
// one only ever touches that person's own files; once in, a clip is never written over (it is only moved in when absent).
const CLIP_UPLOAD_SECONDS = 1800;
const CLIP_TYPES: Record<string, true> = { "video/mp4": true, "video/quicktime": true };
const CLIP_HEADS = new Set(["ftyp", "moov", "mdat", "wide", "free", "skip"]); // an MP4 starts with ftyp; an old MOV may not
const DAY_MS = 24 * 3600 * 1000;
async function clipUpload(request: Request, userId: string, email: string | undefined, params: URLSearchParams) {
	const step = params.get("step");
	const body = (await request.json().catch(() => ({}))) as { id?: unknown; name?: unknown; size?: unknown; type?: unknown; seconds?: unknown; then?: unknown; upload?: unknown };
	const id = typeof body.id === "string" && MY_FILE_ID.test(body.id) ? body.id : null;
	if (!id) return Response.json({ error: "Unknown file" }, { status: 400 });
	const type = typeof body.type === "string" && CLIP_TYPES[body.type] ? body.type : "video/mp4";
	const cardKey = myFileCardKey(userId, id);
	const before = await getJson<MyFile>(cardKey);
	if (before) return Response.json({ file: before, same: true });
	const cards = await cardsOf(userId, "video");
	let name = cleanFileName(body.name, "Clip");
	const clash = cards.find((c) => c.name.toLowerCase() === name.toLowerCase());
	if (clash && body.then === "use") return Response.json({ file: clash, same: true });
	if (clash && body.then !== "keep") return Response.json({ conflict: clash }, { status: 409 });
	if (clash) name = freeName(name, cards.map((c) => c.name));
	const { maxBytes } = MY_FILE_KINDS.video;
	if (cards.length >= (MAX_COUNT.video ?? Infinity)) return Response.json({ error: `You have ${cards.length} clips, the most My files holds. Delete some in My files first.` }, { status: 403 });

	if (step === "start") {
		const size = Number(body.size);
		if (!Number.isInteger(size) || size <= 0 || size > maxBytes) return Response.json({ error: `Clips can be up to ${maxBytes / 1_000_000} MB.` }, { status: 400 });
		const full = await uploadBlocked((await currentUser()).supabase, await accessFor(email), size);
		if (full) return Response.json({ error: full, storageFull: true }, { status: 413 });
		// Clips left on the way up more than a day ago go now.
		const stale = (await listObjects(myIncomingPrefix(userId))).filter((o) => Date.now() - new Date(o.lastModified).getTime() > DAY_MS);
		await Promise.all(stale.map((o) => deleteObject(o.key)));
		const upload = crypto.randomUUID();
		return Response.json({ upload, uploadUrl: await signedUrl(`${myIncomingPrefix(userId)}${id}-${upload}`, "PUT", CLIP_UPLOAD_SECONDS, type, undefined, size) });
	}
	if (step !== "done") return Response.json({ error: "Unknown step" }, { status: 400 });
	const upload = typeof body.upload === "string" && /^[0-9a-f-]{36}$/.test(body.upload) ? body.upload : null;
	if (!upload) return Response.json({ error: "Unknown upload" }, { status: 400 });
	const incoming = `${myIncomingPrefix(userId)}${id}-${upload}`;
	const there = (await listObjects(incoming)).find((o) => o.key === incoming);
	if (!there) return Response.json({ error: "The upload didn't arrive. Please try again." }, { status: 409 });
	const head = await fetchObject(incoming, "bytes=0-15");
	const first = new Uint8Array(await head.arrayBuffer());
	if (!CLIP_HEADS.has(String.fromCharCode(...first.subarray(4, 8))) || there.size > maxBytes) {
		await deleteObject(incoming);
		return Response.json({ error: "That isn't an MP4 or MOV clip we can use." }, { status: 400 });
	}
	// Moved in only when no file has this id yet (the same id is the same clip): never written over.
	if (!(await exists(myFileKey(userId, id)))) await copyObject(incoming, myFileKey(userId, id));
	await deleteObject(incoming);
	const seconds = Number(body.seconds);
	const file: MyFile = { id, kind: "video", name, type, size: there.size, at: new Date().toISOString(), ...(Number.isFinite(seconds) && seconds > 0 && { seconds: Math.round(seconds * 100) / 100 }) };
	if (!(await putIfAbsent(cardKey, JSON.stringify(file), "application/json"))) return Response.json({ file: (await getJson<MyFile>(cardKey)) ?? file, same: true });
	return Response.json({ file });
}
