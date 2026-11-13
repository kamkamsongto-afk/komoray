"use client";

import { Check, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { LANGUAGES } from "@/lib/languages";
import type { WordRow } from "@/lib/shared-words";
import type { WordUse } from "@/lib/word-rules";

// "heard → fixed" on each line; also ->, >, =, a tab or a comma between them (as people paste from a sheet or a chat).
function readLines(text: string) {
	return text
		.split(/\r?\n/)
		.map((line) => line.split(/\s*(?:→|->|>|=|\t|,)\s*/))
		.filter((parts) => parts.length >= 2 && parts[0].trim() && parts[1].trim())
		.map(([heard, fixed]) => ({ heard: heard.trim(), fixed: fixed.trim() }));
}

// What the rules make of a pair (lib/word-rules.ts), and how it can be used.
const RULE = {
	always: { mark: "🟢", text: "Safe", tip: "The heard side is no real word, so it can be fixed everywhere." },
	ai: { mark: "🟡", text: "Needs context", tip: "Both sides could be right (สวน / ส่วน): only the AI may fix it, reading the sentence." },
	off: { mark: "🔴", text: "Suspicious", tip: "It adds or drops words, or only changes spacing: not a spelling fix." },
} as const;
const USE: { id: WordUse; name: string; tip: string }[] = [
	{ id: "always", name: "Always", tip: "Fixed in every new video, wherever these words show up" },
	{ id: "ai", name: "AI decides", tip: "Shown to the spelling AI, which fixes it only where the sentence fits" },
	{ id: "off", name: "Off", tip: "Never used" },
];
const NEW_DAYS = 7;
const listName = (list: string) => (list === "th" ? "Thai" : list === "latin" ? "Other (before 13 Nov)" : (LANGUAGES.find((l) => l.code === list)?.english ?? list));
const keyOf = (r: WordRow) => `${r.source}:${r.heard}`;
// Waiting for the team: anything not looked at that the rules aren't sure of, creators' pairs, and new ones.
const toReview = (r: WordRow) => !r.reviewed && (r.rule !== "always" || r.source === "creators" || (r.at !== undefined && Date.now() - Date.parse(r.at) < NEW_DAYS * 86_400_000));

// The admin page's Words tab: Komoray's own word lists (lib/shared-words.ts), one per language, that the spelling AI
// learns from and "Always" pairs fix by themselves. Creators' shared fixes show only as a pair and how many made it.
export function AdminWords() {
	const [lists, setLists] = useState<Record<string, WordRow[]> | null>(null);
	const [list, setList] = useState("th");
	const [view, setView] = useState<"review" | "all">("review");
	const [sort, setSort] = useState<"used" | "az">("used");
	const [filter, setFilter] = useState("");
	const [paste, setPaste] = useState("");
	const [note, setNote] = useState("");
	const [busy, setBusy] = useState(false);
	const [picked, setPicked] = useState<Set<string>>(new Set());
	const [editing, setEditing] = useState<{ key: string; heard: string; fixed: string } | null>(null);

	const load = () =>
		fetch("/api/admin/words")
			.then((res) => res.json() as Promise<{ lists?: Record<string, WordRow[]>; error?: string }>)
			.then((data) => (data.lists ? setLists(data.lists) : setNote(data.error ?? "Could not load the list")))
			.catch(() => setNote("Could not load the list"));
	useEffect(() => {
		void load();
	}, []);

	const rows = useMemo(() => lists?.[list] ?? [], [lists, list]);
	const shown = useMemo(() => {
		const q = filter.trim().toLowerCase();
		const some = rows.filter((r) => (view === "all" || toReview(r)) && (!q || `${r.heard} ${r.fixed}`.toLowerCase().includes(q)));
		return [...some].sort((a, b) => (sort === "az" ? a.heard.localeCompare(b.heard, list === "th" ? "th" : undefined) : b.uses - a.uses || a.heard.localeCompare(b.heard)));
	}, [rows, view, filter, sort, list]);
	const reviewCount = rows.filter(toReview).length;
	const chosen = shown.filter((r) => picked.has(keyOf(r)));

	async function call(method: "POST" | "PATCH" | "DELETE", body: object, done = "") {
		setBusy(true);
		setNote("");
		const res = await fetch("/api/admin/words", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
		const data = (await res?.json().catch(() => null)) as { added?: number; skipped?: string[]; error?: string } | null;
		setBusy(false);
		if (!res?.ok) {
			setNote(data?.error ?? "That didn't work. Please try again.");
			return null;
		}
		if (done) setNote(done);
		setPicked(new Set());
		await load();
		return data;
	}

	async function add(pairs: { heard: string; fixed: string }[]) {
		if (!pairs.length) return setNote("Nothing to add. Write one pair a line: ผูหญิง → ผู้หญิง");
		const data = await call("POST", { list, pairs });
		if (!data) return;
		setNote(`Added ${data.added}.${data.skipped?.length ? ` Skipped ${data.skipped.length} (numbers, symbols or longer than 30 letters): ${data.skipped.slice(0, 5).join(" · ")}` : ""}`);
		setPaste("");
	}

	async function addMyWords() {
		const res = await fetch("/api/dictionary").catch(() => null);
		const data = (await res?.json().catch(() => null)) as { words?: { heard: string; fixed: string; use?: WordUse }[] } | null;
		// Not the ones that only belong to one video (added words, spacing).
		await add((data?.words ?? []).filter((w) => w.use !== "off").map(({ heard, fixed }) => ({ heard, fixed })));
	}

	const change = (some: WordRow[], patch: { use?: WordUse | null; reviewed?: boolean }, done: string) =>
		call("PATCH", { list, changes: some.map((r) => ({ heard: r.heard, oldFixed: r.fixed, source: r.source, ...patch })) }, done);
	const remove = (some: WordRow[]) => {
		if (!window.confirm(`Delete ${some.length} ${some.length === 1 ? "pair" : "pairs"}? Creators' pairs are taken off for good.`)) return;
		void call("DELETE", { list, heards: some.filter((r) => r.source === "team").map((r) => r.heard), creators: some.filter((r) => r.source === "creators").map((r) => r.heard) }, `Deleted ${some.length}.`);
	};
	const saveEdit = (r: WordRow) => {
		if (!editing) return;
		const heard = editing.heard.trim();
		const fixed = editing.fixed.trim();
		setEditing(null);
		if (!heard || !fixed || (heard === r.heard && fixed === r.fixed)) return;
		void call("PATCH", { list, changes: [{ heard: r.heard, oldFixed: r.fixed, source: r.source, fixed, ...(heard !== r.heard && { newHeard: heard }), reviewed: true }] }, "Saved.");
	};

	function download() {
		const csv = ["heard,fixed,rule,use,source,uses", ...rows.map((r) => [r.heard, r.fixed, r.rule, r.use, r.source, r.uses].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))];
		const link = document.createElement("a");
		link.href = URL.createObjectURL(new Blob(["﻿" + csv.join("\n")], { type: "text/csv;charset=utf-8" }));
		link.download = `komoray-words-${list}.csv`;
		link.click();
		URL.revokeObjectURL(link.href);
	}

	const listsShown = Object.keys(lists ?? { th: [] }).filter((l) => l === "th" || (lists?.[l].length ?? 0) > 0);
	const pill = (on: boolean) => `rounded-md px-3 py-1 text-sm ${on ? "bg-background shadow" : "text-foreground/60 hover:text-foreground"}`;

	return (
		<section className="flex flex-col gap-3">
			<p className="text-sm text-foreground/70">
				Komoray&apos;s word lists, one per language. 🟢 Safe pairs are fixed in every new video by themselves, 🟡 ones only by the spelling AI where the
				sentence fits, 🔴 ones never, unless you choose otherwise. Your own fixes come here by themselves. Creators&apos; shared fixes show only as the pair and
				how many creators made it.
			</p>

			<div className="flex flex-wrap gap-1 rounded-lg bg-foreground/5 p-0.5">
				{listsShown.map((l) => (
					<button key={l} onClick={() => (setList(l), setPicked(new Set()))} className={pill(list === l)}>
						{listName(l)} ({lists?.[l]?.length ?? "…"})
					</button>
				))}
			</div>

			<details className="rounded-xl border border-foreground/15 p-3">
				<summary className="cursor-pointer text-sm font-medium">Add pairs to {listName(list)}</summary>
				<div className="mt-2 flex flex-col gap-2">
					<textarea
						value={paste}
						onChange={(e) => setPaste(e.target.value)}
						rows={4}
						placeholder={"One pair a line, wrong → right:\nผูหญิง → ผู้หญิง\nควคุม → ควบคุม"}
						className="rounded-md border border-foreground/20 bg-background px-3 py-2 text-sm"
					/>
					<div className="flex flex-wrap gap-2">
						<button onClick={() => void add(readLines(paste))} disabled={busy} className="rounded-lg bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-50">
							Add
						</button>
						<button onClick={() => void addMyWords()} disabled={busy} className="rounded-lg border border-foreground/20 px-3 py-1.5 text-sm hover:bg-foreground/5 disabled:opacity-50" title="Every word on your My words page, except the ones that aren't used">
							Add all my words
						</button>
					</div>
				</div>
			</details>
			{note && <p className="text-xs text-foreground/70">{note}</p>}

			<div className="flex flex-wrap items-center gap-2">
				<div className="flex gap-1 rounded-lg bg-foreground/5 p-0.5">
					<button onClick={() => setView("review")} className={pill(view === "review")}>
						To review ({reviewCount})
					</button>
					<button onClick={() => setView("all")} className={pill(view === "all")}>
						All ({rows.length})
					</button>
				</div>
				<select value={sort} onChange={(e) => setSort(e.target.value as "used" | "az")} aria-label="Sort" className="rounded-md border border-foreground/20 bg-background px-2 py-1.5 text-sm">
					<option value="used">Most used</option>
					<option value="az">A–Z</option>
				</select>
				<input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search" className="min-w-32 flex-1 rounded-md border border-foreground/20 bg-background px-3 py-1.5 text-sm" />
				<button onClick={download} className="rounded-lg border border-foreground/20 px-3 py-1.5 text-sm hover:bg-foreground/5">
					Download (CSV)
				</button>
			</div>

			{chosen.length > 0 && (
				<div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-blue-600/40 bg-background p-2 text-sm shadow">
					<span className="font-medium">{chosen.length} picked</span>
					<button disabled={busy} onClick={() => void change(chosen, { reviewed: true }, `Approved ${chosen.length}.`)} className="rounded-md bg-green-600 px-2.5 py-1 text-white disabled:opacity-50">
						Approve
					</button>
					{USE.map((u) => (
						<button key={u.id} disabled={busy} title={u.tip} onClick={() => void change(chosen, { use: u.id, reviewed: true }, `Set ${chosen.length} to ${u.name}.`)} className="rounded-md border border-foreground/20 px-2.5 py-1 hover:bg-foreground/5 disabled:opacity-50">
							{u.name}
						</button>
					))}
					<button disabled={busy} onClick={() => remove(chosen)} className="rounded-md border border-red-600/40 px-2.5 py-1 text-red-600 hover:bg-red-600/10 disabled:opacity-50">
						Delete
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
									checked={shown.length > 0 && shown.slice(0, 500).every((r) => picked.has(keyOf(r)))}
									onChange={(e) => setPicked(e.target.checked ? new Set(shown.slice(0, 500).map(keyOf)) : new Set())}
								/>
							</th>
							<th className="py-1.5 pr-2 font-medium">Heard → Fixed</th>
							<th className="py-1.5 pr-2 font-medium">Check</th>
							<th className="py-1.5 pr-2 font-medium">Used as</th>
							<th className="py-1.5 pr-2 font-medium">From</th>
							<th className="w-16 py-1.5" />
						</tr>
					</thead>
					<tbody>
						{shown.slice(0, 500).map((r) => {
							const key = keyOf(r);
							return (
								<tr key={key} className="border-t border-foreground/10 align-middle">
									<td className="px-2 py-1">
										<input type="checkbox" aria-label={`Pick ${r.heard}`} checked={picked.has(key)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(key); else n.delete(key); return n; })} />
									</td>
									<td className="py-1 pr-2">
										{editing?.key === key ? (
											<form className="flex flex-wrap items-center gap-1" onSubmit={(e) => (e.preventDefault(), saveEdit(r))}>
												<input
													autoFocus
													value={editing.heard}
													onChange={(e) => setEditing({ ...editing, heard: e.target.value })}
													onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
													aria-label="Heard"
													className="w-32 rounded border border-foreground/20 bg-background px-1.5 py-0.5"
												/>
												→
												<input
													value={editing.fixed}
													onChange={(e) => setEditing({ ...editing, fixed: e.target.value })}
													onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
													aria-label="Fixed"
													className="w-32 rounded border border-foreground/20 bg-background px-1.5 py-0.5"
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
												<span className="text-foreground/50 line-through">{r.heard}</span> → <span className="font-medium">{r.fixed}</span>
												{r.reviewed && <span className="ml-1.5 text-xs text-green-600" title="Reviewed by the team">✓</span>}
											</span>
										)}
									</td>
									<td className="whitespace-nowrap py-1 pr-2 text-xs" title={RULE[r.rule].tip}>
										{RULE[r.rule].mark} {RULE[r.rule].text}
									</td>
									<td className="py-1 pr-2">
										<select
											value={r.use}
											disabled={busy}
											onChange={(e) => void change([r], { use: e.target.value as WordUse, reviewed: true }, "Saved.")}
											aria-label={`How ${r.heard} is used`}
											title={USE.find((u) => u.id === r.use)?.tip}
											className={`rounded border border-foreground/20 bg-background px-1 py-0.5 text-xs ${r.set ? "font-medium" : ""}`}
										>
											{USE.map((u) => (
												<option key={u.id} value={u.id}>
													{u.name}
													{!r.set && u.id === r.rule ? " (rules)" : ""}
												</option>
											))}
										</select>
									</td>
									<td className="whitespace-nowrap py-1 pr-2 text-xs text-foreground/60" title={r.source === "team" ? "Times it was added to the list" : "How many creators made this fix (never who)"}>
										{r.source === "team" ? `Team ×${r.uses}` : `${r.uses} creators`}
									</td>
									<td className="whitespace-nowrap py-1 text-right">
										<button onClick={() => setEditing({ key, heard: r.heard, fixed: r.fixed })} aria-label={`Edit ${r.heard}`} className="rounded-md p-1.5 text-foreground/50 hover:bg-foreground/5 hover:text-foreground">
											<Pencil className="h-4 w-4" aria-hidden />
										</button>
										<button onClick={() => remove([r])} aria-label={`Delete ${r.heard}`} className="rounded-md p-1.5 text-foreground/50 hover:bg-red-600/10 hover:text-red-600">
											<Trash2 className="h-4 w-4" aria-hidden />
										</button>
									</td>
								</tr>
							);
						})}
						{lists && shown.length === 0 && (
							<tr>
								<td colSpan={6} className="px-3 py-3 text-sm text-foreground/60">
									{view === "review" ? "Nothing waiting for review here." : "None yet."}
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
			{shown.length > 500 && <p className="text-xs text-foreground/60">Showing 500 of {shown.length}. Search to find the others.</p>}
		</section>
	);
}
