"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AccessStatus } from "@/lib/access";

// What an invited person is told when they arrive: this is a beta, and how much they can use.
// It shows once per visit until they tick the box, remembered in this browser. It only reads the
// numbers: the server enforces them (lib/access.ts).
const HIDE_KEY = "komoray-beta-welcome-hidden";
const SEEN_KEY = "komoray-beta-welcome-seen";

// Storage can be blocked (private windows). Then the note just shows again, which does no harm.
function read(storage: () => Storage, key: string) {
	try {
		return storage().getItem(key) === "1";
	} catch {
		return false;
	}
}
function remember(storage: () => Storage, key: string) {
	try {
		storage().setItem(key, "1");
	} catch {}
}

const local = () => window.localStorage;
const session = () => window.sessionStorage;

export function BetaWelcome({ access }: { access: AccessStatus }) {
	const [open, setOpen] = useState(() => !read(local, HIDE_KEY) && !read(session, SEEN_KEY));
	const [hide, setHide] = useState(() => read(local, HIDE_KEY));
	const button = useRef<HTMLButtonElement>(null);
	const dialog = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (open) button.current?.focus();
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") close();
			if (e.key !== "Tab" || !dialog.current) return;
			// Tab stays inside the note: the page behind it can't be used while it is open.
			const stops = [...dialog.current.querySelectorAll<HTMLElement>("a[href], button, input")];
			const first = stops[0];
			const last = stops[stops.length - 1];
			const here = document.activeElement;
			if (e.shiftKey && (here === first || !dialog.current.contains(here))) {
				e.preventDefault();
				last?.focus();
			} else if (!e.shiftKey && (here === last || !dialog.current.contains(here))) {
				e.preventDefault();
				first?.focus();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, hide]);

	function close() {
		remember(session, SEEN_KEY);
		try {
			if (hide) local().setItem(HIDE_KEY, "1");
			else local().removeItem(HIDE_KEY);
		} catch {}
		setOpen(false);
	}

	if (!open) {
		return (
			<button type="button" onClick={() => setOpen(true)} className="w-fit text-sm text-foreground/60 underline underline-offset-2 hover:text-foreground">
				Beta limits
			</button>
		);
	}

	const limits = [
		[`${access.limit} minutes for the whole beta`, `Counted from your original video's length. You have ${access.left} left.`],
		[`Up to ${access.perVideo} minutes per video`, `MP4 or MOV, up to ${access.maxGb} GB.`],
		["Videos are deleted after 14 days", "Download what you want to keep."],
		["If Find silences fails on a new video, your minutes come back", "Deleting a video doesn't give its minutes back."],
	];

	return (
		<div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4" role="presentation">
			<div
				ref={dialog}
				role="dialog"
				aria-modal="true"
				aria-labelledby="beta-welcome-title"
				className="flex max-h-[92dvh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-2xl border border-foreground/15 bg-background p-5 text-foreground shadow-2xl sm:rounded-2xl sm:p-6"
			>
				<div>
					<p className="text-sm font-medium text-foreground/60">Free during the beta</p>
					<h2 id="beta-welcome-title" className="mt-1 text-2xl font-bold tracking-tight">
						Welcome to Komoray
					</h2>
				</div>
				<p className="text-foreground/70">You&apos;re one of the first people to try it. Some things may still break, and what you tell us decides what we fix first.</p>
				<ul className="flex flex-col gap-3">
					{limits.map(([title, detail]) => (
						<li key={title} className="border-l-2 border-foreground/20 pl-3">
							<p className="font-medium">{title}</p>
							<p className="text-sm text-foreground/60">{detail}</p>
						</li>
					))}
				</ul>
				<p className="text-sm text-foreground/70">
					Found a problem or need more minutes? Email{" "}
					<a href="mailto:hello@komoray.com" className="underline underline-offset-2">
						hello@komoray.com
					</a>{" "}
					or use the{" "}
					<Link href="/feedback" className="underline underline-offset-2">
						feedback form
					</Link>
					.
				</p>
				<label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
					<input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} className="size-5 shrink-0" />
					Don&apos;t show this again
				</label>
				<button ref={button} type="button" onClick={close} className="min-h-11 rounded-lg bg-foreground px-5 py-2.5 font-medium text-background">
					Got it
				</button>
			</div>
		</div>
	);
}
