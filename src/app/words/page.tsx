"use client";

import Link from "next/link";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { AccountBar, SignInCard, useUser } from "@/components/Account";

// use (lib/word-rules.ts): always = fixed in every new video; ai = only where the sentence fits; off = not used.
type Word = { heard: string; fixed: string; uses: number; updated_at: string; use?: "always" | "ai" | "off" };
const USE_LABEL = {
	always: { text: "Every video", tone: "bg-green-600/10 text-green-700 dark:text-green-400", tip: "It can't be right as heard (or it is a name of yours), so it is fixed in every new video." },
	ai: { text: "Where it fits", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400", tip: "It could be right as heard in another sentence (like สวน and ส่วน), so our AI only fixes it where the sentence means it." },
	off: { text: "Not used", tone: "bg-foreground/10 text-foreground/60", tip: "This fix added or took out words, or only changed spacing. That belongs to one video, so it isn't used again." },
};

const PAGE = 50; // rows shown at first, and added by Show more

// The personal dictionary: every word the user fixed in a script, applied to their next videos.
// They can see it, remove words, and download it (it is theirs).
export default function WordsPage() {
	const user = useUser();
	const [words, setWords] = useState<Word[] | null>(null);
	const [error, setError] = useState("");
	const [filter, setFilter] = useState("");
	// Coach, 14 Nov: a long list was endless and scary. Now like the admin's Words tab: a kind to look at, a sort,
	// PAGE rows at a time, and several picked at once to remove.
	const [kind, setKind] = useState<"all" | "always" | "ai" | "off">("all");
	const [sort, setSort] = useState<"used" | "new" | "az">("used");
	const [limit, setLimit] = useState(PAGE);
	const [picked, setPicked] = useState<Set<string>>(new Set());
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
		await forgetMany(unused.map((w) => w.heard));
	}

	async function forget(heard: string) {
		await forgetMany([heard]);
	}

	// One ask to the server for all of them (picked on the page, or the ones not used).
	async function forgetMany(heards: string[]) {
		if (!heards.length) return;
		const gone = new Set(heards);
		setWords((list) => list?.filter((w) => !gone.has(w.heard)) ?? null);
		setPicked((p) => new Set([...p].filter((h) => !gone.has(h))));
		const res = await fetch("/api/dictionary", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ heards }) }).catch(() => null);
		if (!res?.ok) {
			setError("Could not remove those words. Please try again.");
			void load(); // the list as it really is
		}
	}
	function forgetPicked() {
		const n = picked.size;
		if (!window.confirm(`Remove ${n} ${n === 1 ? "word" : "words"}? Videos you already edited keep theirs.`)) return;
		void forgetMany([...picked]);
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

	const searched = (words ?? []).filter((w) => !filter.trim() || `${w.heard} ${w.fixed}`.toLowerCase().includes(filter.trim().toLowerCase()));
	const countOf = (k: "always" | "ai" | "off") => searched.filter((w) => w.use === k).length;
	const shown = searched
		.filter((w) => kind === "all" || w.use === kind)
		.sort((a, b) => (sort === "az" ? a.heard.localeCompare(b.heard) : sort === "new" ? b.updated_at.localeCompare(a.updated_at) : b.uses - a.uses || a.heard.localeCompare(b.heard)));
	const page = shown.slice(0, limit);
	const pill = (on: boolean) => `rounded-md px-2.5 py-1 text-sm whitespace-nowrap ${on ? "bg-background font-medium shadow-sm" : "text-foreground/70 hover:text-foreground"}`;
	const pick = (heard: string, on: boolean) =>
		setPicked((p) => {
			const next = new Set(p);
			if (on) next.add(heard);
			else next.delete(heard);
			return next;
		});

	return (
		<main className="font-sans mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-4 sm:p-8">
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
				<section className="flex flex-col gap-3">
					<div className="flex flex-wrap items-center gap-2">
						<input
							value={filter}
							onChange={(e) => {
								setFilter(e.target.value);
								setLimit(PAGE);
							}}
							placeholder="Search your words"
							aria-label="Search your words"
							className="min-w-40 flex-1 rounded-md border border-foreground/20 bg-background px-3 py-1.5"
						/>
						<select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort" className="rounded-md border border-foreground/20 bg-background px-2 py-1.5 text-sm">
							<option value="used">Most used</option>
							<option value="new">Newest</option>
							<option value="az">A–Z</option>
						</select>
						<button onClick={download} className="rounded-lg border border-foreground/20 px-3 py-1.5 text-sm hover:bg-foreground/5">
							Download (CSV)
						</button>
					</div>
					{/* The kinds, with what each means on hover, instead of a paragraph above the list. */}
					<div className="flex flex-wrap gap-1 self-start rounded-lg bg-foreground/5 p-0.5">
						{(["all", "always", "ai", "off"] as const).map((k) => (
							<button
								key={k}
								onClick={() => {
									setKind(k);
									setLimit(PAGE);
									setPicked(new Set());
								}}
								title={k === "all" ? undefined : USE_LABEL[k].tip}
								className={pill(kind === k)}
							>
								{k === "all" ? "All" : USE_LABEL[k].text} ({k === "all" ? searched.length : countOf(k)})
							</button>
						))}
					</div>
					{kind === "off" && unused.length > 0 && (
						<p className="text-xs text-foreground/60">
							These added words or only changed spacing, which belong to one video, so they aren&apos;t used again.{" "}
							<button onClick={() => void forgetUnused()} className="underline hover:text-foreground">
								Remove all {unused.length}
							</button>
						</p>
					)}

					{picked.size > 0 && (
						<div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-blue-600/40 bg-background p-2 text-sm shadow">
							<span className="font-medium">{picked.size} picked</span>
							<button onClick={forgetPicked} className="rounded-md border border-red-600/40 px-2.5 py-1 text-red-600 hover:bg-red-600/10">
								Remove
							</button>
							<button onClick={() => setPicked(new Set())} className="ml-auto text-foreground/60 hover:text-foreground">
								Clear
							</button>
						</div>
					)}

					<div className="overflow-x-auto rounded-xl border border-foreground/15">
						<table className="w-full text-left text-sm">
							<thead className="text-xs text-foreground/60">
								<tr>
									<th className="w-8 px-2 py-1.5">
										<input
											type="checkbox"
											aria-label="Pick all shown"
											checked={page.length > 0 && page.every((w) => picked.has(w.heard))}
											onChange={(e) => setPicked(e.target.checked ? new Set(page.map((w) => w.heard)) : new Set())}
										/>
									</th>
									<th className="py-1.5 pr-2 font-medium">Heard → Fixed</th>
									<th className="py-1.5 pr-2 font-medium">Used</th>
									<th className="py-1.5 pr-2 font-medium" title="Times you made this fix">
										Times
									</th>
									<th className="w-16 py-1.5" />
								</tr>
							</thead>
							<tbody>
								{page.map((w) => (
									<tr key={w.heard} className="border-t border-foreground/10 align-middle">
										<td className="px-2 py-1">
											<input type="checkbox" aria-label={`Pick ${w.heard}`} checked={picked.has(w.heard)} onChange={(e) => pick(w.heard, e.target.checked)} />
										</td>
										<td className="py-1 pr-2">
											{editing?.heard === w.heard ? (
												<form
													className="flex flex-wrap items-center gap-1"
													onSubmit={(e) => {
														e.preventDefault();
														void change(w.heard, editing.text);
													}}
												>
													<span className="text-foreground/50 line-through">{w.heard}</span> →
													<input
														autoFocus
														value={editing.text}
														onChange={(e) => setEditing({ heard: w.heard, text: e.target.value })}
														onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
														aria-label={`Fix for ${w.heard}`}
														className="w-36 rounded border border-foreground/20 bg-background px-1.5 py-0.5"
													/>
													<button type="submit" aria-label="Save" className="rounded p-1 text-green-600 hover:bg-green-600/10">
														<Check className="h-4 w-4" aria-hidden />
													</button>
													<button type="button" aria-label="Cancel" onClick={() => setEditing(null)} className="rounded p-1 text-foreground/50 hover:bg-foreground/5">
														<X className="h-4 w-4" aria-hidden />
													</button>
												</form>
											) : (
												<span className="break-words">
													<span className="text-foreground/50 line-through">{w.heard}</span> → <span className="font-medium">{w.fixed}</span>
												</span>
											)}
										</td>
										<td className="whitespace-nowrap py-1 pr-2">
											{w.use && (
												<span className={`rounded-full px-2 py-0.5 text-xs ${USE_LABEL[w.use].tone}`} title={USE_LABEL[w.use].tip}>
													{USE_LABEL[w.use].text}
												</span>
											)}
										</td>
										<td className="py-1 pr-2 text-xs text-foreground/50 tabular-nums">×{w.uses}</td>
										<td className="whitespace-nowrap py-1 text-right">
											<button onClick={() => setEditing({ heard: w.heard, text: w.fixed })} aria-label={`Edit ${w.fixed}`} title="Edit" className="rounded-md p-1.5 text-foreground/50 hover:bg-foreground/5 hover:text-foreground">
												<Pencil className="h-4 w-4" aria-hidden />
											</button>
											<button onClick={() => void forget(w.heard)} aria-label={`Remove ${w.fixed}`} title="Remove" className="rounded-md p-1.5 text-foreground/50 hover:bg-red-600/10 hover:text-red-600">
												<Trash2 className="h-4 w-4" aria-hidden />
											</button>
										</td>
									</tr>
								))}
								{shown.length === 0 && (
									<tr>
										<td colSpan={5} className="px-3 py-3 text-sm text-foreground/60">
											No words here.
										</td>
									</tr>
								)}
							</tbody>
						</table>
					</div>
					<div className="flex flex-wrap items-center gap-3 text-xs text-foreground/50">
						<span>
							{shown.length > page.length ? `Showing ${page.length} of ${shown.length}` : `${shown.length} ${shown.length === 1 ? "word" : "words"}`}
							{shown.length !== words.length && ` (${words.length} in all)`}. Removing a word only stops future fixes; videos you already edited keep theirs.
						</span>
						{shown.length > page.length && (
							<button onClick={() => setLimit(limit + PAGE)} className="rounded-lg border border-foreground/20 px-3 py-1 text-sm text-foreground hover:bg-foreground/5">
								Show {Math.min(PAGE, shown.length - page.length)} more
							</button>
						)}
					</div>
				</section>
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
