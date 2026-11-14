import { MAX_FIX_LENGTH, normText } from "@/lib/edit";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { addSharedFix, changeCurated, hubLang, listFor, sharesWords } from "@/lib/shared-words";
import { currentUser, isAdmin } from "@/lib/supabase/server";
import { realThaiWords } from "@/lib/word-check";
import { wordUse } from "@/lib/word-rules";

// The signed-in user's personal dictionary (table word_fixes, see supabase/migrations/002):
//   GET     every word they have fixed, newest first, each with `use` (lib/word-rules.ts): always = put on every
//           match of a new video, ai = only where the spelling AI finds the sentence fits, off = not used
//   POST    { heard, fixed, language? }  learn a fix (again: counts up `uses`), and give it to Komoray's shared list if they said
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
	const body = (await request.json().catch(() => ({}))) as { heard?: unknown; fixed?: unknown; language?: unknown };
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
	// The admin's own fixes go into Word Hub (Komoray's own list, lib/shared-words.ts) only when hubLang lets them: a
	// clear misspelling of ordinary words. The rest stays in their My words (coach, 13 Nov).
	const lang = isAdmin(user.email) ? hubLang(heard, fixed) : null;
	// Into the list of the video's language (lib/shared-words.ts listFor), "latin" when the video didn't keep it.
	if (lang) await changeCurated(listFor(lang, typeof body.language === "string" ? body.language : undefined), [{ heard, fixed }]).catch((err) => console.error("Komoray words failed:", err));
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
	// As POST: an edit that adds words or only changes spacing belongs to one video. Saved, it went to Not used, which
	// My words hides, so the word vanished with no way back (coach, 14 Nov). Not saved: the word stays as it was.
	if (wordUse(heard, fixed, { realWords: realThaiWords }) === "off")
		return Response.json({ error: "Here you can only change the fixed word. Adding words or changing spaces belongs in the script of that video." }, { status: 400 });
	const { error } = await supabase.from("word_fixes").update({ fixed, updated_at: new Date().toISOString() }).eq("heard", heard);
	if (error) return Response.json({ error: error.message }, { status: 500 });
	return Response.json({ ok: true });
}

const MAX_REMOVE = 500;

export async function DELETE(request: Request) {
	const supabase = await signedIn();
	if (!supabase) return Response.json({ error: "Please sign in" }, { status: 401 });
	// heard: one word; heards: several picked on My words at once (up to MAX_REMOVE). Only the user's own rows (RLS).
	const body = (await request.json().catch(() => ({}))) as { heard?: unknown; heards?: unknown };
	const list = Array.isArray(body.heards) ? body.heards.slice(0, MAX_REMOVE) : [body.heard];
	const heards = [...new Set(list.map((h) => normText(String(h ?? ""))).filter(Boolean))];
	if (!heards.length) return Response.json({ error: "Which word?" }, { status: 400 });
	const { error } = await supabase.from("word_fixes").delete().in("heard", heards);
	if (error) return Response.json({ error: error.message }, { status: 500 });
	return Response.json({ ok: true });
}
