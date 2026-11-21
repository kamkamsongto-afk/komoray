"use client";

import type { OwnFont } from "@/lib/font-info";
import { ownValue, type useMyFonts } from "@/lib/use-my-fonts";

// Shared by the subtitle and banner settings: the own fonts in a font <select>, and the question asked when a file with
// a name already used is uploaded (lib/my-files.ts: never written over).

// current: the own font this look or banner has now; always listed, even if it is no longer in the account's list.
export function OwnFontOptions({ current, myFonts }: { current?: OwnFont; myFonts: ReturnType<typeof useMyFonts> }) {
	const listed = new Set(myFonts.fonts.map((f) => `own:${f.id}`));
	const olderListed = myFonts.older && myFonts.limit !== 0;
	return (
		<>
			{current && !listed.has(ownValue(current)) && !(ownValue(current) === "own" && olderListed) && <option value={ownValue(current)}>Your font: {current.family}</option>}
			{olderListed && <option value="own">Your font: {myFonts.older!.family}</option>}
			{myFonts.fonts.map((f) => (
				<option key={f.id} value={`own:${f.id}`} disabled={!myFonts.usable(f)}>
					Your font: {f.name}
					{myFonts.usable(f) ? "" : " (Upgrade to use)"}
				</option>
			))}
		</>
	);
}

export function ClashNote({ clash, what, onUse, onKeep, onCancel }: { clash: { conflict: { name: string } }; what: string; onUse: () => void; onKeep: () => void; onCancel: () => void }) {
	return (
		<span className="flex w-full flex-wrap items-center gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-xs text-foreground">
			A {what} named &ldquo;{clash.conflict.name}&rdquo; is already in your files.
			<button onClick={onUse} className="rounded-md border border-foreground/20 px-2 py-0.5 hover:bg-foreground/5">
				Use that one
			</button>
			<button onClick={onKeep} className="rounded-md border border-foreground/20 px-2 py-0.5 hover:bg-foreground/5">
				Keep both
			</button>
			<button onClick={onCancel} className="text-foreground/60 hover:underline">
				Cancel
			</button>
		</span>
	);
}
