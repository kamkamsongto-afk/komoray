"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

const THEME_PREF = "komoray.theme"; // same name as the script in layout.tsx

// The switch at the top right of every page: white or dark screen. Starts with the computer's setting
// until someone picks, then remembers it in this browser.
export function ThemeToggle() {
	const [dark, setDark] = useState(false);
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

	return (
		<button
			role="switch"
			aria-checked={dark}
			aria-label="Dark screen"
			title={dark ? "Switch to the white screen" : "Switch to the dark screen"}
			onClick={toggle}
			className="relative flex h-7 w-14 items-center justify-between rounded-full border border-foreground/20 bg-foreground/5 px-1.5 text-foreground/50"
		>
			<Sun className="h-3.5 w-3.5" aria-hidden />
			<Moon className="h-3.5 w-3.5" aria-hidden />
			<span
				className={`absolute top-0.5 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-foreground text-background shadow transition-all ${dark ? "left-[calc(100%-24px)]" : "left-0.5"}`}
			>
				{dark ? <Moon className="h-3.5 w-3.5" aria-hidden /> : <Sun className="h-3.5 w-3.5" aria-hidden />}
			</span>
		</button>
	);
}
