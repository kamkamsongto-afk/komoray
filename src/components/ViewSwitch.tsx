"use client";

import { LayoutGrid, List } from "lucide-react";
import { useState } from "react";

export type ListView = "grid" | "list";

// Pictures as thumbnails, or as a list of names (coach, 12 Nov: a long list of thumbnails is hard on the eyes).
// Remembered in this browser, one choice per box (storageKey). Read as the box opens: the boxes only show after a
// click in the editor, never in the page the server sends, so this can't differ from it.
export function useListView(storageKey: string) {
	const [view, setView] = useState<ListView>(() => {
		try {
			return typeof window !== "undefined" && localStorage.getItem(storageKey) === "list" ? "list" : "grid";
		} catch {
			return "grid"; // no storage: thumbnails, as before
		}
	});
	const change = (next: ListView) => {
		setView(next);
		try {
			localStorage.setItem(storageKey, next);
		} catch {
			// not remembered, that's fine
		}
	};
	return [view, change] as const;
}

export function ViewSwitch({ view, onChange }: { view: ListView; onChange: (view: ListView) => void }) {
	const button = (id: ListView, Icon: typeof List, name: string) => (
		<button onClick={() => onChange(id)} aria-pressed={view === id} title={name} aria-label={name} className={`rounded p-1 ${view === id ? "bg-blue-400/15 text-foreground ring-1 ring-inset ring-blue-400" : "text-foreground/50 hover:text-foreground"}`}>
			<Icon className="h-3.5 w-3.5" aria-hidden />
		</button>
	);
	return (
		<span className="inline-flex gap-0.5 rounded-md bg-foreground/5 p-0.5">
			{button("grid", LayoutGrid, "Thumbnails")}
			{button("list", List, "List")}
		</span>
	);
}
