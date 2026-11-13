import { MAX_FIX_LENGTH, normText } from "@/lib/edit";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { addSharedFix, changeCurated, shareable, sharesWords } from "@/lib/shared-words";
import { currentUser, isAdmin } from "@/lib/supabase/server";
import { realThaiWords } from "@/lib/word-check";
import { wordUse } from "@/lib/word-rules";

// The signed-in user's personal dictionary (table word_fixes, see supabase/migrations/002):
//   GET     every word they have fixed, newest first, each with `use` (lib/word-rules.ts): always = put on every
//           match of a new video, ai = only where the spelling AI finds the sentence fits, off = not used
//   POST    { heard, fixed }  learn a fix (again: counts up `uses`), and give it to Komoray's shared list if they said
//           yes to that on My words (lib/shared-words.ts: anonymous, ordinary words only)
//   PATCH   { heard, fixed }  change what a word is fixed to (from the My words page)
//   DELETE  { heard }         forget one (they put the original words back)
// The database only lets each user see and change their own rows.
const MAX_WORDS = 5000;

async function signedIn() {
	const { supabase, user } = await currentUser();
	return user ? supabase : null;
}

export async function GET() {
	const supabase = await signedIn();
	if (!supabase) return Response.json({ error: "Please sign in" }, { status: 401 });
	const { data, error } = await supabase.from("word_fixes").select("heard, fixed, uses, updated_at").order("updated_at", { ascending: false }).limit(MAX_WORDS);
	if (error) return Response.json({ error: error.message }, { status: 500 });
	return Response.json({ words: (data ?? []).map((w) => ({ ...w, use: wordUse(w.heard, w.fixed, { realWords: realThaiWords }) })) });
}

export async function POST(request: Request) {
	const { supabase, user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	const body = (await request.json().catch(() => ({}))) as { heard?: unknown; fixed?: unknown };
	const heard = normText(String(body.heard ?? "")).slice(0, MAX_FIX_LENGTH);
	const fixed = String(body.fixed ?? "").trim().slice(0, MAX_FIX_LENGTH);
	if (!heard || !fixed || normText(fixed) === heard) return Response.json({ error: "Nothing to learn" }, { status: 400 });
	// Spacing, words put in or taken out: they belong to one video (the page doesn't send them; an older tab might).
	const use = wordUse(heard, fixed, { realWords: realThaiWords });
	if (use === "off") return Response.json({ error: "That fix stays in its video" }, { status: 400 });

	const { data: before } = await supabase.from("word_fixes").select("uses").eq("heard", heard).maybeSingle();
	const { error } = await supabase
		.from("word_fixes")
		.upsert({ heard, fixed, uses: (before?.uses ?? 0) + 1, updated_at: new Date().toISOString() }, { onConflict: "user_id,heard" });
	if (error) return Response.json({ error: error.message }, { status: 500 });
	// The admin's own fixes build Komoray's own word list (lib/shared-words.ts), ordinary words only: a name or brand
	// the admin fixes stays in their My words. Pairs can be removed on the admin page.
	const lang = isAdmin(user.email) ? shareable(heard, fixed) : null;
	if (lang) await changeCurated(lang, [{ heard, fixed }]).catch((err) => console.error("Komoray words failed:", err));
	if (await sharesWords(user.id)) {
		const { RENDER_TOKEN } = getCloudflareContext().env as unknown as { RENDER_TOKEN: string };
		await addSharedFix(user.id, RENDER_TOKEN, heard, fixed).catch((err) => console.error("Shared word failed:", err));
	}
	return Response.json({ ok: true });
}

export async function PATCH(request: Request) {
	const supabase = await signedIn();
	if (!supabase) return Response.json({ error: "Please sign in" }, { status: 401 });
	const body = (await request.json().catch(() => ({}))) as { heard?: unknown; fixed?: unknown };
	const heard = normText(String(body.heard ?? ""));
	const fixed = String(body.fixed ?? "").trim().slice(0, MAX_FIX_LENGTH);
	if (!heard || !fixed) return Response.json({ error: "Type the word" }, { status: 400 });
	const { error } = await supabase.from("word_fixes").update({ fixed, updated_at: new Date().toISOString() }).eq("heard", heard);
	if (error) return Response.json({ error: error.message }, { status: 500 });
	return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
	const supabase = await signedIn();
	if (!supabase) return Response.json({ error: "Please sign in" }, { status: 401 });
	const body = (await request.json().catch(() => ({}))) as { heard?: unknown };
	const heard = normText(String(body.heard ?? ""));
	if (!heard) return Response.json({ error: "Which word?" }, { status: 400 });
	const { error } = await supabase.from("word_fixes").delete().eq("heard", heard);
	if (error) return Response.json({ error: error.message }, { status: 500 });
	return Response.json({ ok: true });
}
