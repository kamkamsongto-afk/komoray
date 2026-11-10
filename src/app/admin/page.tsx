"use client";

import { Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { SignInCard, useUser } from "@/components/Account";
import { ActivityTable } from "@/components/ActivityTable";
import type { Activity } from "@/lib/admin-activity";
import { CUTOUT_ON } from "@/lib/cutout";
import { CUTOUT_SECONDS, type Features } from "@/lib/features";
import { BETA_MINUTES } from "@/lib/limits";

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
type Report = { at: string; email?: string; stage: string; error: string; key?: string; filename?: string; size?: number; browser?: string; file: string };
type Person = { email: string; at: string; used: number; features: Features };
type Waiting = { email: string; at: string };
type Answer = { email: string; at: string; easy: number | null; result: number | null; pay: string | null; note: string; file: string };
type Tab = "people" | "activity" | "videos" | "feedback" | "logs";
type ActivityData = { people?: Activity[]; used?: Record<string, number>; shown?: number; total?: number };

const BADGE: Record<Step["status"], string> = {
	"not started": "bg-foreground/10 text-foreground/60",
	working: "bg-blue-600/15 text-blue-600",
	done: "bg-green-600/15 text-green-600",
	failed: "bg-red-600/15 text-red-600",
	stuck: "bg-orange-500/15 text-orange-600",
};

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString() : "");
const mb = (bytes = 0) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const isProblem = (j: Job) => [j.analyze.status, j.render.status].some((s) => s === "failed" || s === "stuck");

function StepBadge({ label, step }: { label: string; step: Step }) {
	return (
		<span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[step.status]}`}>
			{label}: {step.status}
		</span>
	);
}

function DeleteButton({ label, onClick }: { label: string; onClick: () => void }) {
	return (
		<button onClick={onClick} aria-label={label} title={label} className="flex h-9 w-9 flex-none items-center justify-center rounded-lg text-foreground/50 hover:bg-red-600/10 hover:text-red-600">
			<Trash2 className="h-4 w-4" aria-hidden />
		</button>
	);
}

function Empty({ children }: { children: string }) {
	return <p className="text-sm text-foreground/60">{children}</p>;
}

export default function AdminPage() {
	const user = useUser();
	const [tab, setTab] = useState<Tab>("people");
	const [jobs, setJobs] = useState<Job[] | null>(null);
	const [reports, setReports] = useState<Report[]>([]);
	const [people, setPeople] = useState<Person[]>([]);
	const [waitlist, setWaitlist] = useState<Waiting[]>([]);
	const [feedback, setFeedback] = useState<Answer[]>([]);
	const [activity, setActivity] = useState<ActivityData>({});
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	const [loading, setLoading] = useState(false);
	const [onlyProblems, setOnlyProblems] = useState(false);
	const [newEmail, setNewEmail] = useState("");

	function downloadWaitlist() {
		const csv = ["email,joined", ...waitlist.map((p) => `"${p.email.replace(/"/g, '""')}",${p.at}`)].join("\n");
		const link = document.createElement("a");
		link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
		link.download = "komoray-waitlist.csv";
		link.click();
		URL.revokeObjectURL(link.href);
	}

	async function load() {
		setLoading(true);
		setError("");
		try {
			const res = await fetch("/api/admin/jobs");
			const data = (await res.json()) as { jobs?: Job[]; reports?: Report[]; error?: string };
			if (!res.ok || !data.jobs) throw new Error(data.error ?? "Could not load");
			setJobs(data.jobs);
			setReports(data.reports ?? []);
			const [invited, list, heard, doing] = await Promise.all(
				["/api/admin/access", "/api/waitlist", "/api/feedback", "/api/admin/activity"].map((url) => fetch(url).then((r) => r.json()).catch(() => ({}))),
			);
			setActivity(doing as ActivityData);
			setPeople((invited as { people?: Person[] }).people ?? []);
			setWaitlist((list as { people?: Waiting[] }).people ?? []);
			setFeedback((heard as { answers?: Answer[] }).answers ?? []);
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

	// Send a change, then show the lists as they now are. Says so if it did not work.
	async function change(url: string, init: RequestInit) {
		setNotice("");
		const res = await fetch(url, init).catch(() => null);
		if (!res?.ok) {
			const data = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
			setNotice(data?.error ?? "That didn't work. Please try again.");
			return false;
		}
		await load();
		return true;
	}

	const invite = (email: string) => change("/api/admin/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
	const saveFeatures = (email: string, features: Features) =>
		change("/api/admin/access", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, features }) });
	const removeInvite = (email: string) => {
		if (window.confirm(`Take the invite back from ${email}? Their videos stay, but they can't start new work.`)) void change(`/api/admin/access?email=${encodeURIComponent(email)}`, { method: "DELETE" });
	};
	const removeWaiting = (email: string) => {
		if (window.confirm(`Remove ${email} from the early access list?`)) void change(`/api/waitlist?email=${encodeURIComponent(email)}`, { method: "DELETE" });
	};
	const removeAnswer = (file: string) => {
		if (window.confirm("Delete this answer?")) void change(`/api/feedback?file=${encodeURIComponent(file)}`, { method: "DELETE" });
	};
	const removeReport = (file: string) => {
		if (window.confirm("Delete this report?")) void change(`/api/admin/logs?file=${encodeURIComponent(file)}`, { method: "DELETE" });
	};

	async function addEmail(e: FormEvent) {
		e.preventDefault();
		if (await invite(newEmail)) setNewEmail("");
	}

	if (user === undefined) return <main className="min-h-screen" />;
	if (!jobs) {
		return (
			<main className="font-sans mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-4">
				<h1 className="text-2xl font-bold">Komoray admin</h1>
				{user === null ? <SignInCard title="Sign in as admin" /> : <p className="text-sm text-foreground/70">{loading ? "Loading…" : error && error}</p>}
			</main>
		);
	}

	const problemCount = jobs.filter(isProblem).length;
	const shown = jobs.filter((j) => !onlyProblems || isProblem(j));
	const invited = new Set(people.map((p) => p.email));
	const sameEmail = (email?: string, other?: string | null) => Boolean(email && other) && email!.toLowerCase() === other!.toLowerCase();
	const activityRows = (activity.people ?? []).map((row) => ({
		...row,
		used: row.email ? (activity.used?.[row.email] ?? null) : null,
		feedback: feedback.filter((f) => sameEmail(f.email, row.email)).length,
		errors: reports.filter((r) => sameEmail(r.email, row.email)).length,
	}));
	const tabs: [Tab, string, number][] = [
		["people", "People", people.length + waitlist.length],
		["activity", "Activity", activityRows.filter((row) => row.email).length],
		["videos", "Videos", jobs.length],
		["feedback", "Feedback", feedback.length],
		["logs", "Logs", reports.length],
	];

	return (
		<main className={`font-sans mx-auto flex flex-col gap-6 p-4 sm:p-8 ${tab === "activity" ? "max-w-6xl" : "max-w-4xl"}`}>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h1 className="text-2xl font-bold">Komoray admin</h1>
				<button onClick={() => load()} disabled={loading} className="rounded-lg border border-foreground/20 px-3 py-1.5 text-sm disabled:opacity-50">
					{loading ? "Loading…" : "Refresh"}
				</button>
			</div>

			<nav aria-label="Admin sections" className="flex flex-wrap gap-1 border-b border-foreground/15">
				{tabs.map(([id, name, count]) => (
					<button
						key={id}
						onClick={() => setTab(id)}
						aria-current={tab === id ? "page" : undefined}
						className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === id ? "border-foreground" : "border-transparent text-foreground/60 hover:text-foreground"}`}
					>
						{name} <span className="text-foreground/50">{count}</span>
						{id === "videos" && problemCount > 0 && <span className="ml-1 text-red-600">· {problemCount} with problems</span>}
					</button>
				))}
			</nav>

			{notice && <p className="text-sm text-red-600">{notice}</p>}

			{tab === "people" && (
				<div className="flex flex-col gap-8">
					<section className="flex flex-col gap-3">
						<h2 className="text-lg font-semibold">Can use Komoray ({people.length})</h2>
						<form onSubmit={addEmail} className="flex flex-wrap gap-2">
							<input
								type="email"
								required
								value={newEmail}
								onChange={(e) => setNewEmail(e.target.value)}
								placeholder="creator@email.com"
								aria-label="Email to invite"
								className="min-w-0 flex-1 rounded-lg border border-foreground/20 bg-background px-3 py-2 text-sm"
							/>
							<button type="submit" className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background">
								Add email
							</button>
						</form>
						{people.length === 0 && <Empty>Nobody yet. You always have access as the admin.</Empty>}
						<ul className="flex flex-col divide-y divide-foreground/10">
							{people.map((p) => (
								<li key={p.email} className="flex items-center justify-between gap-3 py-1.5 text-sm">
									<span className="min-w-0 break-all">{p.email}</span>
									<span className="flex flex-none flex-wrap items-center justify-end gap-3 text-xs text-foreground/60">
										<label className="flex items-center gap-1" title="Cut the speaker out of the background: text behind them, a picture or clip behind them">
											<input
												type="checkbox"
												checked={p.features.cutout.on}
												onChange={(e) => void saveFeatures(p.email, { ...p.features, cutout: { ...p.features.cutout, on: e.target.checked } })}
											/>
											Cutout
										</label>
										{p.features.cutout.on && CUTOUT_ON.includes("best") && (
											<select
												aria-label={`Cutout Best minutes per month for ${p.email}`}
												value={p.features.cutout.seconds}
												onChange={(e) => void saveFeatures(p.email, { ...p.features, cutout: { ...p.features.cutout, seconds: Number(e.target.value) } })}
												className="rounded border border-foreground/20 bg-background px-1 py-0.5"
											>
												{CUTOUT_SECONDS.map((s) => (
													<option key={s} value={s}>
														{s / 60} min Slow / month
													</option>
												))}
											</select>
										)}
										{p.used} of {BETA_MINUTES} beta min used
										<DeleteButton label={`Take the invite back from ${p.email}`} onClick={() => removeInvite(p.email)} />
									</span>
								</li>
							))}
						</ul>
					</section>

					<section className="flex flex-col gap-3">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<h2 className="text-lg font-semibold">Early access list ({waitlist.length})</h2>
							{waitlist.length > 0 && (
								<button onClick={downloadWaitlist} className="text-sm underline">
									Download (CSV)
								</button>
							)}
						</div>
						{waitlist.length === 0 && <Empty>Nobody is waiting.</Empty>}
						<ul className="flex flex-col divide-y divide-foreground/10">
							{waitlist.map((p) => (
								<li key={p.email} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
									<span className="min-w-0 break-all">
										{p.email} <span className="text-xs text-foreground/50">{when(p.at)}</span>
									</span>
									<span className="flex flex-none items-center gap-2">
										{invited.has(p.email) ? (
											<span className="text-xs text-green-600">Invited</span>
										) : (
											<button onClick={() => void invite(p.email)} className="rounded-lg border border-foreground/20 px-3 py-1.5 text-xs font-medium hover:bg-foreground/5">
												Give access
											</button>
										)}
										<DeleteButton label={`Remove ${p.email} from the list`} onClick={() => removeWaiting(p.email)} />
									</span>
								</li>
							))}
						</ul>
					</section>
				</div>
			)}

			{tab === "activity" && <ActivityTable rows={activityRows} shown={activity.shown ?? 0} total={activity.total ?? 0} />}

			{tab === "videos" && (
				<section className="flex flex-col gap-3">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<p className="text-sm text-foreground/60">Videos belong to their owners and delete themselves after 14 days, so there is no delete here.</p>
						<label className="flex items-center gap-2 text-sm">
							<input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
							Only problems
						</label>
					</div>
					{shown.length === 0 && <Empty>Nothing here.</Empty>}
					<ul className="flex flex-col divide-y divide-foreground/10">
						{shown.map((job) => (
							<li key={job.id}>
								<details className="py-2">
									<summary className={`flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm ${isProblem(job) ? "text-red-600" : ""}`}>
										<span className="min-w-0 flex-1 truncate">{job.filename}</span>
										<span className="flex flex-wrap items-center gap-1.5">
											<StepBadge label="Silences" step={job.analyze} />
											<StepBadge label="Video" step={job.render} />
										</span>
									</summary>
									<div className="mt-2 flex flex-col gap-1 text-xs text-foreground/60">
										<span>
											{mb(job.size)} · uploaded {when(job.uploadedAt)}
										</span>
										<span className="break-all">{job.id}</span>
										{job.analyze.error && <span className="break-words text-red-600">Find silences: {job.analyze.error}</span>}
										{job.render.error && <span className="break-words text-red-600">Make video: {job.render.error}</span>}
										<span className="flex gap-3 text-sm">
											<a href={job.videoUrl} target="_blank" rel="noreferrer" className="underline">
												Original
											</a>
											{job.finalUrl && (
												<a href={job.finalUrl} target="_blank" rel="noreferrer" className="underline">
													Final video
												</a>
											)}
										</span>
									</div>
								</details>
							</li>
						))}
					</ul>
				</section>
			)}

			{tab === "feedback" && (
				<section className="flex flex-col gap-3">
					{feedback.length === 0 && <Empty>None yet.</Empty>}
					{feedback.map((f) => (
						<div key={f.file} className="flex items-start justify-between gap-3 rounded-xl border border-foreground/15 p-3 text-sm">
							<div className="flex min-w-0 flex-col gap-1">
								<span className="font-medium break-all">
									{f.email} <span className="text-xs font-normal text-foreground/60">{when(f.at)}</span>
								</span>
								<span className="text-foreground/70">
									Easy: {f.easy ?? "-"} · Happy: {f.result ?? "-"} · Would pay: {f.pay ?? "-"}
								</span>
								{f.note && <span className="break-words whitespace-pre-wrap">{f.note}</span>}
							</div>
							<DeleteButton label="Delete this answer" onClick={() => removeAnswer(f.file)} />
						</div>
					))}
				</section>
			)}

			{tab === "logs" && (
				<section className="flex flex-col gap-3">
					<p className="text-sm text-foreground/60">Errors people saw on their screen. They delete themselves after 90 days. Click one for details.</p>
					{reports.length === 0 && <Empty>None yet.</Empty>}
					<ul className="flex flex-col divide-y divide-foreground/10">
						{reports.map((r) => (
							<li key={r.file} className="flex items-start gap-2 py-1">
								<details className="min-w-0 flex-1 py-1.5">
									<summary className="flex cursor-pointer flex-wrap items-baseline gap-x-2 text-sm">
										<span className="font-medium">{r.stage}</span>
										<span className="min-w-0 flex-1 truncate text-red-600">{r.error}</span>
										<span className="text-xs text-foreground/50">{when(r.at)}</span>
									</summary>
									<div className="mt-1 flex flex-col gap-1 text-xs break-all text-foreground/60">
										<span className="break-words whitespace-pre-wrap text-red-600">{r.error}</span>
										{r.email && <span>{r.email}</span>}
										<span>{[r.filename, r.size ? mb(r.size) : "", r.key].filter(Boolean).join(" · ")}</span>
										{r.browser && <span>{r.browser}</span>}
									</div>
								</details>
								<DeleteButton label="Delete this report" onClick={() => removeReport(r.file)} />
							</li>
						))}
					</ul>
				</section>
			)}
		</main>
	);
}
