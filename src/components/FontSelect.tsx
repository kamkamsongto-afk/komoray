"use client";

import { ChevronDown, ChevronRight, Folder, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { OwnFont } from "@/lib/font-info";
import { FONTS, type FontId } from "@/lib/subtitle-style";
import { ownValue, type useMyFonts } from "@/lib/use-my-fonts";
import { Confirm } from "./ConfirmDelete";
import { ScrollName } from "./ScrollName";

// The font list as a drop-down that can also delete your own fonts (coach 23 Nov: a plan holds a few, and a full list
// needs room made). Your own fonts sit in a "Your fonts" folder that folds open, each name with a bin in its own slot, so a
// long name never covers it; a name too long for its row waits a moment, then slides along to be read (coach 25 Nov).
// A plain <select> can't hold a button, so this is its own list. value: "" (inherit), a built-in id, "own" or "own:<id>".
// inherit: what the "" row says, when the item can take another's font (a banner takes the subtitles'). builtins: which of
// our fonts are offered.
type Row = { value: string; label: string; disabled?: boolean; id?: string };

export function FontSelect({
	value,
	current,
	myFonts,
	onPick,
	label,
	inherit,
	builtins = Object.keys(FONTS) as FontId[],
}: {
	value: string;
	current?: OwnFont;
	myFonts: ReturnType<typeof useMyFonts>;
	onPick: (value: string) => void;
	label: string;
	inherit?: string;
	builtins?: FontId[];
}) {
	const [open, setOpen] = useState(false);
	const [folder, setFolder] = useState(false);
	const [asking, setAsking] = useState<{ id: string; name: string; use: string | null } | null>(null);
	const [problem, setProblem] = useState("");
	const box = useRef<HTMLDivElement>(null);
	// Clicking anywhere else closes it.
	useEffect(() => {
		if (!open) return;
		const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
		window.addEventListener("pointerdown", away);
		return () => window.removeEventListener("pointerdown", away);
	}, [open]);

	const first: Row[] = inherit ? [{ value: "", label: inherit }] : [];
	const listed = new Set(myFonts.fonts.map((f) => `own:${f.id}`));
	const olderListed = myFonts.older && myFonts.limit !== 0;
	// A font of My files that is not in the list was deleted: it is the standard font now (coach 23 Nov), and the row says so.
	if (current?.file && !listed.has(ownValue(current))) first.push({ value: ownValue(current), label: "Standard font (your font was deleted)" });
	const mine: Row[] = [];
	if (current && !current.file && !listed.has(ownValue(current)) && !(ownValue(current) === "own" && olderListed)) mine.push({ value: ownValue(current), label: current.family });
	if (olderListed) mine.push({ value: "own", label: myFonts.older!.family });
	for (const f of myFonts.fonts) mine.push({ value: `own:${f.id}`, label: `${f.name}${myFonts.usable(f) ? "" : " (Upgrade to use)"}`, disabled: !myFonts.usable(f), id: f.id });
	const ours: Row[] = builtins.map((id) => ({ value: id, label: `${FONTS[id].name}${FONTS[id].thai ? " (Thai)" : ""}` }));
	const picked = [...first, ...mine, ...ours].find((r) => r.value === value) ?? first[0] ?? ours[0];
	const pickedMine = mine.includes(picked);

	const row = (r: Row, own: boolean) => (
		<li key={r.value} role="option" aria-selected={r.value === value} className={`flex items-center ${r.value === value ? "bg-[#4D8DBA]/15" : "hover:bg-foreground/5"}`}>
			<button
				disabled={r.disabled}
				onClick={() => {
					onPick(r.value);
					setOpen(false);
				}}
				className={`flex min-w-0 flex-1 py-1 pr-1 text-left disabled:opacity-40 ${own ? "pl-7" : "pl-2"}`}
			>
				<ScrollName text={r.label} />
			</button>
			{own && (
				// Always as wide, bin or not, so the names line up and none runs under the bin.
				<span className="flex w-8 shrink-0 justify-center">
					{r.id && (
						<button
							onClick={async () => {
								setProblem("");
								const id = r.id as string;
								// Where it is used, to say so in red before it goes.
								setAsking({ id, name: myFonts.fonts.find((f) => f.id === id)?.name ?? r.label, use: await myFonts.usage(id) });
							}}
							aria-label={`Delete the font ${r.label}`}
							title="Delete this font from your files"
							className="rounded p-1.5 text-foreground/50 hover:bg-red-500/10 hover:text-red-600"
						>
							<Trash2 className="h-3.5 w-3.5" aria-hidden />
						</button>
					)}
				</span>
			)}
		</li>
	);

	return (
		<div ref={box} className="relative min-w-0 flex-1">
			<button
				onClick={() => {
					if (!open) setFolder(pickedMine); // your font picked: its folder is open to show it
					setOpen(!open);
				}}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-label={label}
				className="flex w-full items-center gap-1 rounded-md border border-foreground/20 bg-background px-2 py-1 text-left text-xs"
			>
				{pickedMine && <Folder className="h-3 w-3 shrink-0 text-foreground/50" aria-hidden />}
				<ScrollName text={picked.label} />
				<ChevronDown className="h-3.5 w-3.5 shrink-0 text-foreground/50" aria-hidden />
			</button>
			{open && (
				<ul role="listbox" className="absolute left-0 z-40 mt-1 max-h-60 w-full min-w-52 overflow-x-hidden overflow-y-auto rounded-lg border border-foreground/20 bg-background py-1 text-xs shadow-xl">
					{first.map((r) => row(r, false))}
					{mine.length > 0 && (
						<li role="presentation">
							<button onClick={() => setFolder(!folder)} aria-expanded={folder} className="flex w-full items-center gap-1 px-2 py-1 text-left font-medium hover:bg-foreground/5">
								{folder ? <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />}
								<Folder className="h-3.5 w-3.5 shrink-0" aria-hidden />
								Your fonts ({mine.length})
							</button>
							{folder && (
								<ul role="group" aria-label="Your fonts">
									{mine.map((r) => row(r, true))}
								</ul>
							)}
						</li>
					)}
					{ours.map((r) => row(r, false))}
				</ul>
			)}
			{problem && <p className="mt-1 text-[11px] text-red-500">{problem}</p>}
			{asking && (
				<Confirm
					title={`Delete the font "${asking.name}"?`}
					body="It is deleted from your files. This can't be undone."
					warning={asking.use ? `It is used by ${asking.use}. They will all use the standard font instead.` : undefined}
					action="Delete"
					danger
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
