import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getJson, listObjects, signedUrl, type ObjectInfo } from "@/lib/r2";

// Everything the admin page shows: every video folder with how far it got and why it broke,
// plus the errors browsers reported. Only works with the admin password.
const SHOW_JOBS = 100;
const SHOW_REPORTS = 100;
const STUCK_MS = 30 * 60 * 1000; // a step still "working" after 30 minutes has silently died
const LINK_SECONDS = 3600;
const JOB_FILES = ["analyze.json", "edit.json", "analyze-error.json", "render.json", "final.mp4", "render-error.json"];

type Step = { status: "not started" | "working" | "done" | "failed" | "stuck"; at?: string; error?: string };

async function sha256(text: string) {
	const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return new Uint8Array(hash);
}

// Hashing both sides first makes the compare take the same time whatever was typed.
async function passwordOk(given: string, expected: string) {
	if (!expected) return false;
	const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}

async function step(files: Map<string, ObjectInfo>, started: string, done: string, failed: string): Promise<Step> {
	const fail = files.get(failed);
	if (fail) {
		const data = await getJson<{ error?: string }>(fail.key).catch(() => null);
		return { status: "failed", at: fail.lastModified, error: data?.error ?? "Unknown error" };
	}
	const ok = files.get(done);
	if (ok) return { status: "done", at: ok.lastModified };
	const start = files.get(started);
	if (!start) return { status: "not started" };
	const stuck = Date.now() - new Date(start.lastModified).getTime() > STUCK_MS;
	return { status: stuck ? "stuck" : "working", at: start.lastModified };
}

export async function GET(request: Request) {
	const env = getCloudflareContext().env as unknown as { ADMIN_PASSWORD?: string };
	const given = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
	if (!(await passwordOk(given, env.ADMIN_PASSWORD ?? ""))) {
		return Response.json({ error: "Wrong password" }, { status: 401 });
	}

	const [uploads, logs] = await Promise.all([listObjects("uploads/"), listObjects("logs/")]);

	const folders = new Map<string, Map<string, ObjectInfo>>();
	for (const item of uploads) {
		const [, id, name] = item.key.split("/");
		if (!id || !name) continue;
		if (!folders.has(id)) folders.set(id, new Map());
		folders.get(id)!.set(name, item);
	}

	const jobs = [...folders.entries()]
		.map(([id, files]) => {
			const video = [...files.values()].find((f) => !JOB_FILES.includes(f.key.split("/")[2]) && !f.key.includes("-before."));
			return { id, files, video };
		})
		.filter((job) => job.video)
		.sort((a, b) => b.video!.lastModified.localeCompare(a.video!.lastModified))
		.slice(0, SHOW_JOBS);

	const jobList = await Promise.all(
		jobs.map(async ({ id, files, video }) => {
			const final = files.get("final.mp4");
			return {
				id,
				filename: video!.key.split("/")[2],
				size: video!.size,
				uploadedAt: video!.lastModified,
				videoUrl: await signedUrl(video!.key, "GET", LINK_SECONDS),
				analyze: await step(files, "analyze.json", "edit.json", "analyze-error.json"),
				render: await step(files, "render.json", "final.mp4", "render-error.json"),
				finalUrl: final ? await signedUrl(final.key, "GET", LINK_SECONDS) : null,
			};
		}),
	);

	const recentLogs = logs.sort((a, b) => b.key.localeCompare(a.key)).slice(0, SHOW_REPORTS);
	const reports = (await Promise.all(recentLogs.map((log) => getJson<Record<string, unknown>>(log.key).catch(() => null)))).filter(Boolean);

	return Response.json({ jobs: jobList, reports });
}
