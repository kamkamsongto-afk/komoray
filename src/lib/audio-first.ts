import { refundListen } from "@/lib/access";
import { DEEPGRAM_MAX_BYTES } from "@/lib/limits";
import { signedCallbackUrl } from "@/lib/callback";
import { startTranscription } from "@/lib/transcribe";
import { deleteObject, exists, getJson, objectSize, putIfAbsent, putObject, siblingKey, signedUrl } from "@/lib/r2";

// Speech-to-text hears the video's sound, taken out on the picture's clock (coach 28 Nov, VID20261126143707): phone files
// start their sound after the picture (366 ms on that clip), and Deepgram given the video itself counted from the first
// sound, so every word, subtitle and cut came that much early. Every video, whatever its size:
//   1. POST /api/analyze writes analyze.json with audioFirst (big: over Deepgram's 2 GB) and asks Modal for the sound
//   2. Modal (kind "audio" in render.py) reads the video from its link and writes audio.flac (mono, 16 kHz, lossless, on the
//      picture's clock like proxy-audio.pcm) or audio-error.json, then calls /api/analyze/sound-ready
//   3. that call starts Deepgram on the sound (continueAudioFirst), page open or not; the page's status asks do the same,
//      should the call get lost. deepgram-started.json is written first with putIfAbsent, so two at once can't start (and
//      pay for) Deepgram twice. The callback then removes audio.flac.
// No sound that way (Modal out of reach, ffmpeg failed, nothing after SMALL_WAIT_MS): a video Deepgram can take goes to it
// as it is, as before 28 Nov, so a script still comes. Its times may then run early: analyze.json says soundFallback.
export const AUDIO_FILE = "audio.flac";
const LINK_SECONDS = 3 * 3600;
const GIVE_UP_MS = 90 * 60 * 1000; // a big video: no sound after this long, Modal died quietly (its job may run 60 minutes)
const SMALL_WAIT_MS = 10 * 60 * 1000; // a video Deepgram can take itself: waited for this long, then sent as it is

type Env = { DEEPGRAM_API_KEY: string; RENDER_TOKEN: string; RENDER_URL: string };

export const tooBigForDeepgram = async (key: string) => (await objectSize(key)) > DEEPGRAM_MAX_BYTES;

// Ask Modal for the sound. Throws if Modal can't be reached.
async function askForSound(key: string, requestUrl: string, env: Env) {
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
			readyUrl: await signedCallbackUrl(new URL("/api/analyze/sound-ready", requestUrl).toString(), key, env.RENDER_TOKEN),
		}),
	});
	const data = (await res.json().catch(() => ({}))) as { callId?: string; error?: string };
	if (!res.ok || !data.callId) throw new Error(data.error ?? `Could not start taking out the sound (${res.status})`);
}

// What analyze.json holds. big missing: written before 28 Nov, when only big videos went this way.
export type Started = { audioFirst?: boolean; big?: boolean; language?: string; usageKey?: string; startedAt?: string; soundFallback?: string };

// Starts Deepgram on one file of this video: its sound, or (the fallback) the video itself.
async function listenTo(file: string, key: string, requestUrl: string, env: Env, language?: string) {
	const callbackUrl = await signedCallbackUrl(new URL("/api/analyze/callback", requestUrl).toString(), key, env.RENDER_TOKEN);
	// Deepgram downloads the file itself through a temporary read-only link.
	await startTranscription(await signedUrl(file, "GET", LINK_SECONDS), env.DEEPGRAM_API_KEY, language || "en", callbackUrl);
}

// The video itself goes to Deepgram, as before 28 Nov, and analyze.json keeps why.
async function listenToVideo(key: string, requestUrl: string, env: Env, started: Started, why: string) {
	console.error(`Speech-to-text got the video itself, its times may run early: ${why.slice(0, 200)}`);
	await putObject(siblingKey(key, "analyze.json"), JSON.stringify({ ...started, soundFallback: why.slice(0, 200) }), "application/json").catch(() => {});
	await listenTo(key, key, requestUrl, env, started.language);
}

const startedMark = (key: string) => putIfAbsent(siblingKey(key, "deepgram-started.json"), JSON.stringify({ at: new Date().toISOString() }), "application/json");

// A new listen, its analyze.json written: asks Modal for the sound. Throws when a big video can't be started.
export async function startOnSound(key: string, requestUrl: string, env: Env, started: Started) {
	try {
		await askForSound(key, requestUrl, env);
	} catch (err) {
		if (started.big) throw err;
		if (await startedMark(key)) await listenToVideo(key, requestUrl, env, started, err instanceof Error ? err.message : "Modal could not be reached");
	}
}

// Called when Modal says the sound is out (api/analyze/sound-ready), and on every status ask while no cut list is there
// yet: starts Deepgram once the sound is ready, or records why it can't.
export async function continueAudioFirst(key: string, requestUrl: string, env: Env) {
	const started = await getJson<Started>(siblingKey(key, "analyze.json"));
	if (!started?.audioFirst) return;
	const [done, failed, going] = await Promise.all(["edit.json", "analyze-error.json", "deepgram-started.json"].map((name) => exists(siblingKey(key, name))));
	// The script is there already (Deepgram got the video after a long wait): a sound that came after it goes.
	if (done) return void (await deleteObject(siblingKey(key, AUDIO_FILE)).catch(() => {}));
	// failed: its minutes are back, so nothing more is paid for it (the review, 28 Nov).
	if (failed || going) return;
	const fail = async (error: string) => {
		await putObject(siblingKey(key, "analyze-error.json"), JSON.stringify({ error, at: new Date().toISOString() }), "application/json").catch(() => {});
		if (started.usageKey) await refundListen(key, started.usageKey).catch(() => {});
	};
	const big = started.big !== false;
	const broken = await getJson<{ error?: string }>(siblingKey(key, "audio-error.json"));
	let trouble = broken ? `Taking the sound out of the video failed: ${(broken.error ?? "").slice(0, 160)}` : "";
	if (!trouble && !(await exists(siblingKey(key, AUDIO_FILE)))) {
		if (!started.startedAt || Date.now() - Date.parse(started.startedAt) <= (big ? GIVE_UP_MS : SMALL_WAIT_MS)) return;
		trouble = "Taking the sound out of the video took too long and stopped. Your minutes are back. Please try again.";
	}
	// Whoever writes this first starts Deepgram; the others do nothing.
	if (!(await startedMark(key))) return;
	try {
		if (!trouble) await listenTo(siblingKey(key, AUDIO_FILE), key, requestUrl, env, started.language);
		else if (big) await fail(trouble);
		else await listenToVideo(key, requestUrl, env, started, trouble);
	} catch (err) {
		await fail(err instanceof Error ? err.message : "Analysis failed");
	}
}
