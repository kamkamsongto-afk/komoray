import { hmac } from "@/lib/callback";
import type { Faces } from "@/lib/framing";
import { deleteObject, exists, getJson, putObject, siblingKey, signedUrl } from "@/lib/r2";

// The editor's preview copy lives next to the original video:
//   proxy.json        written when we ask Modal to make it
//   proxy-audio.pcm   written by Modal: the sound as raw samples (mono, 16-bit, PROXY_AUDIO_RATE)
//   proxy.mp4         written by Modal last: 540p, a full picture every half second, no B-frames
//   proxy-error.json  written by Modal if it failed
//   faces.json        written by Modal: where the speaker's face is, every half second (facesFor)
//   thumb.jpg         written by Modal: the picture on My projects (/api/thumb)
// The final video is still made from the original, so this only affects what the editor plays.
//   proxy-audio-clean.pcm  written by Modal: the same sound, fully optimized (the Audio optimization slider mixes the two)
// A proxy.mp4 without both sound files is from before they existed and gets made again.
export type ProxyStatus = "done" | "processing" | "failed" | "none";

export const PROXY_AUDIO_RATE = 24000;
const LINK_SECONDS = 3600;
const GIVE_UP_MS = 30 * 60 * 1000; // no proxy after this long: Modal died quietly, ask again

type ProxyEnv = { RENDER_URL: string; RENDER_TOKEN: string };

export async function proxyStatus(key: string): Promise<ProxyStatus> {
	const [video, audio, clean] = await Promise.all([exists(siblingKey(key, "proxy.mp4")), exists(siblingKey(key, "proxy-audio.pcm")), exists(siblingKey(key, "proxy-audio-clean.pcm"))]);
	if (video && audio && clean) return "done";
	const started = await getJson<{ startedAt?: string; withClean?: boolean }>(siblingKey(key, "proxy.json"));
	const running = Boolean(started?.startedAt && Date.now() - Date.parse(started.startedAt) < GIVE_UP_MS);
	const failed = await exists(siblingKey(key, "proxy-error.json"));
	// A preview from before the newer sound file gets one try at being made again. An error from an attempt
	// before that doesn't count (withClean: startProxy cleared old errors and asked for the file), and a failed
	// try isn't repeated: Modal costs money.
	if (video && audio) {
		if (failed && started?.withClean) return "failed";
		return running ? "processing" : "none";
	}
	if (failed) return "failed";
	return running ? "processing" : "none";
}

export const proxyUrl = (key: string, seconds = LINK_SECONDS) => signedUrl(siblingKey(key, "proxy.mp4"), "GET", seconds);

// Links for the editor's own player, read through /api/media on our site (see there why).
export const MEDIA_FILES = ["proxy.mp4", "proxy-audio.pcm", "proxy-audio-clean.pcm"];
export const mediaMessage = (key: string, file: string, exp: number) => `media:${key}:${file}:${exp}`;
export async function mediaUrl(key: string, file: string, secret: string, seconds = LINK_SECONDS) {
	const exp = Math.floor(Date.now() / 1000) + seconds;
	const sig = await hmac(secret, mediaMessage(key, file, exp));
	return `/api/media?${new URLSearchParams({ key, file, exp: String(exp), sig })}`;
}

// Where the speaker's face is (faces.json, lib/framing.ts): Modal finds it in the preview copy,
// together with making it. Preview copies from before that get it on their own; faces.started
// keeps us from asking twice. Never throws: without faces, videos are framed in the middle.
export async function facesFor(key: string, env: ProxyEnv): Promise<{ faces: Faces | null; pending: boolean }> {
	const faces = await getJson<Faces>(siblingKey(key, "faces.json"));
	if (faces) return { faces, pending: false };
	const started = await getJson<{ startedAt?: string }>(siblingKey(key, "faces.started"));
	if (started?.startedAt && Date.now() - Date.parse(started.startedAt) < GIVE_UP_MS) return { faces: null, pending: true };
	try {
		await putObject(siblingKey(key, "faces.started"), JSON.stringify({ startedAt: new Date().toISOString() }), "application/json");
		const res = await fetch(env.RENDER_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				token: env.RENDER_TOKEN,
				kind: "faces",
				videoUrl: await proxyUrl(key),
				facesUrl: await signedUrl(siblingKey(key, "faces.json"), "PUT", LINK_SECONDS, "application/json"),
				thumbUrl: await signedUrl(siblingKey(key, "thumb.jpg"), "PUT", LINK_SECONDS, "image/jpeg"),
			}),
		});
		return { faces: null, pending: res.ok };
	} catch {
		return { faces: null, pending: false };
	}
}

// Ask Modal to make the preview copy. Never throws: without it the editor just plays the original.
export async function startProxy(key: string, env: ProxyEnv): Promise<ProxyStatus> {
	try {
		await deleteObject(siblingKey(key, "proxy-error.json")).catch(() => {}); // from now on an error means this attempt failed
		await putObject(siblingKey(key, "proxy.json"), JSON.stringify({ startedAt: new Date().toISOString(), withClean: true }), "application/json");
		const res = await fetch(env.RENDER_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				token: env.RENDER_TOKEN,
				kind: "proxy",
				// Modal only ever gets these one-file, time-limited links, never our R2 keys.
				videoUrl: await signedUrl(key, "GET", LINK_SECONDS),
				outputUrl: await signedUrl(siblingKey(key, "proxy.mp4"), "PUT", LINK_SECONDS, "video/mp4"),
				audioUrl: await signedUrl(siblingKey(key, "proxy-audio.pcm"), "PUT", LINK_SECONDS, "application/octet-stream"),
				cleanAudioUrl: await signedUrl(siblingKey(key, "proxy-audio-clean.pcm"), "PUT", LINK_SECONDS, "application/octet-stream"),
				facesUrl: await signedUrl(siblingKey(key, "faces.json"), "PUT", LINK_SECONDS, "application/json"),
				thumbUrl: await signedUrl(siblingKey(key, "thumb.jpg"), "PUT", LINK_SECONDS, "image/jpeg"),
				errorUrl: await signedUrl(siblingKey(key, "proxy-error.json"), "PUT", LINK_SECONDS, "application/json"),
			}),
		});
		const data = (await res.json().catch(() => ({}))) as { callId?: string; error?: string };
		if (!res.ok || !data.callId) throw new Error(data.error ?? `Could not start the preview copy (${res.status})`);
		return "processing";
	} catch (err) {
		const error = err instanceof Error ? err.message : "Preview copy failed";
		await putObject(siblingKey(key, "proxy-error.json"), JSON.stringify({ error, at: new Date().toISOString() }), "application/json").catch(() => {});
		return "failed";
	}
}
