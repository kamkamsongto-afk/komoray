"use client";

import { useState } from "react";
import type { Suggestion } from "@/lib/word-suggestions";

type Loaded = { suggestions: Suggestion[]; total: number; videos: number; unread: number; older: number };
type Way = Suggestion["variants"][number]["with"];
const WAYS = { none: "As you fixed it", before: "+ word before", after: "+ word after" } as const;
const STEP = 30;

// Suggestions on the Word Hub tab (lib/word-suggestions.ts): pairs from the admin's own videos that the list doesn't
// have. Read only when opened (it reads every video). added: the list changed, so the tab reads it again.
export function AdminSuggestions({ added }: { added: () => void }) {
	const [data, setData] = useState<Loaded | null>(null);
	const [loading, setLoading] = useState(false);
	const [busy, setBusy] = useState("");
	const [note, setNote] = useState("");
	const [shown, setShown] = useState(STEP);
	// Which way was picked, by its name: after Refresh a suggestion may have fewer ways than before.
	const [chosen, setChosen] = useState<Record<string, Way>>({});
	const [failed, setFailed] = useState<{ id: string; why: string } | null>(null);
	const wayOf = (s: Suggestion) => s.variants.find((v) => v.with === chosen[s.id]) ?? s.variants[s.pick];

	async function load() {
		setLoading(true);
		setNote("");
		const res = await fetch("/api/admin/words/suggestions").catch(() => null);
		const body = (await res?.json().catch(() => null)) as (Loaded & { error?: string }) | null;
		setLoading(false);
		if (!res?.ok || !body?.suggestions) return setNote(body?.error ?? "Could not read your videos. Please try again.");
		setData(body);
	}

	async function decide(s: Suggestion, action: "always" | "ai" | "skip") {
		const way = wayOf(s);
		setBusy(s.id);
		setNote("");
		setFailed(null);
		const res = await fetch("/api/admin/words/suggestions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(action === "skip" ? { action: "skip", id: s.id } : { action: "add", id: s.id, heard: way.heard, fixed: way.fixed, use: action, language: s.language }),
		}).catch(() => null);
		const body = (await res?.json().catch(() => null)) as { error?: string } | null;
		setBusy("");
		if (!res?.ok) return setFailed({ id: s.id, why: body?.error ?? "That didn't work. Please try again." });
		setData((old) => old && { ...old, total: old.total - 1, suggestions: old.suggestions.filter((x) => x.id !== s.id) });
		if (action !== "skip") {
			setNote(`Added ${way.heard} → ${way.fixed} as ${action === "always" ? "Always" : "AI decides"}.`);
			added();
		}
	}

	const button = "rounded-md border border-foreground/20 px-2.5 py-1 hover:bg-foreground/5 disabled:opacity-50";

	return (
		<details className="rounded-xl border border-blue-600/40 p-3" onToggle={(e) => e.currentTarget.open && !data && !loading && void load()}>
			<summary className="cursor-pointer text-sm font-medium">Suggestions from my videos{data ? ` (${data.total})` : ""}</summary>
			<div className="mt-2 flex flex-col gap-2">
				<p className="text-xs text-foreground/60">
					Words you fixed by hand in your own videos that Word Hub doesn&apos;t have yet. Nothing is added until you press a button. Always only when the
					wrong side is never right; otherwise AI decides.
				</p>
				<div className="flex flex-wrap items-center gap-2 text-xs text-foreground/60">
					<button onClick={() => void load()} disabled={loading} className={`${button} text-sm text-foreground`}>
						{loading ? "Reading your videos…" : "Refresh"}
					</button>
					{data && <span>From {data.videos} {data.videos === 1 ? "video" : "videos"} with fixes.</span>}
					{data && data.older > 0 && <span>{data.older} older ones left out.</span>}
					{data && data.unread > 0 && <span className="text-amber-600">{data.unread} could not be read: press Refresh.</span>}
				</div>
				{note && <p className="text-xs text-foreground/70">{note}</p>}
				{data && !data.suggestions.length && <p className="text-sm text-foreground/60">Nothing new to suggest. Fix words in the AI studio, then press Refresh.</p>}
				{data?.suggestions.slice(0, shown).map((s) => {
					const way = wayOf(s);
					return (
						<div key={s.id} className="flex flex-col gap-1.5 rounded-lg border border-foreground/15 p-2.5 text-sm">
							<p className="font-medium">
								{way.heard} <span className="text-foreground/40">→</span> {way.fixed}
								<span className="ml-2 text-xs font-normal text-foreground/60">{way.safe ? "🟢 Safe" : "🟡 Check: could be right somewhere else"}</span>
							</p>
							{s.variants.length > 1 && (
								<div className="flex flex-wrap gap-1 self-start rounded-lg bg-foreground/5 p-0.5 text-xs">
									{s.variants.map((v) => (
										<button key={v.with} onClick={() => setChosen((old) => ({ ...old, [s.id]: v.with }))} aria-pressed={v.with === way.with} className={`rounded-md px-2 py-0.5 ${v.with === way.with ? "bg-background shadow" : "text-foreground/60 hover:text-foreground"}`}>
											{WAYS[v.with]}
										</button>
									))}
								</div>
							)}
							<p className="text-xs text-foreground/60">
								You fixed this {s.times}× · heard {way.seen}× in your videos
								{way.left > 0 && <span className="text-amber-600"> · {way.left} of those would not come out as your script reads: check before Always</span>}
							</p>
							<div className="flex flex-wrap gap-2 text-sm">
								<button onClick={() => void decide(s, "always")} disabled={Boolean(busy)} title="Fixed in every new video, wherever these words show up" className={button}>
									Always
								</button>
								<button onClick={() => void decide(s, "ai")} disabled={Boolean(busy)} title="Shown to the spelling AI, which fixes it only where the sentence fits" className={button}>
									AI decides
								</button>
								<button onClick={() => void decide(s, "skip")} disabled={Boolean(busy)} title="Don't suggest this again" className={`${button} text-foreground/60`}>
									Skip
								</button>
							</div>
							{failed?.id === s.id && <p className="text-xs text-amber-600">{failed.why}</p>}
						</div>
					);
				})}
				{data && data.suggestions.length > shown && (
					<button onClick={() => setShown((n) => n + STEP)} className={`${button} self-start text-sm`}>
						Show more ({data.suggestions.length - shown} left)
					</button>
				)}
			</div>
		</details>
	);
}
