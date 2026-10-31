"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AccountBar, SignInCard, useUser } from "@/components/Account";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Project = { id: string; video_key: string; filename: string; size: number; created_at: string };

const KEEP_DAYS = 14; // beta: R2 deletes uploads after 14 days
const DAY_MS = 24 * 60 * 60 * 1000;

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// What a new user sees before their first video.
const FIRST_STEPS: [string, string, string][] = [
	["🎬", "Upload a video", "Straight from your computer, or send it from your phone with a QR code."],
	["✂️", "Komoray does the first cut", "It cuts the silences and the takes you said again, and writes your script with subtitles."],
	["✨", "Make it yours", "Fix any word, pick a subtitle style, then press Make video. Your fixes are remembered next time."],
];

// The video's picture (made with its preview copy); a plain tile until it exists.
function Thumb({ videoKey }: { videoKey: string }) {
	const [failed, setFailed] = useState(false);
	return (
		<span className="flex h-24 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-foreground/10 text-xl">
			{failed ? (
				"🎬"
			) : (
				// eslint-disable-next-line @next/next/no-img-element -- a private picture from our own API
				<img src={`/api/thumb?key=${encodeURIComponent(videoKey)}`} alt="" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
			)}
		</span>
	);
}

export default function ProjectsPage() {
	const user = useUser();
	const [projects, setProjects] = useState<Project[] | null>(null);
	const [error, setError] = useState("");

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

	return (
		<main className="font-sans mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-4 sm:p-8">
			<AccountBar user={user} />
			<h1 className="text-3xl font-bold tracking-tight">My projects</h1>

			{error && <p className="text-sm text-red-600">❌ {error}</p>}
			{!projects && !error && <p className="text-sm text-foreground/60">Loading…</p>}
			{projects && live.length === 0 && (
				<div className="flex flex-col gap-5 rounded-2xl border border-foreground/15 p-6">
					<p className="text-lg font-medium">Your first video takes about 3 minutes.</p>
					<ol className="flex flex-col gap-3 text-sm text-foreground/80">
						{FIRST_STEPS.map(([icon, title, text], i) => (
							<li key={title} className="flex gap-3">
								<span className="text-xl" aria-hidden>
									{icon}
								</span>
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

			<ul className="flex flex-col gap-3">
				{live.map((p) => (
					<li key={p.id}>
						<Link
							// The editor sends videos without a script yet back to the upload page.
							href={`/edit?key=${encodeURIComponent(p.video_key)}`}
							className="flex items-center gap-4 rounded-xl border border-foreground/15 p-3 hover:border-foreground/40"
						>
							<Thumb videoKey={p.video_key} />
							<span className="flex min-w-0 flex-col gap-1">
								<span className="font-medium break-all">{p.filename}</span>
								<span className="text-xs text-foreground/60">
									{new Date(p.created_at).toLocaleString()} · {mb(p.size)} · deleted in {daysLeft(p.created_at)} days
								</span>
							</span>
						</Link>
					</li>
				))}
			</ul>

			{live.length > 0 && <p className="text-xs text-foreground/50">During the beta, videos are deleted automatically after {KEEP_DAYS} days.</p>}
		</main>
	);
}
