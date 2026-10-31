import { MAX_FIX_LENGTH, normText } from "@/lib/edit";
import { currentUser } from "@/lib/supabase/server";

// The signed-in user's personal dictionary (table word_fixes, see supabase/migrations/002):
//   GET     every word they have fixed, newest first
//   POST    { heard, fixed }  learn a fix (again: counts up `uses`)
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
	return Response.json({ words: data });
}

export async function POST(request: Request) {
	const supabase = await signedIn();
	if (!supabase) return Response.json({ error: "Please sign in" }, { status: 401 });
	const body = (await request.json().catch(() => ({}))) as { heard?: unknown; fixed?: unknown };
	const heard = normText(String(body.heard ?? "")).slice(0, MAX_FIX_LENGTH);
	const fixed = String(body.fixed ?? "").trim().slice(0, MAX_FIX_LENGTH);
	if (!heard || !fixed || normText(fixed) === heard) return Response.json({ error: "Nothing to learn" }, { status: 400 });

	const { data: before } = await supabase.from("word_fixes").select("uses").eq("heard", heard).maybeSingle();
	const { error } = await supabase
		.from("word_fixes")
		.upsert({ heard, fixed, uses: (before?.uses ?? 0) + 1, updated_at: new Date().toISOString() }, { onConflict: "user_id,heard" });
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
