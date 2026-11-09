"use client";

import { useEffect } from "react";

type ConfirmProps = { title: string; body: string; action: string; danger?: boolean; onCancel: () => void; onConfirm: () => void };

// Asks once before something that is easy to do by mistake and costly to undo (coach, 9 Nov).
export function Confirm({ title, body, action, danger, onCancel, onConfirm }: ConfirmProps) {
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
			<div role="alertdialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} className="flex w-full max-w-sm flex-col gap-3 rounded-xl border border-foreground/15 bg-background p-4 text-foreground shadow-2xl">
				<p className="text-sm font-medium break-words">{title}</p>
				<p className="text-xs text-foreground/60">{body}</p>
				<div className="flex justify-end gap-2">
					<button autoFocus onClick={onCancel} className="rounded-md border border-foreground/20 px-3 py-1.5 text-sm hover:bg-foreground/5">
						Cancel
					</button>
					<button onClick={onConfirm} className={`rounded-md px-3 py-1.5 text-sm font-medium text-white ${danger ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"}`}>
						{action}
					</button>
				</div>
			</div>
		</div>
	);
}

// The × on a layer is small and easy to hit by mistake.
export function ConfirmDelete({ name, onCancel, onConfirm }: { name: string; onCancel: () => void; onConfirm: () => void }) {
	return <Confirm title={`Delete ${name}?`} body="It comes off your video." action="Delete" danger onCancel={onCancel} onConfirm={onConfirm} />;
}
