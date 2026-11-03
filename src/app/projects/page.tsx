"use client";

import { Clapperboard, FileVideo, LayoutGrid, List, type LucideIcon, Scissors, Sparkles, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AccountBar, SignInCard, useUser } from "@/components/Account";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Project = { id: string; video_key: string; filename: string; size: number; created_at: string };
type View = "list" | "grid";

const KEEP_DAYS = 14; // beta: R2 deletes uploads after 14 days
const DAY_MS = 24 * 60 * 60 * 1000;
const VIEW_PREF = "komoray.projectsView"; // remembers list or thumbnails in this browser

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// What a new user sees before their first video.
const FIRST_STEPS: [LucideIcon, string, string][] = [
	[Upload, "Upload a video", "Straight from your computer, or send it from your phone with a QR code."],
	[Scissors, "Komoray does the first cut", "It cuts the silences and the takes you said again, and writes your script with subtitles."],
	[Sparkles, "Make it yours", "Fix any word, pick a subtitle style, then press Make video. Your fixes are remembered next time."],
];

// The video's picture (made with its preview copy); a plain tile until it exists.
function Thumb({ videoKey }: { videoKey: string }) {
	const [failed, setFailed] = useState(false);
	return failed ? (
		<Clapperboard className="h-8 w-8 text-foreground/40" aria-hidden />
	) : (
		// eslint-disable-next-line @next/next/no-img-element -- a private picture from our own API
		<img src={`/api/thumb?key=${encodeURIComponent(videoKey)}`} alt="" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
	);
}

// The bin, which asks once more before deleting: a deleted video can't come back.
function DeleteButton({ project, onDeleted, onError }: { project: Project; onDeleted: () => void; onError: (error: string) => void }) {
	const [state, setState] = useState<"idle" | "asking" | "deleting">("idle");

	async function remove() {
		setState("deleting");
		const res = await fetch(`/api/projects?key=${encodeURIComponent(project.video_key)}`, { method: "DELETE" }).catch(() => null);
		if (res?.ok) return onDeleted();
		setState("idle");
		onError(`Could not delete ${project.filename}. Please try again.`);
	}

	if (state === "idle") {
		return (
			<button
				onClick={() => setState("asking")}
				aria-label={`Delete ${project.filename}`}
				title="Delete this video"
				className="shrink-0 rounded-lg p-2 text-foreground/50 hover:bg-red-600/10 hover:text-red-600"
			>
				<Trash2 className="h-4 w-4" aria-hidden />
			</button>
		);
	}
	return (
		<div className="flex shrink-0 items-center gap-1 text-xs">
			<button
				onClick={() => void remove()}
				disabled={state === "deleting"}
				className="rounded-md bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-60"
			>
				{state === "deleting" ? "Deleting…" : "Delete for good"}
			</button>
			<button onClick={() => setState("idle")} disabled={state === "deleting"} className="rounded-md border border-foreground/20 px-2 py-1 hover:bg-foreground/5 disabled:opacity-60">
				Cancel
			</button>
		</div>
	);
}

export default function ProjectsPage() {
	const user = useUser();
	const [projects, setProjects] = useState<Project[] | null>(null);
	const [error, setError] = useState("");
	const [view, setView] = useState<View>("list");

	useEffect(() => {
		try {
			if (localStorage.getItem(VIEW_PREF) === "grid") setView("grid");
		} catch {
			// no browser storage here: start with the list
		}
	}, []);

	function changeView(next: View) {
		setView(next);
		try {
			localStorage.setItem(VIEW_PREF, next);
		} catch {
			// not remembered this time
		}
	}

	useEffect(() => {
		if (!user) return;
		// The database only returns this user's rows (Row Level Security).
		supabaseBrowser()
			.from("projects")
			.select("id, video_key, filename, size, created_at")
			.order("created_at", { ascending: false })
			.then(({ data, error }) => {
				if (error) setError("Could not load your projects");
				else setProjects(data);
			});
	}, [user]);

	if (user === undefined) return <main className="min-h-screen" />;
	if (user === null) {
		return (
			<main className="font-sans mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-4">
				<SignInCard title="Sign in to see your projects" />
			</main>
		);
	}

	const daysLeft = (createdAt: string) => KEEP_DAYS - Math.floor((Date.now() - new Date(createdAt).getTime()) / DAY_MS);
	const live = projects?.filter((p) => daysLeft(p.created_at) > 0) ?? [];
	const editLink = (p: Project) => `/edit?key=${encodeURIComponent(p.video_key)}`; // the editor sends videos without a script yet back to the upload page
	const deleted = (p: Project) => setProjects((list) => list?.filter((x) => x.id !== p.id) ?? null);
	const details = (p: Project) => `${new Date(p.created_at).toLocaleDateString()} · ${mb(p.size)} · deleted in ${daysLeft(p.created_at)} days`;

	return (
		<main className="font-sans mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-4 sm:p-8">
			<AccountBar user={user} />
			<div className="flex items-center justify-between gap-3">
				<h1 className="text-3xl font-bold tracking-tight">My projects</h1>
				{live.length > 0 && (
					<div className="flex rounded-lg border border-foreground/20 p-0.5" role="radiogroup" aria-label="How to show your projects">
						{(
							[
								["list", List, "List"],
								["grid", LayoutGrid, "Thumbnails"],
							] as const
						).map(([id, Icon, name]) => (
							<button
								key={id}
								role="radio"
								aria-checked={view === id}
								aria-label={name}
								title={name}
								onClick={() => changeView(id)}
								className={`rounded-md p-1.5 ${view === id ? "bg-foreground text-background" : "text-foreground/60 hover:text-foreground"}`}
							>
								<Icon className="h-4 w-4" aria-hidden />
							</button>
						))}
					</div>
				)}
			</div>

			{error && <p className="text-sm text-red-600">{error}</p>}
			{!projects && !error && <p className="text-sm text-foreground/60">Loading…</p>}
			{projects && live.length === 0 && (
				<div className="flex max-w-xl flex-col gap-5 rounded-2xl border border-foreground/15 p-6">
					<p className="text-lg font-medium">Your first video takes about 3 minutes.</p>
					<ol className="flex flex-col gap-3 text-sm text-foreground/80">
						{FIRST_STEPS.map(([Icon, title, text], i) => (
							<li key={title} className="flex gap-3">
								<Icon className="mt-0.5 h-5 w-5 shrink-0 text-foreground/60" aria-hidden />
								<span>
									<span className="font-medium text-foreground">
										{i + 1}. {title}
									</span>
									<br />
									{text}
								</span>
							</li>
						))}
					</ol>
					<div className="flex flex-wrap items-center gap-3">
						<Link href="/upload" className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700">
							Upload your first video
						</Link>
						<Link href="/brand" className="text-sm text-foreground/70 underline hover:text-foreground">
							or set up your Brand Kit first
						</Link>
					</div>
				</div>
			)}

			{view === "list" ? (
				<ul className="flex flex-col divide-y divide-foreground/10 rounded-xl border border-foreground/15 empty:hidden">
					{live.map((p) => (
						<li key={p.id} className="flex items-center gap-2 pr-2 hover:bg-foreground/5">
							<Link href={editLink(p)} className="flex min-w-0 flex-1 items-center gap-3 p-3">
								<FileVideo className="h-5 w-5 shrink-0 text-foreground/50" aria-hidden />
								<span className="min-w-0 flex-1 truncate font-medium">{p.filename}</span>
								<span className="hidden shrink-0 text-xs text-foreground/60 sm:inline">{details(p)}</span>
							</Link>
							<DeleteButton project={p} onDeleted={() => deleted(p)} onError={setError} />
						</li>
					))}
				</ul>
			) : (
				<ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
					{live.map((p) => (
						<li key={p.id} className="flex flex-col overflow-hidden rounded-xl border border-foreground/15 hover:border-foreground/40">
							<Link href={editLink(p)} className="flex aspect-[3/4] items-center justify-center overflow-hidden bg-foreground/10">
								<Thumb videoKey={p.video_key} />
							</Link>
							<div className="flex flex-col gap-1 p-2">
								<Link href={editLink(p)} className="truncate text-sm font-medium" title={p.filename}>
									{p.filename}
								</Link>
								<div className="flex min-h-9 flex-wrap items-center justify-between gap-1">
									<span className="text-xs text-foreground/60">{daysLeft(p.created_at)} days left</span>
									<DeleteButton project={p} onDeleted={() => deleted(p)} onError={setError} />
								</div>
							</div>
						</li>
					))}
				</ul>
			)}

			{live.length > 0 && <p className="text-xs text-foreground/50">During the beta, videos are deleted automatically after {KEEP_DAYS} days.</p>}
		</main>
	);
}
