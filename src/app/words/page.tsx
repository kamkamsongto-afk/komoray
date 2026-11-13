"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AccountBar, SignInCard, useUser } from "@/components/Account";

// use (lib/word-rules.ts): always = fixed in every new video; ai = only where the sentence fits; off = not used.
type Word = { heard: string; fixed: string; uses: number; updated_at: string; use?: "always" | "ai" | "off" };
const USE_LABEL = {
	always: { text: "Every video", tone: "bg-green-600/10 text-green-700 dark:text-green-400", tip: "It can't be right as heard (or it is a name of yours), so it is fixed in every new video." },
	ai: { text: "Where it fits", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400", tip: "It could be right as heard in another sentence (like สวน and ส่วน), so our AI only fixes it where the sentence means it." },
	off: { text: "Not used", tone: "bg-foreground/10 text-foreground/60", tip: "This fix added or took out words, or only changed spacing. That belongs to one video, so it isn't used again." },
};

// The personal dictionary: every word the user fixed in a script, applied to their next videos.
// They can see it, remove words, and download it (it is theirs).
export default function WordsPage() {
	const user = useUser();
	const [words, setWords] = useState<Word[] | null>(null);
	const [error, setError] = useState("");
	const [filter, setFilter] = useState("");
	const [editing, setEditing] = useState<{ heard: string; text: string } | null>(null);
	// Giving fixes to Komoray's shared list (lib/shared-words.ts): off until they tick it.
	const [share, setShare] = useState<boolean | null>(null);
	const [shareError, setShareError] = useState("");

	const load = () =>
		fetch("/api/dictionary")
			.then((res) => res.json() as Promise<{ words?: Word[]; error?: string }>)
			.then((data) => (data.words ? setWords(data.words) : setError(data.error ?? "Could not load your words")))
			.catch(() => setError("Could not load your words"));

	useEffect(() => {
		if (!user) return;
		void load();
		// Not read: say so and show neither the box nor the line, rather than "not sharing" for someone who shares (Codex review 13 Nov).
		fetch("/api/prefs")
			.then((res) => (res.ok ? (res.json() as Promise<{ shareWords?: boolean }>) : Promise.reject(new Error(String(res.status)))))
			.then((data) => setShare(data.shareWords === true))
			.catch(() => setShareError("Could not load your sharing choice. Please reload the page."));
	}, [user]);

	// Coach, 13 Nov: the box stays big until they share; ticking asks to confirm, then it folds into a small line at the
	// bottom of the page ("Change" opens it again to stop sharing).
	const [shareOpen, setShareOpen] = useState(false);
	function askShare(on: boolean) {
		const question = on
			? [
					"Share your word fixes with Komoray?",
					"Only the word pair is shared (like ผูหญิง → ผู้หญิง), never your name, email, videos or the sentence. A fix is only used once at least 3 different creators made the same one.",
					"You can stop any time. Fixes shared before stay in the list, without your name.",
				].join("\n\n")
			: ["Stop sharing your word fixes?", "Fixes from now on stay yours only. Fixes shared before stay in the list, without your name."].join("\n\n");
		if (!window.confirm(question)) return;
		void changeShare(on);
		if (on) setShareOpen(false);
	}

	async function changeShare(on: boolean) {
		setShareError("");
		setShare(on);
		const res = await fetch("/api/prefs", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shareWords: on }) }).catch(() => null);
		if (!res?.ok) {
			setShare(!on);
			setShareError("Could not save your choice. Please try again.");
		}
	}

	async function change(heard: string, fixed: string) {
		setEditing(null);
		const clean = fixed.trim();
		if (!clean) return;
		setWords((list) => list?.map((w) => (w.heard === heard ? { ...w, fixed: clean } : w)) ?? null);
		const res = await fetch("/api/dictionary", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ heard, fixed: clean }) });
		if (!res.ok) setError("Could not save that word. Please reload and try again.");
		else void load(); // how it is used may change with it
	}

	// The old fixes that are never used (added words, spacing): gone in one go, after asking.
	const unused = (words ?? []).filter((w) => w.use === "off");
	async function forgetUnused() {
		if (!window.confirm(`Remove the ${unused.length} ${unused.length === 1 ? "fix" : "fixes"} that aren't used? Videos you already edited keep theirs.`)) return;
		for (const w of unused) await forget(w.heard);
	}

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
					Every word you fix in a script is remembered here, and fixed for you in your next videos. Only you can see this list. It is never
					used to train AI models.
				</p>
			</div>

			{/* Coach, 11 Nov: clear enough to tick without worry. The same promises are in the Privacy Policy ("Shared word fixes"). */}
			{(share === false || shareOpen) && (
			<section className="flex flex-col gap-2 rounded-xl border border-foreground/15 p-4">
				<label className="flex items-start gap-3">
					<input
						type="checkbox"
						checked={share === true}
						disabled={share === null}
						onChange={(e) => askShare(e.target.checked)}
						className="mt-1 h-4 w-4 shrink-0"
					/>
					<span className="flex flex-col gap-1">
						<span className="font-medium">Help make Komoray more accurate for everyone</span>
						<span className="text-sm text-foreground/70">
							Share the words you fix, without your name. When several creators fix the same mistake, our AI learns to fix it in every
							video, including yours.
						</span>
					</span>
				</label>
				<ul className="ml-7 list-disc pl-4 text-xs text-foreground/60">
					<li>Only the word pair is shared, like &ldquo;ผูหญิง → ผู้หญิง&rdquo;. Never your name, email, videos, or the sentence it came from.</li>
					<li>Only ordinary words. Numbers, links and anything with @ are never shared.</li>
					<li>A fix is only used once at least 3 different creators made the same one, so a fix only you would make, like a friend&apos;s name, is never used.</li>
					<li>Off until you tick it. Untick any time to stop sharing. Fixes shared before stay in the list, without your name.</li>
				</ul>
				{shareError && <p className="ml-7 text-xs text-red-600">{shareError}</p>}
				<p className="ml-7 text-xs text-foreground/50">
					More in our <Link href="/privacy" className="underline">Privacy Policy</Link>.
				</p>
			</section>
			)}

			{error && <p className="text-sm text-red-600">{error}</p>}
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
							Download (CSV)
						</button>
					</div>
					<p className="text-xs text-foreground/60">
						<span className="font-medium">Every video</span>: fixed wherever it shows up. <span className="font-medium">Where it fits</span>: could be right as heard
						in another sentence, so our AI only fixes it where the sentence means it. <span className="font-medium">Not used</span>: added words or spacing, which belong to one video.
						{unused.length > 0 && (
							<>
								{" "}
								<button onClick={() => void forgetUnused()} className="underline hover:text-foreground">
									Remove the {unused.length} not used
								</button>
							</>
						)}
					</p>
					<ul className="flex flex-col divide-y divide-foreground/10 rounded-xl border border-foreground/15">
						{shown.map((w) => (
							<li key={w.heard} className="flex items-center gap-3 px-4 py-2.5">
								{editing?.heard === w.heard ? (
									<form
										className="flex min-w-0 flex-1 items-center gap-2"
										onSubmit={(e) => {
											e.preventDefault();
											void change(w.heard, editing.text);
										}}
									>
										<span className="shrink-0 text-foreground/50 line-through">{w.heard}</span> →
										<input
											autoFocus
											value={editing.text}
											onChange={(e) => setEditing({ heard: w.heard, text: e.target.value })}
											onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
											aria-label={`Fix for ${w.heard}`}
											className="min-w-0 flex-1 rounded-md border border-foreground/20 bg-background px-2 py-1"
										/>
										<button type="submit" className="shrink-0 rounded-md bg-foreground px-2 py-1 text-sm text-background">
											Save
										</button>
										<button type="button" onClick={() => setEditing(null)} className="shrink-0 rounded-md px-2 py-1 text-sm text-foreground/60">
											Cancel
										</button>
									</form>
								) : (
									<>
										<span className="min-w-0 flex-1 break-words">
											<span className="text-foreground/50 line-through">{w.heard}</span> → <span className="font-medium">{w.fixed}</span>
										</span>
										{w.use && (
											<span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${USE_LABEL[w.use].tone}`} title={USE_LABEL[w.use].tip}>
												{USE_LABEL[w.use].text}
											</span>
										)}
										<span className="shrink-0 text-xs text-foreground/50" title="Times you made this fix">
											×{w.uses}
										</span>
										<button
											onClick={() => setEditing({ heard: w.heard, text: w.fixed })}
											className="shrink-0 rounded-md px-2 py-1 text-sm text-foreground/60 hover:bg-foreground/5"
											aria-label={`Edit ${w.fixed}`}
										>
											Edit
										</button>
									</>
								)}
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
			{share === null && shareError && <p className="text-xs text-red-600">{shareError}</p>}
			{share === true && !shareOpen && (
				<p className="text-xs text-foreground/50">
					You share your word fixes to help make Komoray more accurate, without your name.{" "}
					<button onClick={() => setShareOpen(true)} className="underline hover:text-foreground">
						Change
					</button>
				</p>
			)}
		</main>
	);
}
