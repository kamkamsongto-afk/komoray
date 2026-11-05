"use client";

import { Sparkles, X } from "lucide-react";
import { useState } from "react";
import type { BadTake } from "@/lib/bad-takes";

type Word = { text: string; start: number; end: number };

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const WHAT: Record<BadTake["kind"], string> = { repeat: "Said again", false_start: "False start", self_correction: "Corrected", flub: "Stumble" };

// What the AI suggests cutting. Nothing here is cut until the creator presses Cut.
export function BadTakes({
	status,
	takes,
	words,
	deleted,
	onCut,
	onRestore,
	onKeep,
	onListen,
}: {
	status: "checking" | "done" | "failed";
	takes: BadTake[];
	words: Word[];
	deleted: number[];
	onCut: (take: BadTake) => void;
	onRestore: (take: BadTake) => void;
	onKeep: (take: BadTake) => void;
	onListen: (take: BadTake, isCut: boolean) => void;
}) {
	const [open, setOpen] = useState(true);
	const gone = new Set(deleted);
	if (status === "failed") return null;
	if (status === "checking" && !takes.length) return <p className="text-sm text-foreground/60">Looking for bad takes…</p>;
	if (!takes.length) return null;
	const isCut = (t: BadTake) => {
		for (let i = t.from; i <= t.to; i++) if (!gone.has(i)) return false;
		return true;
	};
	const waiting = takes.filter((t) => !isCut(t)).length;

	return (
		<section aria-label="Suggested cuts" className="rounded-xl border border-amber-500/40 bg-amber-500/5 text-sm">
			<div className="flex flex-wrap items-center justify-between gap-2 p-3">
				<p className="flex items-center gap-2 font-medium">
					<Sparkles className="h-4 w-4 shrink-0" aria-hidden />
					{waiting ? `${waiting} ${waiting === 1 ? "part" : "parts"} you may want to cut` : "All suggestions cut"}
					{status === "checking" && <span className="font-normal text-foreground/60">· still reading</span>}
				</p>
				<button onClick={() => setOpen(!open)} aria-expanded={open} className="min-h-9 rounded-lg px-3 text-foreground/70 hover:bg-foreground/5">
					{open ? "Hide" : "Show"}
				</button>
			</div>
			{open && (
				<>
					<p className="px-3 pb-2 text-xs text-foreground/60">Suggested by AI. Nothing is cut until you press Cut, so listen first.</p>
					<ul className="flex max-h-72 flex-col divide-y divide-foreground/10 overflow-y-auto border-t border-foreground/10">
						{takes.map((take) => {
							const cut = isCut(take);
							return (
								<li key={take.from} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 p-3">
									<div className="min-w-0 flex-1 basis-64">
										<p className={`break-words ${cut ? "text-foreground/50 line-through" : ""}`}>{words.slice(take.from, take.to + 1).map((w) => w.text).join(" ")}</p>
										<p className="mt-0.5 text-xs text-foreground/60">
											{clock(words[take.from]?.start ?? 0)} · {WHAT[take.kind]} · {take.why}
										</p>
									</div>
									<div className="flex flex-none items-center gap-1.5">
										<button onClick={() => onListen(take, cut)} className="min-h-9 rounded-lg border border-foreground/20 px-3 hover:bg-foreground/5">
											Listen
										</button>
										{cut ? (
											<button onClick={() => onRestore(take)} className="min-h-9 rounded-lg border border-foreground/20 px-3 hover:bg-foreground/5">
												Restore
											</button>
										) : (
											<>
												<button onClick={() => onCut(take)} className="min-h-9 rounded-lg bg-foreground px-3 font-medium text-background">
													Cut
												</button>
												<button onClick={() => onKeep(take)} aria-label={`Keep: ${take.why}`} title="Keep this part" className="flex min-h-9 items-center gap-1 rounded-lg px-2 text-foreground/70 hover:bg-foreground/5">
													<X className="h-3.5 w-3.5" aria-hidden />
													Keep
												</button>
											</>
										)}
									</div>
								</li>
							);
						})}
					</ul>
				</>
			)}
		</section>
	);
}
