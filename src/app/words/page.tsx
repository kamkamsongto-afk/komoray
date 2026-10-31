"use client";

import { useEffect, useState } from "react";
import { AccountBar, SignInCard, useUser } from "@/components/Account";

type Word = { heard: string; fixed: string; uses: number; updated_at: string };

// The personal dictionary: every word the user fixed in a script, applied to their next videos.
// They can see it, remove words, and download it (it is theirs).
export default function WordsPage() {
	const user = useUser();
	const [words, setWords] = useState<Word[] | null>(null);
	const [error, setError] = useState("");
	const [filter, setFilter] = useState("");

	useEffect(() => {
		if (!user) return;
		fetch("/api/dictionary")
			.then((res) => res.json() as Promise<{ words?: Word[]; error?: string }>)
			.then((data) => (data.words ? setWords(data.words) : setError(data.error ?? "Could not load your words")))
			.catch(() => setError("Could not load your words"));
	}, [user]);

	async function forget(heard: string) {
		setWords((list) => list?.filter((w) => w.heard !== heard) ?? null);
		const res = await fetch("/api/dictionary", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ heard }) });
		if (!res.ok) setError("Could not remove that word. Please reload and try again.");
	}

	function download() {
		const csv = ["heard,fixed,uses", ...(words ?? []).map((w) => [w.heard, w.fixed, w.uses].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
		const link = document.createElement("a");
		link.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" })); // BOM: Excel reads Thai correctly
		link.download = "komoray-my-words.csv";
		link.click();
		URL.revokeObjectURL(link.href);
	}

	if (user === undefined) return <main className="min-h-screen" />;
	if (user === null) {
		return (
			<main className="font-sans mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-4">
				<SignInCard title="Sign in to see your words" />
			</main>
		);
	}

	const shown = (words ?? []).filter((w) => !filter.trim() || `${w.heard} ${w.fixed}`.toLowerCase().includes(filter.trim().toLowerCase()));

	return (
		<main className="font-sans mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-4 sm:p-8">
			<AccountBar user={user} />
			<div className="flex flex-col gap-2">
				<h1 className="text-3xl font-bold tracking-tight">My words</h1>
				<p className="text-sm text-foreground/70">
					Every word you fix in a script is remembered here, and fixed for you in your next videos. Only you can see it. It is never used to
					train anything.
				</p>
			</div>

			{error && <p className="text-sm text-red-600">❌ {error}</p>}
			{!words && !error && <p className="text-sm text-foreground/60">Loading…</p>}
			{words && words.length === 0 && (
				<p className="text-foreground/70">No words yet. Double-click a word in a script to fix it, and it shows up here.</p>
			)}

			{words && words.length > 0 && (
				<>
					<div className="flex flex-wrap items-center gap-2">
						<input
							value={filter}
							onChange={(e) => setFilter(e.target.value)}
							placeholder="Search your words"
							aria-label="Search your words"
							className="min-w-40 flex-1 rounded-md border border-foreground/20 bg-background px-3 py-1.5"
						/>
						<button onClick={download} className="rounded-lg border border-foreground/20 px-3 py-1.5 text-sm hover:bg-foreground/5">
							⬇️ Download (CSV)
						</button>
					</div>
					<ul className="flex flex-col divide-y divide-foreground/10 rounded-xl border border-foreground/15">
						{shown.map((w) => (
							<li key={w.heard} className="flex items-center gap-3 px-4 py-2.5">
								<span className="min-w-0 flex-1 break-words">
									<span className="text-foreground/50 line-through">{w.heard}</span> → <span className="font-medium">{w.fixed}</span>
								</span>
								<span className="shrink-0 text-xs text-foreground/50" title="Times you made this fix">
									×{w.uses}
								</span>
								<button
									onClick={() => void forget(w.heard)}
									className="shrink-0 rounded-md px-2 py-1 text-sm text-foreground/60 hover:bg-red-500/10 hover:text-red-600"
									aria-label={`Remove ${w.fixed}`}
								>
									Remove
								</button>
							</li>
						))}
					</ul>
					<p className="text-xs text-foreground/50">
						{words.length} {words.length === 1 ? "word" : "words"}. Removing a word only stops future fixes; videos you already edited keep theirs.
					</p>
				</>
			)}
		</main>
	);
}
