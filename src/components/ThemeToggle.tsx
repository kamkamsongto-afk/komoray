"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

const THEME_PREF = "komoray.theme"; // same name as the script in layout.tsx

// White or dark screen. Starts with the computer's setting until someone picks, then remembers it in this browser.
export function ThemeToggle() {
	const [dark, setDark] = useState<boolean | null>(null);
	useEffect(() => setDark(getComputedStyle(document.documentElement).colorScheme === "dark"), []);

	function toggle() {
		const next = !dark;
		setDark(next);
		document.documentElement.dataset.theme = next ? "dark" : "light";
		try {
			localStorage.setItem(THEME_PREF, next ? "dark" : "light");
		} catch {
			// not remembered this time
		}
	}

	const label = dark ? "Switch to the white screen" : "Switch to the dark screen";
	return (
		<button onClick={toggle} aria-label={label} title={label} className="rounded-lg p-1.5 text-foreground/70 hover:bg-foreground/5 hover:text-foreground">
			{dark ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
		</button>
	);
}
