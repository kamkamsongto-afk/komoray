import { getCloudflareContext } from "@opennextjs/cloudflare";
import { refundListen } from "@/lib/access";
import { verifyCallback } from "@/lib/callback";
import { getJson, putObject, siblingKey, VIDEO_KEY } from "@/lib/r2";
import {
	findSilences,
	MIN_SILENCE,
	PADDING,
	trimStretchedWords,
	WORD_BASE_SECONDS,
	WORD_SECONDS_PER_LETTER,
} from "@/lib/silences";
import { mergeThaiWords } from "@/lib/thai-words";
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
		const words = trimStretchedWords(transcript.words);
		// What the creator asked for when uploading (none on videos from before): the editor uses it once.
		const options = readOptions((await getJson<{ options?: unknown }>(siblingKey(key, "analyze.json")).catch(() => null))?.options);
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
			// Deepgram's Thai comes in pieces of words; the script works on whole words.
			words: mergeThaiWords(words),
			wordsJoined: true,
			...(options && { options }),
		};
		await putObject(siblingKey(key, "edit.json"), JSON.stringify(edit, null, 2), "application/json");
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
