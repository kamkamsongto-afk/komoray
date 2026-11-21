import { fontKeys, type OwnFont } from "@/lib/font-info";
import { fetchObject, getJson } from "@/lib/r2";
import { currentUser } from "@/lib/supabase/server";

// The one own font per account from before My files (21 Nov), at fonts/<user id>/font and font.json. Read only now:
// new fonts go to My files (api/files), each its own file, so this one is never written over again.
//   GET              { font: { family, height, version } | null }
//   GET ?file=1      the font file itself, for the preview of projects that still use it
export async function GET(request: Request) {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	const keys = fontKeys(user.id);
	if (new URL(request.url).searchParams.has("file")) {
		const res = await fetchObject(keys.file);
		if (!res.ok) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
		// Never kept by the browser: the final video reads this same file as it is now (api/render), so the preview must too
		// (21 Nov: a copy kept from an older upload under the same address showed one font while the video got another).
		return new Response(res.body, { headers: { "Content-Type": "font/ttf", "Cache-Control": "no-store" } });
	}
	return Response.json({ font: await getJson<OwnFont>(keys.info) });
}
