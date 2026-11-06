import { isLanguage } from "@/lib/languages";
import { getJson, putObject } from "@/lib/r2";
import { currentUser } from "@/lib/supabase/server";

// The signed-in user's own settings, the same on every device: for now the spoken language they set as
// default in the upload window (components/LanguagePicker.tsx). Kept in R2 at prefs/<user id>.json
// (outside uploads/, so it is not deleted after 14 days).
//   GET  { language } (null if none set)
//   PUT  { language }  a code from lib/languages.ts, or null to clear it
type Prefs = { language?: string | null };
const prefsKey = (userId: string) => `prefs/${userId}.json`;

export async function GET() {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	const saved = await getJson<Prefs>(prefsKey(user.id));
	return Response.json({ language: isLanguage(saved?.language) ? saved.language : null });
}

export async function PUT(request: Request) {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	const { language } = (((await request.json().catch(() => null)) as Prefs | null) ?? {}) as Prefs;
	if (language !== null && !isLanguage(language)) return Response.json({ error: "We don't support that language yet" }, { status: 400 });
	const saved = (await getJson<Prefs>(prefsKey(user.id))) ?? {};
	await putObject(prefsKey(user.id), JSON.stringify({ ...saved, language, updatedAt: new Date().toISOString() }), "application/json");
	return Response.json({ language });
}
