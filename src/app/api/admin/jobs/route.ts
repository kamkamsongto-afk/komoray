import { getJson, listObjects, signedUrl, type ObjectInfo } from "@/lib/r2";
import { currentUser, isAdmin } from "@/lib/supabase/server";

// Everything the admin page shows: every video folder with how far it got and why it broke,
// plus the errors browsers reported. Only for the admin's Google account.
const SHOW_JOBS = 100;
const SHOW_REPORTS = 100;
const STUCK_MS = 30 * 60 * 1000; // a step still "working" after 30 minutes has silently died
const LINK_SECONDS = 3600;
const JOB_FILES = [
	"analyze.json",
	"edit.json",
	"analyze-error.json",
	"render.json",
	"final.mp4",
	"render-error.json",
	"proxy.json",
	"proxy.mp4",
	"proxy-error.json",
];

type Step = { status: "not started" | "working" | "done" | "failed" | "stuck"; at?: string; error?: string };

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

export async function GET() {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	if (!isAdmin(user.email)) return Response.json({ error: "This page is for the Komoray team only" }, { status: 403 });

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
