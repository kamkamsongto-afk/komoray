"use client";

import { ChevronDown, type LucideIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

// A small button that opens a box of related settings under it: keeps the AI studio's header to a
// few buttons (coach, 7 Nov: the top was getting crowded). Closes on a click outside or Esc.
export function HeaderMenu({ icon: Icon, label, badge, title, children }: { icon: LucideIcon; label: string; badge?: string | number; title?: string; children: ReactNode }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) return;
		const onDown = (e: PointerEvent) => {
			if (!ref.current?.contains(e.target as Node)) setOpen(false);
		};
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
		document.addEventListener("pointerdown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("pointerdown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);
	return (
		<div ref={ref} className="relative">
			<button
				onClick={() => setOpen(!open)}
				aria-expanded={open}
				title={title}
				className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm ${open ? "border-foreground/40 bg-foreground/5" : "border-foreground/20 hover:bg-foreground/5"}`}
			>
				<Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
				{label}
				{badge !== undefined && <span className="rounded-full bg-blue-600 px-1.5 text-[10px] leading-4 font-medium text-white">{badge}</span>}
				<ChevronDown className={`h-3 w-3 shrink-0 text-foreground/50 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
			</button>
			{open && (
				<div className="absolute right-0 z-40 mt-1 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-lg border border-foreground/15 bg-background p-3 text-sm shadow-xl">
					{children}
				</div>
			)}
		</div>
	);
}
