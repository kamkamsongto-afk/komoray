"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AccountBar, SignInCard, useUser } from "@/components/Account";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Project = { id: string; video_key: string; filename: string; size: number; created_at: string };

const KEEP_DAYS = 14; // beta: R2 deletes uploads after 14 days
const DAY_MS = 24 * 60 * 60 * 1000;

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

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
				<div className="flex flex-col items-start gap-3">
					<p className="text-foreground/70">No videos yet.</p>
					<Link href="/upload" className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700">
						Upload your first video
					</Link>
				</div>
			)}

			<ul className="flex flex-col gap-3">
				{live.map((p) => (
					<li key={p.id}>
						<Link
							href={`/upload?key=${encodeURIComponent(p.video_key)}`}
							className="flex flex-col gap-1 rounded-xl border border-foreground/15 p-4 hover:border-foreground/40"
						>
							<span className="font-medium break-all">{p.filename}</span>
							<span className="text-xs text-foreground/60">
								{new Date(p.created_at).toLocaleString()} · {mb(p.size)} · deleted in {daysLeft(p.created_at)} days
							</span>
						</Link>
					</li>
				))}
			</ul>

			{live.length > 0 && <p className="text-xs text-foreground/50">During the beta, videos are deleted automatically after {KEEP_DAYS} days.</p>}
		</main>
	);
}
