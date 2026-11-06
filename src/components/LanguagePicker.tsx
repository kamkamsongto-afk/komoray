"use client";

import { Check, ChevronDown, Search, Star } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Flag } from "@/components/Flag";
import { LANGUAGES } from "@/lib/languages";

type Language = (typeof LANGUAGES)[number];

const matches = (l: Language, query: string) => {
	const q = query.trim().toLowerCase();
	return !q || l.name.toLowerCase().includes(q) || l.english.toLowerCase().includes(q) || l.code === q;
};

// The spoken language: a list with flags, a search box (the list will grow) and a star to make one the
// default, saved to the account (api/prefs) so every new video starts with it.
export function LanguagePicker({
	value,
	onChange,
	defaultCode,
	onSetDefault,
	disabled,
}: {
	value: string;
	onChange: (code: string) => void;
	defaultCode: string | null;
	onSetDefault: (code: string | null) => void;
	disabled?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const box = useRef<HTMLDivElement>(null);
	const search = useRef<HTMLInputElement>(null);
	const listId = useId();
	const picked = LANGUAGES.find((l) => l.code === value) ?? LANGUAGES[0];
	// The default first, then the rest in their usual order.
	const shown = LANGUAGES.filter((l) => matches(l, query)).sort((a, b) => Number(b.code === defaultCode) - Number(a.code === defaultCode));

	useEffect(() => {
		if (!open) return;
		search.current?.focus();
		const away = (e: PointerEvent) => {
			if (!box.current?.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("pointerdown", away);
		return () => document.removeEventListener("pointerdown", away);
	}, [open]);

	const choose = (code: string) => {
		onChange(code);
		setOpen(false);
		setQuery("");
	};

	return (
		<div ref={box} className="relative w-full sm:w-72">
			<button
				type="button"
				onClick={() => {
					setActive(0);
					setOpen(!open);
				}}
				disabled={disabled}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-label={`Spoken language: ${picked.english}`}
				className="flex min-h-10 w-full items-center gap-2 rounded-lg border border-foreground/20 bg-background px-3 py-2 text-left disabled:opacity-50"
			>
				<Flag code={picked.code} />
				<span className="flex-1 truncate">{picked.name}</span>
				{picked.code === defaultCode && <Star className="h-3.5 w-3.5 fill-current text-amber-500" aria-label="Default" />}
				<ChevronDown className="h-4 w-4 text-foreground/50" aria-hidden />
			</button>
			{open && (
				<div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-foreground/20 bg-background shadow-lg">
					<label className="flex items-center gap-2 border-b border-foreground/10 px-3 py-2">
						<Search className="h-4 w-4 text-foreground/50" aria-hidden />
						<input
							ref={search}
							value={query}
							onChange={(e) => {
								setQuery(e.target.value);
								setActive(0);
							}}
							onKeyDown={(e) => {
								if (e.key === "ArrowDown") setActive((i) => Math.min(shown.length - 1, i + 1));
								else if (e.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
								else if (e.key === "Enter" && shown[active]) choose(shown[active].code);
								else if (e.key === "Escape") setOpen(false);
								else return;
								e.preventDefault();
							}}
							placeholder="Search languages"
							aria-label="Search languages"
							role="combobox"
							aria-expanded
							aria-controls={listId}
							aria-activedescendant={shown[active] ? `${listId}-${shown[active].code}` : undefined}
							className="min-w-0 flex-1 bg-transparent text-sm outline-none"
						/>
					</label>
					<ul id={listId} role="listbox" aria-label="Spoken language" className="max-h-64 overflow-y-auto py-1">
						{shown.map((l, i) => (
							<li
								key={l.code}
								id={`${listId}-${l.code}`}
								role="option"
								aria-selected={l.code === value}
								onPointerEnter={() => setActive(i)}
								className={`flex items-center gap-2 px-3 py-1.5 text-sm ${i === active ? "bg-foreground/5" : ""}`}
							>
								<button type="button" onClick={() => choose(l.code)} className="flex min-h-8 min-w-0 flex-1 items-center gap-2 text-left">
									<Flag code={l.code} />
									<span className="truncate">{l.name}</span>
									{l.name !== l.english && <span className="truncate text-xs text-foreground/50">{l.english}</span>}
									{l.code === value && <Check className="ml-auto h-4 w-4 shrink-0 text-blue-600" aria-hidden />}
								</button>
								<button
									type="button"
									onClick={() => onSetDefault(l.code === defaultCode ? null : l.code)}
									title={l.code === defaultCode ? "Your default language. Click to remove" : "Use this language for every new video"}
									aria-label={l.code === defaultCode ? `${l.english} is your default. Remove default` : `Make ${l.english} your default`}
									aria-pressed={l.code === defaultCode}
									className="flex min-h-8 min-w-8 items-center justify-center rounded-md text-foreground/40 hover:bg-foreground/5 hover:text-amber-500"
								>
									<Star className={`h-4 w-4 ${l.code === defaultCode ? "fill-current text-amber-500" : ""}`} aria-hidden />
								</button>
							</li>
						))}
						{!shown.length && <li className="px-3 py-2 text-sm text-foreground/60">No language matches &ldquo;{query}&rdquo;. More are coming.</li>}
					</ul>
				</div>
			)}
		</div>
	);
}
