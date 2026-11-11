"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

type ConfirmProps = { title: string; body: string; action: string; danger?: boolean; onCancel: () => void; onConfirm: () => void };

// Asks once before something that is easy to do by mistake and costly to undo (coach, 9 Nov).
export function Confirm({ title, body, action, danger, onCancel, onConfirm }: ConfirmProps) {
	const box = useRef<HTMLDivElement>(null);
	useEffect(() => {
		// While it asks, keys belong to it: Esc closes this question only, not the box behind it, and Delete or
		// Ctrl+Z don't reach the script or the timeline behind it (Codex review 11 Nov). Enter and Space
		// still press its focused button: that is the browser's own doing, not a listener's.
		const onKey = (e: KeyboardEvent) => {
			e.stopPropagation();
			if (e.key === "Escape") onCancel();
			if (e.key !== "Tab") return;
			// Tab goes round its two buttons, never to a button behind it (Codex review 11 Nov).
			const buttons = [...(box.current?.querySelectorAll("button") ?? [])];
			const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
			e.preventDefault();
			buttons[(at + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [onCancel]);

	// Put on the page itself, not inside the box that asks: the timeline sits under the player column, so
	// its question to delete a banner was hidden behind the player and Delete seemed to do nothing (coach, 11 Nov).
	return createPortal(
		<div data-confirm className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="presentation" onClick={onCancel}>
			<div ref={box} role="alertdialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} className="flex w-full max-w-sm flex-col gap-3 rounded-xl border border-foreground/15 bg-background p-4 text-foreground shadow-2xl">
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
		</div>,
		document.body,
	);
}

// The × on a layer is small and easy to hit by mistake.
export function ConfirmDelete({ name, onCancel, onConfirm }: { name: string; onCancel: () => void; onConfirm: () => void }) {
	return <Confirm title={`Delete ${name}?`} body="It comes off your video." action="Delete" danger onCancel={onCancel} onConfirm={onConfirm} />;
}
