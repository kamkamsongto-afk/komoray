import { getCloudflareContext } from "@opennextjs/cloudflare";
import { continueAudioFirst } from "@/lib/audio-first";
import { verifyCallback } from "@/lib/callback";
import { VIDEO_KEY } from "@/lib/r2";

// Modal calls this when a video's sound is out, or could not be taken out (tell in modal_app/render.py): speech-to-text
// starts without anyone having the page open (lib/audio-first.ts). Safe to call twice.
export async function POST(request: Request) {
	const params = new URL(request.url).searchParams;
	const key = params.get("key") ?? "";
	const sig = params.get("sig") ?? "";
	const env = getCloudflareContext().env as unknown as { DEEPGRAM_API_KEY: string; RENDER_TOKEN: string; RENDER_URL: string };
	if (!VIDEO_KEY.test(key) || !(await verifyCallback(key, sig, env.RENDER_TOKEN))) {
		return Response.json({ error: "unauthorized" }, { status: 401 });
	}
	// Throwing answers 500, and Modal asks again.
	await continueAudioFirst(key, request.url, env);
	return Response.json({ ok: true });
}
