import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyCallback } from "@/lib/callback";
import { putObject, siblingKey, VIDEO_KEY } from "@/lib/r2";
import {
	findSilences,
	MIN_SILENCE,
	PADDING,
	trimStretchedWords,
	WORD_BASE_SECONDS,
	WORD_SECONDS_PER_LETTER,
} from "@/lib/silences";
import { readTranscript } from "@/lib/transcribe";

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
		const edit = {
			source: key,
			duration: transcript.duration,
			rules: {
				minSilence: MIN_SILENCE,
				padding: PADDING,
				wordBaseSeconds: WORD_BASE_SECONDS,
				wordSecondsPerLetter: WORD_SECONDS_PER_LETTER,
			},
			cuts: findSilences({ duration: transcript.duration, words }),
			words,
		};
		await putObject(siblingKey(key, "edit.json"), JSON.stringify(edit, null, 2), "application/json");
	} catch (err) {
		const error = err instanceof Error ? err.message : "Analysis failed";
		await putObject(siblingKey(key, "analyze-error.json"), JSON.stringify({ error, at: new Date().toISOString() }), "application/json");
	}
	// Always 200 so Deepgram doesn't keep retrying a result we already handled.
	return Response.json({ ok: true });
}
