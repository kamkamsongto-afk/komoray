import { getCloudflareContext } from "@opennextjs/cloudflare";
import { ownsVideo } from "@/lib/supabase/server";
import { signedCallbackUrl } from "@/lib/callback";
import { facesFor, mediaUrl, proxyStatus, proxyUrl, startProxy } from "@/lib/proxy";
import { deleteObject, exists, getJson, putObject, siblingKey, signedUrl, VIDEO_KEY } from "@/lib/r2";
import { mergeThaiEdit } from "@/lib/thai-words";
import { startTranscription } from "@/lib/transcribe";

// Finding silences lives in the video's folder:
//   analyze.json        written when we hand the video to Deepgram
//   edit.json           written by the callback when the cut list is ready
//   analyze-error.json  written by the callback if speech-to-text failed
const LINK_SECONDS = 3 * 3600; // Deepgram may queue long videos for a while before downloading

type AnalyzeEnv = { DEEPGRAM_API_KEY: string; RENDER_TOKEN: string; RENDER_URL: string };
type EditFile = Parameters<typeof mergeThaiEdit>[0] & { wordsJoined?: boolean };

// Start finding the silences. Returns right away; the page then polls GET below.
export async function POST(request: Request) {
	const { key, language } = (await request.json()) as { key?: string; language?: string };
	if (!key || !VIDEO_KEY.test(key) || !(await ownsVideo(key))) return Response.json({ error: "Unknown video" }, { status: 404 });

	// Deepgram can't reach a computer at home to deliver the result, so say so plainly.
	if (["localhost", "127.0.0.1"].includes(new URL(request.url).hostname)) {
		return Response.json({ error: "Find silences only works on komoray.com, not on localhost." }, { status: 400 });
	}

	const env = getCloudflareContext().env as unknown as AnalyzeEnv;
	try {
		await Promise.all([deleteObject(siblingKey(key, "edit.json")), deleteObject(siblingKey(key, "analyze-error.json"))]);
		await putObject(siblingKey(key, "analyze.json"), JSON.stringify({ startedAt: new Date().toISOString() }), "application/json");

		const callbackUrl = await signedCallbackUrl(new URL("/api/analyze/callback", request.url).toString(), key, env.RENDER_TOKEN);
		// Deepgram downloads the video itself through a temporary read-only link.
		await startTranscription(await signedUrl(key, "GET", LINK_SECONDS), env.DEEPGRAM_API_KEY, language || "en", callbackUrl);
		// Make the editor's preview copy meanwhile; it is usually ready before the script is.
		const proxy = await proxyStatus(key);
		if (proxy !== "done" && proxy !== "processing") {
			await deleteObject(siblingKey(key, "proxy-error.json"));
			await startProxy(key, env);
		}
		return Response.json({ status: "processing" });
	} catch (err) {
		const error = err instanceof Error ? err.message : "Analysis failed";
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
		let proxy = await proxyStatus(key);
		if (proxy === "none") proxy = await startProxy(key, env);
		const videoUrl = proxy === "done" ? await proxyUrl(key, LINK_SECONDS) : await signedUrl(key, "GET", LINK_SECONDS);
		// The editor's own player reads the preview copy and its sound through /api/media.
		const studio =
			proxy === "done"
				? {
						videoUrl: await mediaUrl(key, "proxy.mp4", env.RENDER_TOKEN, LINK_SECONDS),
						audioUrl: await mediaUrl(key, "proxy-audio.pcm", env.RENDER_TOKEN, LINK_SECONDS),
					}
				: null;
		// Where the speaker's face is, once the preview copy exists (found in it).
		const { faces, pending: facesPending } = proxy === "done" ? await facesFor(key, env) : { faces: null, pending: proxy === "processing" };
		return Response.json({ status: "done", editKey, ...edit, videoUrl, studio, proxy, faces, facesPending });
	}

	const failure = await getJson<{ error?: string }>(siblingKey(key, "analyze-error.json"));
	if (failure) return Response.json({ status: "failed", error: failure.error ?? "Analysis failed" });

	const started = await exists(siblingKey(key, "analyze.json"));
	return Response.json({ status: started ? "processing" : "none" });
}
