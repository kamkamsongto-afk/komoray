import { accessFor } from "@/lib/access";
import { readFontInfo } from "@/lib/font-info";
import { logoType } from "@/lib/logo";
import { cleanFileName, fileId, freeName, MY_FILE_ID, MY_FILE_KINDS, type MyFile, type MyFileKind, myFileCardKey, myFileKey, myFilesPrefix } from "@/lib/my-files";
import { fetchObject, getJson, listObjects, putIfAbsent } from "@/lib/r2";
import { currentUser } from "@/lib/supabase/server";

// My files (lib/my-files.ts): the signed-in person's own files, used again and again.
//   GET ?id=…                       the file itself (its bytes never change, so the browser may keep it)
//   GET ?kind=logo|font             { files, limit } of that kind, newest first. limit: fonts the plan holds (null: no cap).
//   POST ?kind=…&name=…[&then=]     the file as the body → { file, same? }
//     same: this very file was already there (nothing new is stored).
//     409 { conflict }: another file of this kind has that name. Ask, then send again with
//     then=use (take that one, nothing stored) or then=keep (store this one as "name (2)").
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
	const kind = kindOf(params.get("kind"));
	if (!kind) return Response.json({ error: "Unknown kind" }, { status: 400 });
	const limit = kind === "font" ? (await accessFor(user.email)).perks.fonts : null;
	return Response.json({ files: await cardsOf(user.id, kind), limit });
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
	if (before) return Response.json({ file: before, same: true });

	// Another file with this name: the customer picks (never written over).
	const cards = await cardsOf(user.id, kind);
	let name = cleanFileName(params.get("name"), "family" in font && font.family ? font.family : "Logo");
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
	return Response.json({ file });
}
