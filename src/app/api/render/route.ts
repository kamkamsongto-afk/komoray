import { getCloudflareContext } from "@opennextjs/cloudflare";
import { ownsVideo } from "@/lib/supabase/server";
import { deleteObject, exists, getJson, putObject, siblingKey, signedUrl, VIDEO_KEY } from "@/lib/r2";

// One render job lives in the video's folder:
//   render.json        written when the job starts (so we know it is in progress)
//   final.mp4          written by Modal when the video is ready
//   render-error.json  written by Modal if it failed
const LINK_SECONDS = 3600;

type RenderEnv = { RENDER_URL: string; RENDER_TOKEN: string };

// A valid video key that belongs to the signed-in user, or null.
async function readKey(key: string | null) {
	return key && VIDEO_KEY.test(key) && (await ownsVideo(key)) ? key : null;
}

// Start making the final video.
export async function POST(request: Request) {
	const { key: rawKey } = (await request.json()) as { key?: string };
	const key = await readKey(rawKey ?? null);
	if (!key) return Response.json({ error: "Unknown video" }, { status: 404 });

	const edit = await getJson<object>(siblingKey(key, "edit.json"));
	if (!edit) return Response.json({ error: "Find silences first" }, { status: 400 });

	const finalKey = siblingKey(key, "final.mp4");
	const errorKey = siblingKey(key, "render-error.json");
	// Clear the previous attempt so the status check can't pick up an old result.
	await Promise.all([deleteObject(finalKey), deleteObject(errorKey)]);
	await putObject(siblingKey(key, "render.json"), JSON.stringify({ startedAt: new Date().toISOString() }), "application/json");

	const env = getCloudflareContext().env as unknown as RenderEnv;
	const res = await fetch(env.RENDER_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			token: env.RENDER_TOKEN,
			edit,
			// Modal only ever gets these one-file, time-limited links, never our R2 keys.
			videoUrl: await signedUrl(key, "GET", LINK_SECONDS),
			outputUrl: await signedUrl(finalKey, "PUT", LINK_SECONDS, "video/mp4"),
			errorUrl: await signedUrl(errorKey, "PUT", LINK_SECONDS, "application/json"),
		}),
	});
	const data = (await res.json().catch(() => ({}))) as { callId?: string; error?: string };
	if (!res.ok || !data.callId) {
		const error = data.error ?? `Could not start the render (${res.status})`;
		await putObject(errorKey, JSON.stringify({ error, at: new Date().toISOString() }), "application/json");
		return Response.json({ error }, { status: 502 });
	}
	return Response.json({ status: "processing" });
}

// Where is the job at? The page asks this every few seconds.
export async function GET(request: Request) {
	const key = await readKey(new URL(request.url).searchParams.get("key"));
	if (!key) return Response.json({ error: "Unknown video" }, { status: 404 });

	const finalKey = siblingKey(key, "final.mp4");
	if (await exists(finalKey)) {
		return Response.json({
			status: "done",
			videoUrl: await signedUrl(finalKey, "GET", LINK_SECONDS),
			downloadUrl: await signedUrl(finalKey, "GET", LINK_SECONDS, undefined, "komoray-video.mp4"),
		});
	}

	const failure = await getJson<{ error?: string }>(siblingKey(key, "render-error.json"));
	if (failure) return Response.json({ status: "failed", error: failure.error ?? "Render failed" });

	const started = await exists(siblingKey(key, "render.json"));
	return Response.json({ status: started ? "processing" : "none" });
}
