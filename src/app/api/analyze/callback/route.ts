import { getCloudflareContext } from "@opennextjs/cloudflare";
import { refundListen } from "@/lib/access";
import { AUDIO_FILE } from "@/lib/audio-first";
import { verifyCallback } from "@/lib/callback";
import { deleteObject, getJson, putObject, siblingKey, VIDEO_KEY } from "@/lib/r2";
import {
	findSilences,
	MIN_SILENCE,
	PADDING,
	trimStretchedWords,
	WORD_BASE_SECONDS,
	WORD_SECONDS_PER_LETTER,
} from "@/lib/silences";
import { isLanguage } from "@/lib/languages";
import { mergeThaiNumbers } from "@/lib/thai-numbers";
import { mendAcrossPause, mergeThaiWords } from "@/lib/thai-words";
import { readTranscript } from "@/lib/transcribe";
import { readOptions } from "@/lib/upload-options";

// Deepgram POSTs the transcript here when it is done. We turn it into edit.json.
export async function POST(request: Request) {
	const params = new URL(request.url).searchParams;
	const key = params.get("key") ?? "";
	const sig = params.get("sig") ?? "";
	const env = getCloudflareContext().env as unknown as { RENDER_TOKEN: string };
	if (!VIDEO_KEY.test(key) || !(await verifyCallback(key, sig, env.RENDER_TOKEN))) {
		return Response.json({ error: "unauthorized" }, { status: 401 });
	}

	try {
		const transcript = readTranscript(await request.json());
		// Trimmed words feed both the cuts and the subtitle timing in edit.json.
		// Deepgram's Thai comes in pieces of words; the script works on whole words. Silences are found between whole
		// words, so a word is never cut through (a piece "่วน" after a pause is still part of "ส่วน", lib/thai-words.ts).
		// Numbers said in words ("สามสิบ") become digits (lib/thai-numbers.ts), after the pieces are whole words.
		// Which pieces are one word is judged on the times as heard; the shortened times are what is kept (lib/thai-words.ts).
		// First a letter that came on the wrong side of a long pause goes back to its word (mendAcrossPause).
		const heard = mendAcrossPause(transcript.words);
		const words = mergeThaiNumbers(mergeThaiWords(heard, trimStretchedWords(heard)));
		// What the creator asked for when uploading (none on videos from before): the editor uses it once.
		const asked = await getJson<{ options?: unknown; language?: unknown }>(siblingKey(key, "analyze.json")).catch(() => null);
		const options = readOptions(asked?.options);
		// The language it was listened in: Komoray's word list is kept per language (lib/shared-words.ts).
		const said = asked?.language;
		const language = isLanguage(said) ? said : undefined;
		const edit = {
			source: key,
			duration: transcript.duration,
			rules: {
				minSilence: MIN_SILENCE,
				padding: PADDING,
				wordBaseSeconds: WORD_BASE_SECONDS,
				wordSecondsPerLetter: WORD_SECONDS_PER_LETTER,
			},
			// Silences unticked: nothing cut. Pace in the editor finds them if they change their mind.
			cuts: options?.silences === false ? [] : findSilences({ duration: transcript.duration, words }),
			words,
			wordsJoined: true,
			// The AI fixes the speech-to-text's spelling once, when the AI studio first opens (api/spelling).
			// Only on videos from now on: older ones were already fixed by hand.
			spellingWanted: true,
			...(options && { options }),
			...(language && { language }),
		};
		await putObject(siblingKey(key, "edit.json"), JSON.stringify(edit, null, 2), "application/json");
		// The sound speech-to-text was given has done its work (it would count against their storage).
		await deleteObject(siblingKey(key, AUDIO_FILE)).catch(() => {});
	} catch (err) {
		const error = err instanceof Error ? err.message : "Analysis failed";
		await putObject(siblingKey(key, "analyze-error.json"), JSON.stringify({ error, at: new Date().toISOString() }), "application/json");
		// A failed job takes no minutes.
		const started = await getJson<{ usageKey?: string }>(siblingKey(key, "analyze.json")).catch(() => null);
		if (started?.usageKey) await refundListen(key, started.usageKey).catch(() => {});
	}
	// Always 200 so Deepgram doesn't keep retrying a result we already handled.
	return Response.json({ ok: true });
}
