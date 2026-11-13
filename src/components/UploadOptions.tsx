"use client";

import { AudioLines, Captions, Check, Film, Lock, Plus, Scissors, Sparkles, Sun, Users, Wand2, ZoomIn } from "lucide-react";
import { useEffect, useRef } from "react";
import { LanguagePicker } from "@/components/LanguagePicker";
import type { UploadOptions as Options, UploadToggle } from "@/lib/upload-options";

const READY: { id: UploadToggle; name: string; hint: string; icon: typeof Scissors }[] = [
	{ id: "silences", name: "Silences", hint: "Cut the pauses", icon: Scissors },
	{ id: "badTakes", name: "Bad takes", hint: "AI cuts the takes you said again. One click brings them all back", icon: Sparkles },
	{ id: "zoom", name: "Auto zoom", hint: "Moves in slowly, so the video feels alive", icon: ZoomIn },
	{ id: "subtitles", name: "Subtitles", hint: "Your words on the video as you speak", icon: Captions },
	{ id: "audio", name: "Audio optimization", hint: "A clearer voice and less background noise, on both speakers", icon: AudioLines },
];
// Shown so people know they are coming, but they can't be ticked: they don't exist yet.
const SOON = [
	{ name: "Light", hint: "Better light and colour", icon: Sun },
	{ name: "Make-up", hint: "Smoother skin", icon: Wand2 },
	{ name: "Cut person", hint: "Take you out of the background", icon: Users },
];

// Opens when a video is dropped: what Komoray should do with it, and the language it is spoken in (we can't
// tell by ourselves). The upload keeps going behind it, but nothing else happens until Start is pressed
// (and Start waits for the upload to finish if it hasn't).
export function UploadOptions({
	fileName,
	options,
	onOptionsChange,
	language,
	onLanguageChange,
	defaultLanguage,
	onSetDefaultLanguage,
	upload,
	onStart,
	onClose,
	kits = [],
}: {
	fileName: string;
	options: Options;
	onOptionsChange: (options: Options) => void;
	language: string;
	onLanguageChange: (code: string) => void;
	defaultLanguage: string | null;
	onSetDefaultLanguage: (code: string | null) => void;
	upload: { status: "uploading" | "done" | "error"; progress: number };
	onStart: () => void;
	onClose: () => void;
	kits?: { id: string; name: string }[]; // the creator's Brand Kits (api/brand): a choice only when there are two or more
}) {
	const dialog = useRef<HTMLDivElement>(null);
	const close = useRef(onClose);
	useEffect(() => {
		close.current = onClose;
	});

	useEffect(() => {
		// The window itself, not Start: a stray Enter or Space must not begin the work before they have read this.
		dialog.current?.focus();
		const onKey = (e: KeyboardEvent) => {
			if (e.defaultPrevented) return; // the language list closed itself
			if (e.key === "Escape") close.current();
			if (e.key !== "Tab" || !dialog.current) return;
			// Tab stays inside the window: the page behind it can't be used while it is open.
			const stops = [...dialog.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)")];
			const first = stops[0];
			const last = stops[stops.length - 1];
			const here = document.activeElement;
			if (e.shiftKey && (here === first || here === dialog.current || !dialog.current.contains(here))) {
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

	const picked = READY.filter(({ id }) => options[id]).length;

	return (
		<div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-6" role="presentation">
			<div
				ref={dialog}
				tabIndex={-1}
				role="dialog"
				aria-modal="true"
				aria-labelledby="upload-options-title"
				className="flex max-h-[94dvh] w-full max-w-3xl flex-col gap-5 overflow-y-auto rounded-t-2xl border border-foreground/15 bg-background p-5 text-foreground shadow-2xl outline-none sm:rounded-2xl sm:p-8"
			>
				<div className="text-center">
					<h2 id="upload-options-title" className="text-2xl font-bold tracking-tight sm:text-3xl">
						What should Komoray do with this video?
					</h2>
					<p className="mt-2 flex items-center justify-center gap-1.5 text-sm text-foreground/60">
						<Film className="h-4 w-4 shrink-0" aria-hidden />
						<span className="min-w-0 truncate">{fileName}</span>
						<span className="shrink-0">· {upload.status === "uploading" ? `uploading ${upload.progress}%` : upload.status === "done" ? "uploaded" : "upload stopped"}</span>
					</p>
					<p className="mt-1 text-sm text-foreground/60">Nothing starts until you press Start. You can change all of this later in the AI studio.</p>
				</div>

				<div className="mx-auto flex w-full max-w-md flex-col gap-1.5">
					<span className="text-sm font-medium">Spoken language</span>
					<LanguagePicker value={language} onChange={onLanguageChange} defaultCode={defaultLanguage} onSetDefault={onSetDefaultLanguage} />
					<span className="text-xs text-foreground/60">Komoray listens in this language. Star one to make it your default.</span>
				</div>

				{kits.length > 1 && (
					<label className="mx-auto flex w-full max-w-md flex-col gap-1.5">
						<span className="text-sm font-medium">Brand Kit</span>
						<select
							value={options.kit ?? kits[0].id}
							onChange={(e) => onOptionsChange({ ...options, kit: e.target.value })}
							className="rounded-md border border-foreground/20 bg-background px-3 py-2 text-sm"
						>
							{kits.map((k) => (
								<option key={k.id} value={k.id}>
									{k.name}
								</option>
							))}
						</select>
						<span className="text-xs text-foreground/60">The subtitle look this video starts with. Change your kits on the Brand Kit page.</span>
					</label>
				)}

				<fieldset className="grid gap-3 sm:grid-cols-2">
					<legend className="mb-2 text-sm font-medium">Do this for me</legend>
					{READY.map(({ id, name, hint, icon: Icon }) => (
						<label
							key={id}
							className={`flex min-h-20 cursor-pointer items-center gap-3 rounded-xl border-2 p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-400 ${
								options[id] ? "border-blue-500 bg-blue-500/10" : "border-foreground/15 hover:border-foreground/35"
							}`}
						>
							<input type="checkbox" checked={options[id]} onChange={(e) => onOptionsChange({ ...options, [id]: e.target.checked })} className="sr-only" />
							<Icon className={`h-5 w-5 shrink-0 ${options[id] ? "text-blue-500" : "text-foreground/60"}`} aria-hidden />
							<span className="flex min-w-0 flex-1 flex-col">
								<span className="font-semibold">{name}</span>
								<span className="text-xs text-foreground/60">{hint}</span>
							</span>
							{options[id] ? (
								<span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
									<Check className="h-4 w-4" aria-hidden />
								</span>
							) : (
								<Plus className="mx-1 h-5 w-5 shrink-0 text-foreground/50" aria-hidden />
							)}
						</label>
					))}
					{SOON.map(({ name, hint, icon: Icon }) => (
						<div key={name} className="flex min-h-20 items-center gap-3 rounded-xl border-2 border-dashed border-foreground/10 p-3 text-foreground/40" aria-disabled="true">
							<input type="checkbox" disabled aria-label={`${name}, coming soon`} className="sr-only" />
							<Icon className="h-5 w-5 shrink-0" aria-hidden />
							<span className="flex min-w-0 flex-1 flex-col">
								<span className="font-semibold">{name}</span>
								<span className="text-xs">{hint}</span>
							</span>
							<span className="flex shrink-0 items-center gap-1 rounded-full border border-foreground/15 px-2 py-0.5 text-xs">
								<Lock className="h-3 w-3" aria-hidden />
								Soon
							</span>
						</div>
					))}
				</fieldset>

				{upload.status === "error" && <p className="text-center text-sm text-red-500">The upload stopped. Close this window to see why and try again.</p>}
				<div className="flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-4">
					<button type="button" onClick={onClose} className="min-h-11 rounded-lg px-4 text-sm text-foreground/70 hover:bg-foreground/5 hover:text-foreground">
						Close
					</button>
					{upload.status !== "error" && (
						<button
							type="button"
							onClick={onStart}
							className="min-h-12 rounded-xl bg-blue-600 px-8 py-2 font-semibold text-white hover:bg-blue-700"
						>
							{`Start · ${picked} ${picked === 1 ? "thing" : "things"} to do`}
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
