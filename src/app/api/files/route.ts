import { accessFor } from "@/lib/access";
import { readFontInfo } from "@/lib/font-info";
import { logoType } from "@/lib/logo";
import { asOwnFont, cleanFileName, fileId, freeName, MY_FILE_ID, MY_FILE_KINDS, type MyFile, type MyFileKind, myFileCardKey, myFileKey, myFilesPrefix } from "@/lib/my-files";
import { readKits } from "@/lib/brand-kits";
import { filesUse, myFilesOf } from "@/lib/my-files-usage";
import { deleteObject, fetchObject, getJson, listObjects, putIfAbsent, putObject } from "@/lib/r2";
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

// Where each file is used now, read fresh from their kits and projects (lib/my-files-usage.ts).
async function whereAllUsed(userId: string) {
	const { supabase } = await currentUser();
	const { data } = await supabase.from("projects").select("id");
	return filesUse(userId, (data ?? []).map((r: { id: string }) => r.id));
}
const whereUsed = async (userId: string, id: string) => (await whereAllUsed(userId)).get(id) ?? { kits: [], projects: 0 };
const inUse = (u: { kits: string[]; projects: number }) => u.kits.length > 0 || u.projects > 0;

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
	if (!id || !MY_FILE_ID.test(id) || !(await getJson<MyFile>(myFileCardKey(user.id, id)))) return Response.json({ error: "That file is gone" }, { status: 404 });
	// Never one that is used: a Brand Kit would lose its logo or font, and a project's Make video would stop (api/render).
	const use = await whereUsed(user.id, id);
	if (inUse(use)) return Response.json({ error: "It is still used", use }, { status: 409 });
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

// Replace: the kits move to the new file, then the old one goes if nothing (no project) uses it any more.
async function swap(userId: string, old: MyFile, now: MyFile) {
	const kits = await kitsToNewFile(userId, old.id, now);
	if (!inUse(await whereUsed(userId, old.id))) {
		await deleteObject(myFileKey(userId, old.id));
		await deleteObject(myFileCardKey(userId, old.id));
	}
	return kits;
}

// Own fonts per plan (coach 21 Nov: Free none, Starter 5, Pro 20). Fonts kept from a bigger plan stay in My files and in
// the projects that use them; only new uploads and new picks follow the plan (fontsUsable).
const FONTS_LOCKED = "Your own fonts come with Starter and Pro. Upgrade on the Pricing page.";

// What the bytes are, if they are a file of this kind we can use: its content type, and a font's name and height.
function checkFile(kind: MyFileKind, bytes: Uint8Array) {
	if (kind === "logo") {
		const type = logoType(bytes);
		return type ? { type } : { error: "Please use a PNG, JPG or WebP picture" };
	}
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

	// This very file already: hand that one back, whatever it was called (nothing new stored, nothing asked).
	const id = await fileId(bytes);
	const cardKey = myFileCardKey(user.id, id);
	const before = await getJson<MyFile>(cardKey);
	if (before && replacing) return Response.json({ file: before, same: true, kits: before.id === replacing.id ? [] : await swap(user.id, replacing, before) });
	if (before) return Response.json({ file: before, same: true });
	const full = await uploadBlocked((await currentUser()).supabase, await accessFor(user.email), bytes.length);
	if (full) return Response.json({ error: full }, { status: 413 });

	// Another file with this name: the customer picks (never written over). Replace: it takes the old one's name.
	let cards = await cardsOf(user.id, kind);
	if (replacing) {
		const old = freeName(`${replacing.name.slice(0, 50)} (old)`, cards.map((c) => c.name));
		await putObject(myFileCardKey(user.id, replacing.id), JSON.stringify({ ...replacing, name: old }), "application/json");
		cards = cards.map((c) => (c.id === replacing.id ? { ...c, name: old } : c));
	}
	let name = replacing ? replacing.name : cleanFileName(params.get("name"), "family" in font && font.family ? font.family : "Logo");
	const clash = cards.find((c) => c.name.toLowerCase() === name.toLowerCase());
	if (clash && then === "use") return Response.json({ file: clash, same: true });
	if (clash && then !== "keep") return Response.json({ conflict: clash }, { status: 409 });
	if (clash) name = freeName(name, cards.map((c) => c.name));
	if (limit !== null && cards.length >= limit) {
		return Response.json({ error: `You have ${cards.length} fonts, the most your plan holds (${limit}).${limit < 20 ? " Pro holds 20." : ""}` }, { status: 403 });
	}

	const file: MyFile = { id, kind, name, type, size: bytes.length, at: new Date().toISOString(), ...font };
	await putIfAbsent(myFileKey(user.id, id), bytes, type); // false: the same bytes are there already, which is the same file
	if (!(await putIfAbsent(cardKey, JSON.stringify(file), "application/json"))) {
		return Response.json({ file: (await getJson<MyFile>(cardKey)) ?? file, same: true }); // uploaded twice at once
	}
	if (replacing) return Response.json({ file, kits: await swap(user.id, replacing, file) });
	return Response.json({ file });
}
