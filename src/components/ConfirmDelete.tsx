"use client";

import { useEffect } from "react";

// "Are you sure?" before a layer goes: the × is small and easy to hit by mistake (coach, 9 Nov).
export function ConfirmDelete({ name, onCancel, onConfirm }: { name: string; onCancel: () => void; onConfirm: () => void }) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.stopPropagation(); // Esc closes this question only, not the box behind it
			onCancel();
		};
		document.addEventListener("keydown", onKey, true);
		return () => document.removeEventListener("keydown", onKey, true);
	}, [onCancel]);

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="presentation" onClick={onCancel}>
			<div role="alertdialog" aria-modal="true" aria-label={`Delete ${name}?`} onClick={(e) => e.stopPropagation()} className="flex w-full max-w-sm flex-col gap-3 rounded-xl border border-foreground/15 bg-background p-4 text-foreground shadow-2xl">
				<p className="text-sm font-medium break-words">Delete {name}?</p>
				<p className="text-xs text-foreground/60">It comes off your video.</p>
				<div className="flex justify-end gap-2">
					<button autoFocus onClick={onCancel} className="rounded-md border border-foreground/20 px-3 py-1.5 text-sm hover:bg-foreground/5">
						Cancel
					</button>
					<button onClick={onConfirm} className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700">
						Delete
					</button>
				</div>
			</div>
		</div>
	);
}
