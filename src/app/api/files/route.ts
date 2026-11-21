import { logoType } from "@/lib/logo";
import { cleanFileName, fileId, freeName, MY_FILE_ID, MY_FILE_KINDS, type MyFile, type MyFileKind, myFileCardKey, myFileKey, myFilesPrefix } from "@/lib/my-files";
import { fetchObject, getJson, listObjects, putIfAbsent } from "@/lib/r2";
import { currentUser } from "@/lib/supabase/server";

// My files (lib/my-files.ts): the signed-in person's own files, used again and again.
//   GET ?id=…                       the file itself (its bytes never change, so the browser may keep it)
//   GET ?kind=logo                  { files } of that kind, newest first
//   POST ?kind=logo&name=…[&then=]  the file as the body → { file, same? }
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
	return Response.json({ files: await cardsOf(user.id, kind) });
}

export async function POST(request: Request) {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	const params = new URL(request.url).searchParams;
	const kind = kindOf(params.get("kind"));
	if (!kind) return Response.json({ error: "Unknown kind" }, { status: 400 });
	const then = params.get("then");

	const bytes = new Uint8Array(await request.arrayBuffer());
	if (!bytes.length || bytes.length > MY_FILE_KINDS[kind].maxBytes) return Response.json({ error: "The logo must be 2 MB or smaller" }, { status: 400 });
	const type = logoType(bytes);
	if (!type) return Response.json({ error: "Please use a PNG, JPG or WebP picture" }, { status: 400 });

	// This very file already: hand that one back, whatever it was called (nothing new stored, nothing asked).
	const id = await fileId(bytes);
	const cardKey = myFileCardKey(user.id, id);
	const before = await getJson<MyFile>(cardKey);
	if (before) return Response.json({ file: before, same: true });

	// Another file with this name: the customer picks (never written over).
	const cards = await cardsOf(user.id, kind);
	let name = cleanFileName(params.get("name"), "Logo");
	const clash = cards.find((c) => c.name.toLowerCase() === name.toLowerCase());
	if (clash && then === "use") return Response.json({ file: clash, same: true });
	if (clash && then !== "keep") return Response.json({ conflict: clash }, { status: 409 });
	if (clash) name = freeName(name, cards.map((c) => c.name));

	const file: MyFile = { id, kind, name, type, size: bytes.length, at: new Date().toISOString() };
	await putIfAbsent(myFileKey(user.id, id), bytes, type); // false: the same bytes are there already, which is the same file
	if (!(await putIfAbsent(cardKey, JSON.stringify(file), "application/json"))) {
		return Response.json({ file: (await getJson<MyFile>(cardKey)) ?? file, same: true }); // uploaded twice at once
	}
	return Response.json({ file });
}
