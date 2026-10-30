"use client";

import { useEffect, useState } from "react";
import { SignInCard, useUser } from "@/components/Account";

type Step = { status: "not started" | "working" | "done" | "failed" | "stuck"; at?: string; error?: string };
type Job = {
	id: string;
	filename: string;
	size: number;
	uploadedAt: string;
	videoUrl: string;
	analyze: Step;
	render: Step;
	finalUrl: string | null;
};
type Report = { at: string; email?: string; stage: string; error: string; key?: string; filename?: string; size?: number; browser?: string };

const BADGE: Record<Step["status"], string> = {
	"not started": "bg-foreground/10 text-foreground/60",
	working: "bg-blue-600/15 text-blue-600",
	done: "bg-green-600/15 text-green-600",
	failed: "bg-red-600/15 text-red-600",
	stuck: "bg-orange-500/15 text-orange-600",
};

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString() : "");
const mb = (bytes = 0) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function StepBadge({ label, step }: { label: string; step: Step }) {
	return (
		<div className="flex flex-col gap-1">
			<span className="text-xs text-foreground/50">{label}</span>
			<span className={`w-fit rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[step.status]}`}>{step.status}</span>
			{step.error && <span className="text-xs break-words text-red-600">{step.error}</span>}
		</div>
	);
}

export default function AdminPage() {
	const user = useUser();
	const [jobs, setJobs] = useState<Job[] | null>(null);
	const [reports, setReports] = useState<Report[]>([]);
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);
	const [onlyProblems, setOnlyProblems] = useState(false);

	async function load() {
		setLoading(true);
		setError("");
		try {
			const res = await fetch("/api/admin/jobs");
			const data = (await res.json()) as { jobs?: Job[]; reports?: Report[]; error?: string };
			if (!res.ok || !data.jobs) throw new Error(data.error ?? "Could not load");
			setJobs(data.jobs);
			setReports(data.reports ?? []);
		} catch (err) {
			setJobs(null);
			setError(err instanceof Error ? err.message : "Could not load");
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		if (user) void load();
	}, [user]);

	const problem = (j: Job) => [j.analyze.status, j.render.status].some((s) => s === "failed" || s === "stuck");
	const shown = jobs?.filter((j) => !onlyProblems || problem(j)) ?? [];
	const problemCount = jobs?.filter(problem).length ?? 0;

	if (user === undefined) return <main className="min-h-screen" />;
	if (!jobs) {
		return (
			<main className="font-sans mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-4">
				<h1 className="text-2xl font-bold">Komoray admin</h1>
				{user === null ? (
					<SignInCard title="Sign in as admin" />
				) : (
					<p className="text-sm text-foreground/70">{loading ? "Loading…" : error && `❌ ${error}`}</p>
				)}
			</main>
		);
	}

	return (
		<main className="font-sans mx-auto flex max-w-4xl flex-col gap-6 p-4 sm:p-8">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h1 className="text-2xl font-bold">Komoray admin</h1>
				<div className="flex items-center gap-3">
					<label className="flex items-center gap-2 text-sm">
						<input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
						Only problems
					</label>
					<button onClick={() => load()} disabled={loading} className="rounded-lg border border-foreground/20 px-3 py-1.5 text-sm disabled:opacity-50">
						{loading ? "Loading…" : "Refresh"}
					</button>
				</div>
			</div>

			<p className="text-sm text-foreground/70">
				{jobs.length} videos · <span className={problemCount ? "text-red-600" : ""}>{problemCount} with problems</span> · {reports.length} browser
				reports
			</p>

			<section className="flex flex-col gap-3">
				<h2 className="text-lg font-semibold">Videos</h2>
				{shown.length === 0 && <p className="text-sm text-foreground/60">Nothing here.</p>}
				{shown.map((job) => (
					<div key={job.id} className={`flex flex-col gap-3 rounded-xl border p-4 ${problem(job) ? "border-red-600/40" : "border-foreground/15"}`}>
						<div className="flex flex-wrap items-baseline justify-between gap-2">
							<a href={job.videoUrl} target="_blank" rel="noreferrer" className="font-medium break-all underline">
								{job.filename}
							</a>
							<span className="text-xs text-foreground/60">
								{mb(job.size)} · uploaded {when(job.uploadedAt)}
							</span>
						</div>
						<div className="grid grid-cols-2 gap-3">
							<StepBadge label="Find silences" step={job.analyze} />
							<StepBadge label="Make video" step={job.render} />
						</div>
						<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-foreground/50">
							<span className="break-all">{job.id}</span>
							{job.finalUrl && (
								<a href={job.finalUrl} target="_blank" rel="noreferrer" className="text-sm text-blue-600 underline">
									▶ Final video
								</a>
							)}
						</div>
					</div>
				))}
			</section>

			<section className="flex flex-col gap-3">
				<h2 className="text-lg font-semibold">Browser reports</h2>
				<p className="text-sm text-foreground/60">Errors people saw on their screen, e.g. an upload that dropped halfway.</p>
				{reports.length === 0 && <p className="text-sm text-foreground/60">None yet. 🎉</p>}
				{reports.map((r, i) => (
					<div key={i} className="flex flex-col gap-1 rounded-xl border border-foreground/15 p-4 text-sm">
						<div className="flex flex-wrap justify-between gap-2">
							<span className="font-medium">
								{r.stage}
								{r.email && <span className="font-normal text-foreground/60"> · {r.email}</span>}
							</span>
							<span className="text-xs text-foreground/60">{when(r.at)}</span>
						</div>
						<span className="break-words text-red-600">{r.error}</span>
						<span className="text-xs break-all text-foreground/50">
							{[r.filename, r.size ? mb(r.size) : "", r.key].filter(Boolean).join(" · ")}
						</span>
						{r.browser && <span className="text-xs break-all text-foreground/40">{r.browser}</span>}
					</div>
				))}
			</section>
		</main>
	);
}
