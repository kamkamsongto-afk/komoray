"use client";

import { type Fades, fadesOn } from "@/lib/fades";

// One on / off switch, like an iPhone's.
export function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }) {
	return (
		<label className="inline-flex cursor-pointer items-center gap-1.5 select-none">
			<button
				type="button"
				role="switch"
				aria-checked={on}
				aria-label={label}
				onClick={() => onChange(!on)}
				className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-green-500" : "bg-foreground/25"}`}
			>
				<span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : ""}`} />
			</button>
			<span>{label}</span>
		</label>
	);
}

// Fade in / Fade out (coach 20 Nov, lib/fades.ts): both on at first; off = it comes or goes at once.
export function FadeSwitches({ item, onChange }: { item: Fades; onChange: (patch: Fades) => void }) {
	const on = fadesOn(item);
	return (
		<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-foreground/70">
			<Switch on={on.in} label="Fade in" onChange={(v) => onChange({ fadeIn: v ? undefined : false })} />
			<Switch on={on.out} label="Fade out" onChange={(v) => onChange({ fadeOut: v ? undefined : false })} />
		</div>
	);
}
