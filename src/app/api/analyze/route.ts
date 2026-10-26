import { getCloudflareContext } from "@opennextjs/cloudflare";
import { putObject, signedUrl } from "@/lib/r2";
import { findSilences, MIN_SILENCE, PADDING } from "@/lib/silences";
import { transcribe } from "@/lib/transcribe";

// Finds the silent parts of an uploaded video and saves the cut list as edit.json next to it.
export async function POST(request: Request) {
	const { key, language } = (await request.json()) as { key?: string; language?: string };

	// Only files our upload page created: uploads/<id>/<name>
	if (!key || !/^uploads\/[0-9a-f-]{36}\/[a-zA-Z0-9._-]+$/.test(key)) {
		return Response.json({ error: "Unknown video" }, { status: 400 });
	}

	const env = getCloudflareContext().env as unknown as { DEEPGRAM_API_KEY: string };

	try {
		// Deepgram downloads the video itself through a temporary read-only link.
		const videoUrl = await signedUrl(key, "GET", 3600);
		const transcript = await transcribe(videoUrl, env.DEEPGRAM_API_KEY, language || "en");
		const cuts = findSilences(transcript);

		const edit = {
			source: key,
			duration: transcript.duration,
			rules: { minSilence: MIN_SILENCE, padding: PADDING },
			cuts,
			words: transcript.words,
		};
		const editKey = key.replace(/[^/]+$/, "edit.json");
		await putObject(editKey, JSON.stringify(edit, null, 2), "application/json");

		return Response.json({ editKey, ...edit });
	} catch (err) {
		return Response.json({ error: err instanceof Error ? err.message : "Analysis failed" }, { status: 502 });
	}
}
