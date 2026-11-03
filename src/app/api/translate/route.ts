import { getCloudflareContext } from "@opennextjs/cloudflare";
import { allCuts, type Fix, fixedWords, type HandEdits } from "@/lib/edit";
import { translationName } from "@/lib/languages";
import { getJson, putObject, siblingKey, VIDEO_KEY } from "@/lib/r2";
import { readStyle } from "@/lib/subtitle-style";
import { ownsVideo } from "@/lib/supabase/server";
import { keepSegments, subtitleLines, toSrt } from "@/lib/timeline";
import { translateLines } from "@/lib/translate";

// One call translates the next BATCH lines of the final video's subtitles and answers how many are left;
// the page calls again until none are, then gets the .srt. A long video can't outlast one request, and
// what's done is kept in translation-<language>.json, so a small edit only pays for the lines it changed.
const BATCH = 40;
const CONTEXT_LINES = 5;

export async function POST(request: Request) {
	const { key, language } = (await request.json()) as { key?: string; language?: string };
	if (!key || !VIDEO_KEY.test(key) || !(await ownsVideo(key))) return Response.json({ error: "Unknown video" }, { status: 404 });
	const languageName = language ? translationName(language) : undefined;
	if (!languageName) return Response.json({ error: "Unknown language" }, { status: 400 });

	const apiKey = (getCloudflareContext().env as unknown as { ANTHROPIC_API_KEY?: string }).ANTHROPIC_API_KEY;
	if (!apiKey) return Response.json({ error: "Translation is not set up yet" }, { status: 503 });

	const edit = await getJson<{
		duration: number;
		cuts: { start: number; end: number }[];
		words: { text: string; start: number; end: number }[];
		deleted?: number[];
		fixes?: Fix[];
		style?: unknown;
	} & HandEdits>(siblingKey(key, "edit.json"));
	if (!edit) return Response.json({ error: "Find silences first" }, { status: 400 });

	const style = readStyle(edit.style);
	const lines = subtitleLines(fixedWords(edit.words, edit.fixes), keepSegments(edit.duration, allCuts(edit)), style.look, style.size);
	const texts = lines.map((l) => l.text.trim());

	const savedKey = siblingKey(key, `translation-${language}.json`);
	const saved = new Map(Object.entries((await getJson<Record<string, string>>(savedKey)) ?? {}));
	const missing = [...new Set(texts)].filter((t) => !saved.has(t));

	if (missing.length) {
		const batch = missing.slice(0, BATCH);
		const first = texts.indexOf(batch[0]);
		const earlier = texts.slice(Math.max(0, first - CONTEXT_LINES), first).map((line) => ({ line, translated: saved.get(line) ?? "" }));
		try {
			const translated = await translateLines(batch, languageName, earlier, apiKey);
			batch.forEach((text, i) => saved.set(text, translated[i]));
			await putObject(savedKey, JSON.stringify(Object.fromEntries(saved)), "application/json");
		} catch (error) {
			console.error("Translation failed:", error);
			return Response.json({ error: "The translation did not finish" }, { status: 502 });
		}
	}

	const remaining = missing.length - Math.min(missing.length, BATCH);
	const total = new Set(texts).size;
	if (remaining) return Response.json({ total, remaining });
	const srt = toSrt(lines.map((l, i) => ({ ...l, parts: [{ text: saved.get(texts[i]) ?? "", from: l.from }], row2: undefined })));
	return Response.json({ total, remaining: 0, srt });
}
