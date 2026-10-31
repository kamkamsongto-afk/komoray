import { exists, getJson, putObject, siblingKey, signedUrl } from "@/lib/r2";

// The editor's preview copy lives next to the original video:
//   proxy.json        written when we ask Modal to make it
//   proxy.mp4         written by Modal: 540p, a full picture every half second (quick to jump around in)
//   proxy-error.json  written by Modal if it failed
// The final video is still made from the original, so this only affects what the editor plays.
export type ProxyStatus = "done" | "processing" | "failed" | "none";

const LINK_SECONDS = 3600;
const GIVE_UP_MS = 30 * 60 * 1000; // no proxy after this long: Modal died quietly, ask again

type ProxyEnv = { RENDER_URL: string; RENDER_TOKEN: string };

export async function proxyStatus(key: string): Promise<ProxyStatus> {
	if (await exists(siblingKey(key, "proxy.mp4"))) return "done";
	if (await exists(siblingKey(key, "proxy-error.json"))) return "failed";
	const started = await getJson<{ startedAt?: string }>(siblingKey(key, "proxy.json"));
	if (started?.startedAt && Date.now() - Date.parse(started.startedAt) < GIVE_UP_MS) return "processing";
	return "none";
}

export const proxyUrl = (key: string, seconds = LINK_SECONDS) => signedUrl(siblingKey(key, "proxy.mp4"), "GET", seconds);

// Ask Modal to make the preview copy. Never throws: without it the editor just plays the original.
export async function startProxy(key: string, env: ProxyEnv): Promise<ProxyStatus> {
	try {
		await putObject(siblingKey(key, "proxy.json"), JSON.stringify({ startedAt: new Date().toISOString() }), "application/json");
		const res = await fetch(env.RENDER_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				token: env.RENDER_TOKEN,
				kind: "proxy",
				// Modal only ever gets these one-file, time-limited links, never our R2 keys.
				videoUrl: await signedUrl(key, "GET", LINK_SECONDS),
				outputUrl: await signedUrl(siblingKey(key, "proxy.mp4"), "PUT", LINK_SECONDS, "video/mp4"),
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
