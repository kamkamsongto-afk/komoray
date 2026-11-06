"use client";

import { Captions, Lock, Scissors, Sparkles, Sun, Users, Wand2, ZoomIn } from "lucide-react";
import { useEffect, useRef } from "react";
import { LanguagePicker } from "@/components/LanguagePicker";
import type { UploadOptions as Options } from "@/lib/upload-options";

const READY: { id: keyof Options; name: string; hint: string; icon: typeof Scissors }[] = [
	{ id: "silences", name: "Silences", hint: "Cut the pauses", icon: Scissors },
	{ id: "badTakes", name: "Bad takes", hint: "AI cuts the takes you said again. One click brings them all back", icon: Sparkles },
	{ id: "zoom", name: "Auto zoom", hint: "Moves in slowly, so the video feels alive", icon: ZoomIn },
	{ id: "subtitles", name: "Subtitles", hint: "Your words on the video as you speak", icon: Captions },
];
// Shown so people know they are coming, but they can't be ticked: they don't exist yet.
const SOON = [
	{ name: "Light", hint: "Better light and colour", icon: Sun },
	{ name: "Make-up", hint: "Smoother skin", icon: Wand2 },
	{ name: "Cut person", hint: "Take you out of the background", icon: Users },
];

// Opens when a video is dropped: what Komoray should do with it, and the language it is spoken in (we can't
// tell by ourselves). The upload keeps going behind it. Start waits for the upload to finish if it hasn't.
export function UploadOptions({
	options,
	onOptionsChange,
	language,
	onLanguageChange,
	defaultLanguage,
	onSetDefaultLanguage,
	upload,
	onStart,
	onClose,
}: {
	options: Options;
	onOptionsChange: (options: Options) => void;
	language: string;
	onLanguageChange: (code: string) => void;
	defaultLanguage: string | null;
	onSetDefaultLanguage: (code: string | null) => void;
	upload: { status: "uploading" | "done" | "error"; progress: number; queued: boolean };
	onStart: () => void;
	onClose: () => void;
}) {
	const dialog = useRef<HTMLDivElement>(null);
	const start = useRef<HTMLButtonElement>(null);
	const close = useRef(onClose);
	useEffect(() => {
		close.current = onClose;
	});

	useEffect(() => {
		start.current?.focus();
		const onKey = (e: KeyboardEvent) => {
			if (e.defaultPrevented) return; // the language list closed itself
			if (e.key === "Escape") close.current();
			if (e.key !== "Tab" || !dialog.current) return;
			// Tab stays inside the window: the page behind it can't be used while it is open.
			const stops = [...dialog.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)")];
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
	}, []);

	const waiting = upload.queued && upload.status === "uploading";

	return (
		<div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4" role="presentation">
			<div
				ref={dialog}
				role="dialog"
				aria-modal="true"
				aria-labelledby="upload-options-title"
				className="flex max-h-[92dvh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-2xl border border-foreground/15 bg-background p-5 text-foreground shadow-2xl sm:rounded-2xl sm:p-6"
			>
				<div>
					<h2 id="upload-options-title" className="text-2xl font-bold tracking-tight">
						What should Komoray do?
					</h2>
					<p className="mt-1 text-sm text-foreground/60">Your video keeps uploading meanwhile. You can change all of this later in the AI studio.</p>
				</div>

				<div className="flex flex-col gap-1.5">
					<span className="text-sm font-medium">Spoken language</span>
					<LanguagePicker value={language} onChange={onLanguageChange} defaultCode={defaultLanguage} onSetDefault={onSetDefaultLanguage} />
					<span className="text-xs text-foreground/60">Komoray listens in this language. Star one to make it your default.</span>
				</div>

				<fieldset className="flex flex-col gap-1">
					<legend className="mb-1 text-sm font-medium">Do this for me</legend>
					{READY.map(({ id, name, hint, icon: Icon }) => (
						<label key={id} className="flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-foreground/5">
							<input type="checkbox" checked={options[id]} onChange={(e) => onOptionsChange({ ...options, [id]: e.target.checked })} className="mt-1 h-4 w-4 shrink-0 accent-blue-600" />
							<Icon className="mt-0.5 h-4 w-4 shrink-0 text-foreground/60" aria-hidden />
							<span className="flex flex-col">
								<span className="font-medium">{name}</span>
								<span className="text-xs text-foreground/60">{hint}</span>
							</span>
						</label>
					))}
					{SOON.map(({ name, hint, icon: Icon }) => (
						<div key={name} className="flex items-start gap-3 rounded-lg p-2 text-foreground/40" aria-disabled="true">
							<input type="checkbox" disabled aria-label={`${name}, coming soon`} className="mt-1 h-4 w-4 shrink-0" />
							<Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
							<span className="flex flex-1 flex-col">
								<span className="font-medium">{name}</span>
								<span className="text-xs">{hint}</span>
							</span>
							<span className="flex items-center gap-1 rounded-full border border-foreground/15 px-2 py-0.5 text-xs">
								<Lock className="h-3 w-3" aria-hidden />
								Soon
							</span>
						</div>
					))}
				</fieldset>

				{upload.status === "error" ? (
					<p className="text-sm text-red-500">The upload stopped. Close this window to see why and try again.</p>
				) : (
					<button
						ref={start}
						type="button"
						onClick={onStart}
						disabled={waiting}
						className="min-h-11 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60"
					>
						{waiting ? `Starts when the upload is done · ${upload.progress}%` : upload.status === "uploading" ? `Start · uploading ${upload.progress}%` : "Start"}
					</button>
				)}
				<button type="button" onClick={onClose} className="-mt-2 text-sm text-foreground/60 underline underline-offset-2 hover:text-foreground">
					Close
				</button>
			</div>
		</div>
	);
}
