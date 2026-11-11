import { isLanguage } from "@/lib/languages";
import { getJson, putObject } from "@/lib/r2";
import { currentUser } from "@/lib/supabase/server";

// The signed-in user's own settings, the same on every device: the spoken language they set as default in the
// upload window (components/LanguagePicker.tsx), and whether they give their word fixes to Komoray's shared list
// (lib/shared-words.ts, ticked on My words; off until they tick it). Kept in R2 at prefs/<user id>.json
// (outside uploads/, so it is not deleted after 14 days).
//   GET  { language, shareWords } (language null if none set)
//   PUT  { language } and/or { shareWords }: a code from lib/languages.ts or null to clear it; true / false
type Prefs = { language?: string | null; shareWords?: boolean; shareWordsAt?: string };
const prefsKey = (userId: string) => `prefs/${userId}.json`;

export async function GET() {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	const saved = await getJson<Prefs>(prefsKey(user.id));
	return Response.json({ language: isLanguage(saved?.language) ? saved.language : null, shareWords: saved?.shareWords === true });
}

export async function PUT(request: Request) {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	const body = (((await request.json().catch(() => null)) as Prefs | null) ?? {}) as Prefs;
	const { language, shareWords } = body;
	if (language !== undefined && language !== null && !isLanguage(language)) return Response.json({ error: "We don't support that language yet" }, { status: 400 });
	if (shareWords !== undefined && typeof shareWords !== "boolean") return Response.json({ error: "Bad setting" }, { status: 400 });
	const saved = (await getJson<Prefs>(prefsKey(user.id))) ?? {};
	const now = new Date().toISOString();
	const next: Prefs = {
		...saved,
		...(language !== undefined && { language }),
		// When they said yes or no, as a record of their choice.
		...(shareWords !== undefined && { shareWords, shareWordsAt: now }),
	};
	await putObject(prefsKey(user.id), JSON.stringify({ ...next, updatedAt: now }), "application/json");
	return Response.json({ language: next.language ?? null, shareWords: next.shareWords === true });
}
