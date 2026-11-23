import { refundListen } from "@/lib/access";
import { DEEPGRAM_MAX_BYTES } from "@/lib/limits";
import { signedCallbackUrl } from "@/lib/callback";
import { startTranscription } from "@/lib/transcribe";
import { deleteObject, exists, getJson, objectSize, putIfAbsent, putObject, siblingKey, signedUrl } from "@/lib/r2";

// A video over Deepgram's 2 GB (coach 22 Nov: heavy creators make 2-hour files) goes to Deepgram as its sound alone:
//   1. POST /api/analyze sees the file is over DEEPGRAM_MAX_BYTES, writes analyze.json with audioFirst and asks Modal for the sound
//   2. Modal (kind "audio" in render.py) reads the video straight from its link and writes audio.flac (mono, 16 kHz, lossless)
//      or audio-error.json
//   3. the page keeps asking GET /api/analyze; the first ask that finds audio.flac there starts Deepgram on it (continueAudioFirst).
//      deepgram-started.json is written first with putIfAbsent, so two asks at once can't start (and pay for) Deepgram twice
// Everything after (the callback, the cut list) is as for a small video. Videos under the limit are sent as they always were.
export const AUDIO_FILE = "audio.flac";
const LINK_SECONDS = 3 * 3600;
const GIVE_UP_MS = 90 * 60 * 1000; // no sound after this long: Modal died quietly (its job may run 60 minutes)

type Env = { DEEPGRAM_API_KEY: string; RENDER_TOKEN: string; RENDER_URL: string };

export const needsAudioFirst = async (key: string) => (await objectSize(key)) > DEEPGRAM_MAX_BYTES;

// Ask Modal for the sound. Throws if Modal can't be reached.
export async function startAudio(key: string, env: Pick<Env, "RENDER_TOKEN" | "RENDER_URL">) {
	await deleteObject(siblingKey(key, "audio-error.json")).catch(() => {});
	const res = await fetch(env.RENDER_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			token: env.RENDER_TOKEN,
			kind: "audio",
			// Modal only ever gets these one-file, time-limited links, never our R2 keys.
			videoUrl: await signedUrl(key, "GET", LINK_SECONDS),
			outputUrl: await signedUrl(siblingKey(key, AUDIO_FILE), "PUT", LINK_SECONDS, "audio/flac"),
			errorUrl: await signedUrl(siblingKey(key, "audio-error.json"), "PUT", LINK_SECONDS, "application/json"),
		}),
	});
	const data = (await res.json().catch(() => ({}))) as { callId?: string; error?: string };
	if (!res.ok || !data.callId) throw new Error(data.error ?? `Could not start taking out the sound (${res.status})`);
}

type Started = { audioFirst?: boolean; language?: string; usageKey?: string; startedAt?: string };

// Called on every status ask while no cut list is there yet: starts Deepgram once the sound is ready, or records why it can't.
export async function continueAudioFirst(key: string, requestUrl: string, env: Env) {
	const started = await getJson<Started>(siblingKey(key, "analyze.json"));
	if (!started?.audioFirst || (await exists(siblingKey(key, "deepgram-started.json")))) return;
	const fail = async (error: string) => {
		await putObject(siblingKey(key, "analyze-error.json"), JSON.stringify({ error, at: new Date().toISOString() }), "application/json").catch(() => {});
		if (started.usageKey) await refundListen(key, started.usageKey).catch(() => {});
	};
	const broken = await getJson<{ error?: string }>(siblingKey(key, "audio-error.json"));
	if (broken) return void (await fail(`Taking the sound out of the video failed: ${(broken.error ?? "").slice(0, 160)}`));
	if (!(await exists(siblingKey(key, AUDIO_FILE)))) {
		if (started.startedAt && Date.now() - Date.parse(started.startedAt) > GIVE_UP_MS) await fail("Taking the sound out of the video took too long and stopped. Your minutes are back. Please try again.");
		return;
	}
	// Whoever writes this first starts Deepgram; the others do nothing.
	if (!(await putIfAbsent(siblingKey(key, "deepgram-started.json"), JSON.stringify({ at: new Date().toISOString() }), "application/json"))) return;
	try {
		const callbackUrl = await signedCallbackUrl(new URL("/api/analyze/callback", requestUrl).toString(), key, env.RENDER_TOKEN);
		await startTranscription(await signedUrl(siblingKey(key, AUDIO_FILE), "GET", LINK_SECONDS), env.DEEPGRAM_API_KEY, started.language || "en", callbackUrl);
	} catch (err) {
		await fail(err instanceof Error ? err.message : "Analysis failed");
	}
}
