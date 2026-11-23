"use client";

import { ChevronDown, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { OwnFont } from "@/lib/font-info";
import { FONTS, type FontId } from "@/lib/subtitle-style";
import { ownValue, type useMyFonts } from "@/lib/use-my-fonts";
import { ConfirmDelete } from "./ConfirmDelete";

// The font list of a banner as a drop-down that can also delete your own fonts (coach 23 Nov: a plan holds a few, and a full list
// needs room made): a bin at the right of each "Your font" row, a question before it goes, and the answer if it is still in use.
// A plain <select> can't hold a button, so this is its own list. value: "" (the subtitles' font), a built-in id, "own" or "own:<id>".
export function FontSelect({ value, current, myFonts, onPick }: { value: string; current?: OwnFont; myFonts: ReturnType<typeof useMyFonts>; onPick: (value: string) => void }) {
	const [open, setOpen] = useState(false);
	const [asking, setAsking] = useState<{ id: string; name: string } | null>(null);
	const [problem, setProblem] = useState("");
	const box = useRef<HTMLDivElement>(null);
	// Clicking anywhere else closes it.
	useEffect(() => {
		if (!open) return;
		const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
		window.addEventListener("pointerdown", away);
		return () => window.removeEventListener("pointerdown", away);
	}, [open]);

	type Row = { value: string; label: string; disabled?: boolean; id?: string };
	const rows: Row[] = [{ value: "", label: "Same as the subtitles" }];
	const listed = new Set(myFonts.fonts.map((f) => `own:${f.id}`));
	const olderListed = myFonts.older && myFonts.limit !== 0;
	if (current && !listed.has(ownValue(current)) && !(ownValue(current) === "own" && olderListed)) rows.push({ value: ownValue(current), label: `Your font: ${current.family}` });
	if (olderListed) rows.push({ value: "own", label: `Your font: ${myFonts.older!.family}` });
	for (const f of myFonts.fonts) rows.push({ value: `own:${f.id}`, label: `Your font: ${f.name}${myFonts.usable(f) ? "" : " (Upgrade to use)"}`, disabled: !myFonts.usable(f), id: f.id });
	for (const id of Object.keys(FONTS) as FontId[]) rows.push({ value: id, label: `${FONTS[id].name}${FONTS[id].thai ? " (Thai)" : ""}` });
	const picked = rows.find((r) => r.value === value) ?? rows[0];

	return (
		<div ref={box} className="relative min-w-0 flex-1">
			<button onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open} aria-label="Banner font" className="flex w-full items-center justify-between gap-1 rounded-md border border-foreground/20 bg-background px-2 py-1 text-left text-xs">
				<span className="truncate">{picked.label}</span>
				<ChevronDown className="h-3.5 w-3.5 shrink-0 text-foreground/50" aria-hidden />
			</button>
			{open && (
				<ul role="listbox" className="absolute left-0 z-40 mt-1 max-h-60 w-full min-w-48 overflow-y-auto rounded-lg border border-foreground/20 bg-background py-1 text-xs shadow-xl">
					{rows.map((r) => (
						<li key={r.value} role="option" aria-selected={r.value === value} className={`flex items-center ${r.value === value ? "bg-[#4D8DBA]/15" : "hover:bg-foreground/5"}`}>
							<button
								disabled={r.disabled}
								onClick={() => {
									onPick(r.value);
									setOpen(false);
								}}
								className="min-w-0 flex-1 truncate px-2 py-1 text-left disabled:opacity-40"
							>
								{r.label}
							</button>
							{r.id && (
								<button
									onClick={() => {
										setProblem("");
										setAsking({ id: r.id as string, name: r.label.replace(/^Your font: /, "") });
									}}
									aria-label={`Delete ${r.label}`}
									title="Delete this font from your files"
									className="shrink-0 rounded p-1.5 text-foreground/50 hover:bg-red-500/10 hover:text-red-600"
								>
									<Trash2 className="h-3.5 w-3.5" aria-hidden />
								</button>
							)}
						</li>
					))}
				</ul>
			)}
			{problem && <p className="mt-1 text-[11px] text-red-500">{problem}</p>}
			{asking && (
				<ConfirmDelete
					name={`the font "${asking.name}"`}
					onCancel={() => setAsking(null)}
					onConfirm={async () => {
						const target = asking;
						setAsking(null);
						const why = await myFonts.remove(target.id);
						if (why) setProblem(why);
					}}
				/>
			)}
		</div>
	);
}
