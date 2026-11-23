import { getCloudflareContext } from "@opennextjs/cloudflare";
import { refundListen, settleDeadListen, startListening } from "@/lib/access";
import { currentUser, ownsVideo } from "@/lib/supabase/server";
import { signedCallbackUrl } from "@/lib/callback";
import { isLanguage } from "@/lib/languages";
import { CLEAN_SOUND, facesFor, mediaUrl, previewFiles, previewPercent, proxyStatus, proxyUrl, startProxy } from "@/lib/proxy";
import type { Faces } from "@/lib/framing";
import { deleteObject, exists, getJson, putObject, siblingKey, signedUrl, VIDEO_KEY } from "@/lib/r2";
import { mergeThaiEdit } from "@/lib/thai-words";
import { AUDIO_FILE, continueAudioFirst, needsAudioFirst, startAudio } from "@/lib/audio-first";
import { startTranscription } from "@/lib/transcribe";
import { readOptions } from "@/lib/upload-options";

// Finding silences lives in the video's folder:
//   analyze.json        written when we hand the video to Deepgram (with what the creator asked for: lib/upload-options.ts)
//   edit.json           written by the callback when the cut list is ready
//   analyze-error.json  written by the callback if speech-to-text failed
const LINK_SECONDS = 3 * 3600; // Deepgram may queue long videos for a while before downloading

type AnalyzeEnv = { DEEPGRAM_API_KEY: string; RENDER_TOKEN: string; RENDER_URL: string };
type EditFile = Parameters<typeof mergeThaiEdit>[0] & { wordsJoined?: boolean };

// Start finding the silences. Returns right away; the page then polls GET below.
export async function POST(request: Request) {
	const { key, language, options: asked } = (await request.json()) as { key?: string; language?: string; options?: unknown };
	if (!key || !VIDEO_KEY.test(key) || !(await ownsVideo(key))) return Response.json({ error: "Unknown video" }, { status: 404 });
	if (language !== undefined && !isLanguage(language)) return Response.json({ error: "We don't support that language yet" }, { status: 400 });

	// Deepgram can't reach a computer at home to deliver the result, so say so plainly.
	if (["localhost", "127.0.0.1"].includes(new URL(request.url).hostname)) {
		return Response.json({ error: "Find silences only works on komoray.com, not on localhost." }, { status: 400 });
	}

	const { user } = await currentUser();
	const listen = await startListening(key, user?.email);
	if ("error" in listen) return Response.json({ error: listen.error }, { status: listen.status });

	const env = getCloudflareContext().env as unknown as AnalyzeEnv;
	try {
		// Listening again (Wrong language?) sends no choices: the ones made the first time stay.
		const options = readOptions(asked) ?? readOptions((await getJson<{ options?: unknown }>(siblingKey(key, "analyze.json")))?.options);
		// A video over Deepgram's 2 GB goes to it as its sound alone (lib/audio-first.ts).
const big = await needsAudioFirst(key);
await Promise.all([deleteObject(siblingKey(key, "edit.json")), deleteObject(siblingKey(key, "analyze-error.json")), deleteObject(siblingKey(key, "deepgram-started.json"))]);
		// usageKey: lets the callback give the minutes back if the job fails. language: what was listened for, so the
		// admin's Accuracy tab can score each language (13 Nov; older videos are guessed from their letters).
		await putObject(
			siblingKey(key, "analyze.json"),
			JSON.stringify({ startedAt: new Date().toISOString(), usageKey: listen.usageKey, language: language || "en", ...(big && { audioFirst: true }), ...(options && { options }) }),
			"application/json",
		);

		if (big) {
// Modal takes the sound out; the page's next asks start Deepgram on it (continueAudioFirst). A sound from an earlier try is used again.
if (!(await exists(siblingKey(key, AUDIO_FILE)))) await startAudio(key, env);
} else {
const callbackUrl = await signedCallbackUrl(new URL("/api/analyze/callback", request.url).toString(), key, env.RENDER_TOKEN);
// Deepgram downloads the video itself through a temporary read-only link.
await startTranscription(await signedUrl(key, "GET", LINK_SECONDS), env.DEEPGRAM_API_KEY, language || "en", callbackUrl);
}
		// Make the editor's preview copy meanwhile; it is usually ready before the script is.
		const proxy = await proxyStatus(key);
		if (proxy !== "done" && proxy !== "processing") {
			await deleteObject(siblingKey(key, "proxy-error.json"));
			await startProxy(key, env);
		}
		return Response.json({ status: "processing" });
	} catch (err) {
		const error = err instanceof Error ? err.message : "Analysis failed";
		if (listen.usageKey) await refundListen(key, listen.usageKey).catch(() => {});
		// Saved so the admin page shows it too, not just the user's screen.
		await putObject(siblingKey(key, "analyze-error.json"), JSON.stringify({ error, at: new Date().toISOString() }), "application/json").catch(() => {});
		return Response.json({ error }, { status: 502 });
	}
}

// Where is it at? Returns the cut list once the callback has saved it.
export async function GET(request: Request) {
	const key = new URL(request.url).searchParams.get("key");
	if (!key || !VIDEO_KEY.test(key) || !(await ownsVideo(key))) return Response.json({ error: "Unknown video" }, { status: 404 });

	const editKey = siblingKey(key, "edit.json");
	let edit = await getJson<EditFile>(editKey);
	if (edit) {
		// Thai scripts from before words were joined (lib/thai-words.ts) are joined the first time they open.
		if (!edit.wordsJoined && Array.isArray(edit.words)) {
			edit = { ...(mergeThaiEdit(edit) ?? edit), wordsJoined: true };
			await putObject(editKey, JSON.stringify(edit, null, 2), "application/json");
		}
		// videoUrl: what the Script view plays next to the transcript. The preview copy when it is
		// ready, else the original. Videos from before preview copies get one the first time they open.
		const env = getCloudflareContext().env as unknown as AnalyzeEnv;
		let made = await proxyStatus(key);
		if (made === "none") made = await startProxy(key, env);
		// It plays as soon as the preview and its sound are there; the optimized sound follows (cleanPending).
		const files = await previewFiles(key);
		const proxy = files.playable ? "done" : made;
		const cleanPending = files.playable && !files.clean && made === "processing";
		const videoUrl = proxy === "done" ? await proxyUrl(key, LINK_SECONDS) : await signedUrl(key, "GET", LINK_SECONDS);
		// The editor's own player reads the preview copy and its sound through /api/media.
		const studio =
			proxy === "done"
				? {
						videoUrl: await mediaUrl(key, "proxy.mp4", env.RENDER_TOKEN, LINK_SECONDS),
						audioUrl: await mediaUrl(key, "proxy-audio.pcm", env.RENDER_TOKEN, LINK_SECONDS),
						...(files.clean && { cleanAudioUrl: await mediaUrl(key, CLEAN_SOUND, env.RENDER_TOKEN, LINK_SECONDS) }),
					}
				: null;
		// Where the speaker's face is, once the preview copy exists (found in it, after it is out: pending meanwhile).
		// While Modal is still on the preview, it is finding them: only read, never ask for them again (facesFor would).
		const { faces, pending: facesPending } =
			made === "processing"
				? await getJson<Faces>(siblingKey(key, "faces.json")).then((found) => ({ faces: found, pending: !found }))
				: proxy === "done"
					? await facesFor(key, env)
					: { faces: null, pending: false };
		// The upload page's percentage while the preview is made (it waits for it before opening the AI studio).
		const preparing = proxy === "done" ? 100 : await previewPercent(key);
		return Response.json({ status: "done", editKey, ...edit, videoUrl, studio, proxy, cleanPending, faces, facesPending, preparing });
	}

	// A video sent as its sound alone: this ask may be the one that finds the sound ready and starts Deepgram.
await continueAudioFirst(key, request.url, getCloudflareContext().env as unknown as AnalyzeEnv).catch(() => {});
const failure = await getJson<{ error?: string }>(siblingKey(key, "analyze-error.json"));
if (failure) return Response.json({ status: "failed", error: failure.error ?? "Analysis failed" });
	if (await settleDeadListen(key)) return Response.json({ status: "failed", error: "This took too long and stopped. Your minutes are back. Please try again." });

	const started = await exists(siblingKey(key, "analyze.json"));
	// Still listening: the preview is being made meanwhile, and its number is what the upload page shows.
	return Response.json({ status: started ? "processing" : "none", preparing: started ? await previewPercent(key) : 0 });
}
