import { logoKey, logoVersion } from "@/lib/logo";
import { fetchObject } from "@/lib/r2";
import { currentUser } from "@/lib/supabase/server";

// The signed-in user's logo picture (lib/logo.ts).
//   GET ?v=          that version's own picture, for the preview (404 when it has no file: never another picture)
// New logos go to My files (api/files, from 21 Nov); this only reads the ones uploaded before.
export async function GET(request: Request) {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	// That version's own picture and nothing else (lib/logo.ts). Not found is said with no-store, so the browser asks again.
	const version = logoVersion(Number(new URL(request.url).searchParams.get("v")));
	const res = version ? await fetchObject(logoKey(user.id, version)) : null;
	if (!res?.ok) {
		await res?.body?.cancel(); // the 404 is not read
		return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
	}
	const type = res.headers.get("Content-Type") ?? "image/png";
	return new Response(res.body, { headers: { "Content-Type": type, "Cache-Control": "private, max-age=31536000, immutable" } });
}
