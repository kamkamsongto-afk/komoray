import { getCloudflareContext } from "@opennextjs/cloudflare";
import { accessFor } from "@/lib/access";
import { LOCAL_MATTE, LOCAL_MATTE_MAX_BYTES, type Window } from "@/lib/cutout";
import { getJson, putObject, siblingKey, signedUrl, VIDEO_KEY } from "@/lib/r2";
import { currentUser, ownsVideo } from "@/lib/supabase/server";

// Fast and Balanced: the customer's computer has uploaded its matte (lib/cutout-local.ts). Modal turns it
// into the same files Best makes (finish_local in modal_app/cutout.py). Costs a moment of plain server time.
const LINK_SECONDS = 3600;

type Job = { startedAt: string; windows: Window[]; runs: number; local?: string };
type FinishEnv = { CUTOUT_URL: string; RENDER_TOKEN: string };

export async function POST(request: Request) {
	const { key } = (await request.json().catch(() => ({}))) as { key?: unknown };
	if (typeof key !== "string" || !VIDEO_KEY.test(key) || !(await ownsVideo(key))) return Response.json({ error: "Unknown video" }, { status: 404 });
	const { user } = await currentUser();
	const access = await accessFor(user?.email);
	if (!access.allowed || !access.features.cutout.on) return Response.json({ error: "Cutout isn't turned on for your account yet." }, { status: 403 });

	const jobKey = siblingKey(key, "cutout-job.json");
	const job = await getJson<Job>(jobKey);
	if (!job?.local) return Response.json({ error: "Nothing is waiting to be finished." }, { status: 409 });

	// The upload link can't limit the size, so look before handing it to the server.
	const localKey = siblingKey(key, LOCAL_MATTE);
	const head = await fetch(await signedUrl(localKey, "GET", 60), { headers: { Range: "bytes=0-0" } }).catch(() => null);
	const size = Number(head?.headers.get("Content-Range")?.split("/")[1] ?? 0);
	await head?.body?.cancel().catch(() => {});
	if (!size) return Response.json({ error: "The cutout didn't reach us. Please try again." }, { status: 400 });
	if (size > LOCAL_MATTE_MAX_BYTES) return Response.json({ error: "The cutout is too big. Please try Fast or Best." }, { status: 400 });

	await putObject(jobKey, JSON.stringify({ ...job, startedAt: new Date().toISOString() }), "application/json");
	const env = getCloudflareContext().env as unknown as FinishEnv;
	const errorKey = siblingKey(key, "cutout-error.json");
	const res = await fetch(env.CUTOUT_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			token: env.RENDER_TOKEN,
			kind: "finish",
			tier: job.local,
			windows: job.windows,
			videoUrl: await signedUrl(key, "GET", LINK_SECONDS),
			localUrl: await signedUrl(localKey, "GET", LINK_SECONDS),
			matteUrl: await signedUrl(siblingKey(key, "matte.mp4"), "PUT", LINK_SECONDS, "video/mp4"),
			previewUrl: await signedUrl(siblingKey(key, "proxy-cutout.mp4"), "PUT", LINK_SECONDS, "video/mp4"),
			doneUrl: await signedUrl(siblingKey(key, "cutout.json"), "PUT", LINK_SECONDS, "application/json"),
			errorUrl: await signedUrl(errorKey, "PUT", LINK_SECONDS, "application/json"),
		}),
	}).catch(() => null);
	const data = (await res?.json().catch(() => ({}))) as { callId?: string; error?: string } | undefined;
	if (!res?.ok || !data?.callId) {
		const error = data?.error ?? `Could not finish the cutout (${res?.status ?? "no answer"})`;
		await putObject(errorKey, JSON.stringify({ error, at: new Date().toISOString() }), "application/json");
		return Response.json({ error }, { status: 502 });
	}
	return Response.json({ status: "processing" });
}
