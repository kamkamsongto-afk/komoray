"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

type Pair = { heard: string; fixed: string; at: string };
type Lang = "th" | "latin";

// "heard → fixed" on each line; also ->, >, =, a tab or a comma between them (as people paste from a sheet or a chat).
function readLines(text: string) {
	return text
		.split(/\r?\n/)
		.map((line) => line.split(/\s*(?:→|->|>|=|\t|,)\s*/))
		.filter((parts) => parts.length >= 2 && parts[0].trim() && parts[1].trim())
		.map(([heard, fixed]) => ({ heard: heard.trim(), fixed: fixed.trim() }));
}

// The admin page's Words tab: Komoray's own word list (lib/shared-words.ts) that the spelling AI learns from.
export function AdminWords() {
	const [lists, setLists] = useState<Record<Lang, Pair[]> | null>(null);
	const [lang, setLang] = useState<Lang>("th");
	const [filter, setFilter] = useState("");
	const [paste, setPaste] = useState("");
	const [note, setNote] = useState("");
	const [busy, setBusy] = useState(false);

	const load = () =>
		fetch("/api/admin/words")
			.then((res) => res.json() as Promise<Record<Lang, Pair[]>>)
			.then((data) => setLists({ th: data.th ?? [], latin: data.latin ?? [] }))
			.catch(() => setNote("Could not load the list"));
	useEffect(() => {
		void load();
	}, []);

	async function add(pairs: { heard: string; fixed: string }[]) {
		if (!pairs.length) return setNote("Nothing to add. Write one pair a line: ผูหญิง → ผู้หญิง");
		setBusy(true);
		setNote("");
		const res = await fetch("/api/admin/words", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pairs }) }).catch(() => null);
		const data = (await res?.json().catch(() => null)) as { added?: number; skipped?: string[]; error?: string } | null;
		setBusy(false);
		if (!res?.ok || !data) return setNote(data?.error ?? "Could not add them. Please try again.");
		setNote(`Added ${data.added}.${data.skipped?.length ? ` Skipped ${data.skipped.length} (numbers, symbols or longer than 30 letters): ${data.skipped.slice(0, 5).join(" · ")}` : ""}`);
		setPaste("");
		await load();
	}

	async function addMyWords() {
		const res = await fetch("/api/dictionary").catch(() => null);
		const data = (await res?.json().catch(() => null)) as { words?: { heard: string; fixed: string }[] } | null;
		await add((data?.words ?? []).map(({ heard, fixed }) => ({ heard, fixed })));
	}

	async function remove(heard: string) {
		setLists((l) => (l ? { ...l, [lang]: l[lang].filter((p) => p.heard !== heard) } : l));
		const res = await fetch("/api/admin/words", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ heard, lang }) }).catch(() => null);
		if (!res?.ok) setNote("Could not remove it. Please reload.");
	}

	function download() {
		const rows = (lists?.[lang] ?? []).map((p) => [p.heard, p.fixed].map((v) => `"${v.replace(/"/g, '""')}"`).join(","));
		const link = document.createElement("a");
		link.href = URL.createObjectURL(new Blob(["﻿" + ["heard,fixed", ...rows].join("\n")], { type: "text/csv;charset=utf-8" }));
		link.download = `komoray-words-${lang}.csv`;
		link.click();
		URL.revokeObjectURL(link.href);
	}

	const shown = (lists?.[lang] ?? []).filter((p) => !filter.trim() || `${p.heard} ${p.fixed}`.toLowerCase().includes(filter.trim().toLowerCase()));

	return (
		<section className="flex flex-col gap-3">
			<p className="text-sm text-foreground/70">
				Komoray&apos;s own word list. The spelling AI is shown the mistakes on it that appear in each video, and fixes them. Your own word fixes in
				the AI studio come here by themselves (ordinary words only). Nothing here comes from customers.
			</p>
			<div className="flex gap-1 rounded-lg bg-foreground/5 p-0.5 text-sm">
				{(["th", "latin"] as const).map((l) => (
					<button key={l} onClick={() => setLang(l)} className={`flex-1 rounded-md px-3 py-1 ${lang === l ? "bg-background shadow" : "text-foreground/60"}`}>
						{l === "th" ? "Thai" : "Other languages"} ({lists?.[l].length ?? "…"})
					</button>
				))}
			</div>
			<div className="flex flex-col gap-2 rounded-xl border border-foreground/15 p-3">
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
					<button onClick={() => void addMyWords()} disabled={busy} className="rounded-lg border border-foreground/20 px-3 py-1.5 text-sm hover:bg-foreground/5 disabled:opacity-50" title="Every word on your My words page">
						Add all my words
					</button>
				</div>
				{note && <p className="text-xs text-foreground/70">{note}</p>}
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search" className="min-w-40 flex-1 rounded-md border border-foreground/20 bg-background px-3 py-1.5 text-sm" />
				<button onClick={download} className="rounded-lg border border-foreground/20 px-3 py-1.5 text-sm hover:bg-foreground/5">
					Download (CSV)
				</button>
			</div>
			<ul className="flex flex-col divide-y divide-foreground/10 rounded-xl border border-foreground/15">
				{shown.slice(0, 500).map((p) => (
					<li key={p.heard} className="flex items-center gap-3 px-3 py-1.5 text-sm">
						<span className="min-w-0 flex-1 break-words">
							<span className="text-foreground/50 line-through">{p.heard}</span> → <span className="font-medium">{p.fixed}</span>
						</span>
						<button onClick={() => void remove(p.heard)} aria-label={`Remove ${p.heard}`} className="rounded-md p-1.5 text-foreground/50 hover:bg-red-600/10 hover:text-red-600">
							<Trash2 className="h-4 w-4" aria-hidden />
						</button>
					</li>
				))}
				{lists && shown.length === 0 && <li className="px-3 py-2 text-sm text-foreground/60">None yet.</li>}
			</ul>
			{shown.length > 500 && <p className="text-xs text-foreground/60">Showing 500 of {shown.length}. Search to find the others.</p>}
		</section>
	);
}
