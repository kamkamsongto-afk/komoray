"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { SignInCard, useUser } from "@/components/Account";
import { ScriptView } from "@/components/ScriptView";
import type { StudioMedia } from "@/components/StudioPlayer";
import { cutSeconds, type Fix, type WordFix, wordCuts } from "@/lib/edit";
import { reportError } from "@/lib/report";
import { readStyle, type SubtitleStyle } from "@/lib/subtitle-style";

type Cut = { start: number; end: number };
type Analysis = {
	duration: number;
	cuts: Cut[];
	words: { text: string; start: number; end: number }[];
	deleted?: number[];
	fixes?: Fix[];
	dictionaryApplied?: boolean; // the personal dictionary already ran on this video once
	style?: unknown;
	videoUrl: string; // the small preview copy once it exists, else the original
	studio?: StudioMedia | null; // the preview copy and its sound, for the editor's own player
	proxy?: "done" | "processing" | "failed" | "none";
};
type RenderState = {
	status: "none" | "processing" | "done" | "failed";
	videoUrl?: string;
	downloadUrl?: string;
	error?: string;
};

const POLL_MS = 5000;
const PROXY_POLL_MS = 10000;
const STYLE_SAVE_DELAY_MS = 600; // dragging a slider changes the style many times a second
const PAGE_TITLE = "Komoray — AI Studio for Talking Heads";
const NOTIFY_PREF = "komoray.desktopNotify"; // remembers the checkbox in this browser

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

// Two soft rising tones, made in the browser so there is no sound file to load.
function ding(audio: AudioContext | null) {
	if (!audio) return;
	[880, 1320].forEach((freq, i) => {
		const osc = audio.createOscillator();
		const gain = audio.createGain();
		const at = audio.currentTime + i * 0.18;
		osc.frequency.value = freq;
		gain.gain.setValueAtTime(0.0001, at);
		gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
		gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
		osc.connect(gain).connect(audio.destination);
		osc.start(at);
		osc.stop(at + 0.4);
	});
}

// Let people work in another tab while the video renders: play a sound, flag the browser tab,
// and pop up a desktop notification only if they ticked the box.
function announce(state: RenderState, audio: AudioContext | null, desktop: boolean) {
	const text = state.status === "done" ? "✅ Your video is ready!" : "❌ Your video could not be made";
	ding(audio);
	if (document.hidden) document.title = `${state.status === "done" ? "✅ Ready" : "❌ Failed"} · Komoray`;
	if (desktop && "Notification" in window && Notification.permission === "granted") {
		const note = new Notification("Komoray", { body: text, icon: "/favicon.svg" });
		note.onclick = () => window.focus();
	}
}

function readNotifyPref() {
	try {
		return localStorage.getItem(NOTIFY_PREF) === "1";
	} catch {
		return false;
	}
}

function saveNotifyPref(on: boolean) {
	try {
		localStorage.setItem(NOTIFY_PREF, on ? "1" : "0");
	} catch {
		// private window etc. — the checkbox just won't be remembered
	}
}

// The editor, full width: script on the left, the final video preview on the right.
// Opened after Find silences, or from My projects (/edit?key=…).
export default function EditPage() {
	const user = useUser();
	const [key, setKey] = useState<string | null>(null);
	const [analysis, setAnalysis] = useState<Analysis | null>(null);
	const [subtitle, setSubtitle] = useState<SubtitleStyle>(readStyle(null));
	const [loadError, setLoadError] = useState("");
	const [saveError, setSaveError] = useState("");
	const [render, setRender] = useState<RenderState>({ status: "none" });
	// Personal dictionary: loaded for a video it hasn't run on yet; what it fixed, to show and undo.
	const [dictionary, setDictionary] = useState<WordFix[] | null>(null);
	const [dictionaryFixed, setDictionaryFixed] = useState<{ count: number; before: Fix[] } | null>(null);
	const [desktopNotify, setDesktopNotify] = useState(false);
	const [notifyBlocked, setNotifyBlocked] = useState(false);
	// Browsers only allow sound after a click, so the Make video click creates this.
	const audioRef = useRef<AudioContext | null>(null);
	// The latest save; Make video waits for it so the render never uses old edits.
	const savingRef = useRef<Promise<boolean>>(Promise.resolve(true));
	const styleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		const granted = "Notification" in window && Notification.permission === "granted";
		setDesktopNotify(granted && readNotifyPref());
	}, []);

	useEffect(() => {
		const saved = new URLSearchParams(window.location.search).get("key");
		if (!user) return;
		if (!saved) return void window.location.replace("/projects");
		void (async () => {
			const res = await fetch(`/api/analyze?key=${encodeURIComponent(saved)}`);
			const data = (await res.json()) as Analysis & { status?: string };
			if (!res.ok) return setLoadError("This project was not found. Videos are deleted after 14 days during the beta.");
			// No script yet: back to the upload page to find the silences first.
			if (data.status !== "done") return void window.location.replace(`/upload?key=${encodeURIComponent(saved)}`);
			setKey(saved);
			setAnalysis(data);
			setSubtitle(readStyle(data.style));
			if (!data.dictionaryApplied) {
				const dict = (await (await fetch("/api/dictionary")).json().catch(() => ({}))) as { words?: WordFix[] };
				setDictionary((dict.words ?? []).map(({ heard, fixed }) => ({ heard, fixed })));
			}
			const rendered = (await (await fetch(`/api/render?key=${encodeURIComponent(saved)}`)).json()) as RenderState;
			if (rendered.status !== "none") setRender(rendered);
		})();
	}, [user]);

	// The preview copy is still being made: play the original until it is ready, then switch.
	const proxyPending = analysis?.proxy === "processing";
	useEffect(() => {
		if (!key || !proxyPending) return;
		const timer = setInterval(async () => {
			const res = await fetch(`/api/analyze?key=${encodeURIComponent(key)}`);
			const data = (await res.json().catch(() => ({}))) as Partial<Analysis>;
			if (!res.ok || data.proxy === "processing" || !data.videoUrl) return;
			setAnalysis((a) => (a ? { ...a, videoUrl: data.videoUrl!, studio: data.studio, proxy: data.proxy } : a));
		}, PROXY_POLL_MS);
		return () => clearInterval(timer);
	}, [key, proxyPending]);

	// While Modal is working, ask the server every few seconds whether the video is ready.
	useEffect(() => {
		if (!key || render.status !== "processing") return;
		const timer = setInterval(async () => {
			const res = await fetch(`/api/render?key=${encodeURIComponent(key)}`);
			const data = (await res.json()) as RenderState;
			if (data.status === "done" || data.status === "failed") {
				setRender(data);
				announce(data, audioRef.current, desktopNotify);
			}
		}, POLL_MS);
		return () => clearInterval(timer);
	}, [key, render.status, desktopNotify]);

	// Put the normal tab title back when the user returns to this tab.
	useEffect(() => {
		const restore = () => {
			if (!document.hidden) document.title = PAGE_TITLE;
		};
		document.addEventListener("visibilitychange", restore);
		return () => document.removeEventListener("visibilitychange", restore);
	}, []);

	// Save edits in the background, one after another so they land in order.
	const save = useCallback(
		(patch: { deleted?: number[]; fixes?: Fix[]; dictionaryApplied?: boolean; style?: SubtitleStyle }) => {
			if (!key) return;
			setSaveError("");
			const previous = savingRef.current;
			savingRef.current = (async () => {
				await previous;
				try {
					const res = await fetch("/api/edit", {
						method: "PUT",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ key, ...patch }),
					});
					const data = (await res.json()) as { error?: string };
					if (!res.ok) throw new Error(data.error ?? "Could not save");
					return true;
				} catch (err) {
					const error = err instanceof Error ? err.message : "Could not save";
					setSaveError(`Your last change was not saved (${error}). Please try again.`);
					reportError("save edit", error, { key });
					return false;
				}
			})();
		},
		[key],
	);

	const changeDeleted = useCallback(
		(deleted: number[]) => {
			setAnalysis((a) => (a ? { ...a, deleted } : a));
			save({ deleted });
		},
		[save],
	);

	const changeFixes = useCallback(
		(fixes: Fix[]) => {
			setAnalysis((a) => (a ? { ...a, fixes } : a));
			save({ fixes });
		},
		[save],
	);

	const dictionaryApplied = useCallback(
		(count: number, before: Fix[]) => {
			setDictionary(null);
			setAnalysis((a) => (a ? { ...a, dictionaryApplied: true } : a));
			save({ dictionaryApplied: true });
			if (count) setDictionaryFixed({ count, before });
		},
		[save],
	);

	// Every fix made in the script goes into the personal dictionary (in the background).
	const learn = useCallback(
		(heard: string, fixed: string | null) => {
			void fetch("/api/dictionary", {
				method: fixed ? "POST" : "DELETE",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ heard, fixed }),
			})
				.then(async (res) => {
					if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
				})
				.catch((err: Error) => reportError("dictionary", err.message, { key }));
		},
		[key],
	);

	const changeSubtitle = useCallback(
		(style: SubtitleStyle) => {
			setSubtitle(style);
			if (styleTimer.current) clearTimeout(styleTimer.current);
			styleTimer.current = setTimeout(() => save({ style }), STYLE_SAVE_DELAY_MS);
		},
		[save],
	);

	async function toggleDesktopNotify(on: boolean) {
		setNotifyBlocked(false);
		if (on && "Notification" in window) {
			const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
			if (permission !== "granted") {
				setNotifyBlocked(true);
				on = false;
			}
		}
		setDesktopNotify(on);
		saveNotifyPref(on);
	}

	async function makeVideo() {
		if (!key) return;
		if (!audioRef.current && "AudioContext" in window) audioRef.current = new AudioContext();
		void audioRef.current?.resume();
		// A style change still waiting for its delay goes out now.
		if (styleTimer.current) {
			clearTimeout(styleTimer.current);
			styleTimer.current = null;
			save({ style: subtitle });
		}
		setRender({ status: "processing" });
		try {
			if (!(await savingRef.current)) throw new Error("Your edits could not be saved. Please try again.");
			const res = await fetch("/api/render", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ key }),
			});
			const data = (await res.json()) as { error?: string };
			if (!res.ok) throw new Error(data.error ?? "Could not start the render");
		} catch (err) {
			const error = err instanceof Error ? err.message : "Could not start the render";
			setRender({ status: "failed", error });
			reportError("make video", error, { key });
		}
	}

	if (user === undefined) return <main className="min-h-screen" />;
	if (user === null) {
		return (
			<main className="font-sans mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-4">
				<SignInCard title="Sign in to edit your video" />
			</main>
		);
	}
	if (loadError) {
		return (
			<main className="font-sans mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-4">
				<p>❌ {loadError}</p>
				<Link href="/projects" className="text-blue-600 underline">
					Back to My projects
				</Link>
			</main>
		);
	}
	if (!analysis || !key) return <main className="font-sans p-8 text-sm text-foreground/60">Loading your video…</main>;

	const deleted = analysis.deleted ?? [];
	const fixes = analysis.fixes ?? [];
	const silentSeconds = cutSeconds(analysis.cuts);
	const finalSeconds = analysis.duration - cutSeconds([...analysis.cuts, ...wordCuts(analysis.words, deleted, analysis.duration)]);
	const filename = key.split("/").pop() ?? key;

	return (
		<main className="font-sans mx-auto flex min-h-screen max-w-7xl flex-col gap-4 p-4 sm:px-6">
			<header className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground/10 pb-3">
				<div className="flex min-w-0 flex-col">
					<Link href="/projects" className="text-xs text-foreground/60 hover:text-foreground">
						← My projects
					</Link>
					<h1 className="truncate text-lg font-semibold">{filename}</h1>
					<p className="text-xs text-foreground/60">
						{clock(analysis.duration)} → {clock(finalSeconds)} · ✂️ {analysis.cuts.length} silences ({silentSeconds.toFixed(1)}s)
						{deleted.length > 0 && ` · 🗑️ ${deleted.length} words deleted`}
						{fixes.length > 0 && ` · ✏️ ${fixes.length} fixed`}
					</p>
				</div>
				<div className="flex flex-col items-end gap-1">
					<button
						onClick={makeVideo}
						disabled={render.status === "processing"}
						className="rounded-lg bg-blue-600 px-5 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
					>
						{render.status === "processing" ? "Making your video…" : render.status === "done" ? "Make video again" : "Make video"}
					</button>
					<label className="flex items-center gap-2 text-xs text-foreground/60">
						<input type="checkbox" checked={desktopNotify} onChange={(e) => void toggleDesktopNotify(e.target.checked)} />
						🔔 Notify me on my desktop
					</label>
				</div>
			</header>

			{notifyBlocked && (
				<p className="text-sm text-foreground/60">
					Your browser is blocking notifications. Click the icon left of the address bar → Notifications → Allow, then tick the box again.
				</p>
			)}
			{saveError && <p className="text-sm text-red-500">❌ {saveError}</p>}
			{dictionaryFixed && (
				<div className="flex flex-wrap items-center gap-3 rounded-xl border border-green-600/30 bg-green-600/5 p-3 text-sm">
					<span>
						✨ Your dictionary fixed {dictionaryFixed.count} {dictionaryFixed.count === 1 ? "word" : "words"} (underlined in green).
					</span>
					<button
						onClick={() => {
							changeFixes(dictionaryFixed.before);
							setDictionaryFixed(null);
						}}
						className="rounded-lg border border-foreground/20 px-3 py-1 hover:bg-foreground/5"
					>
						Undo
					</button>
					<button onClick={() => setDictionaryFixed(null)} className="text-foreground/50 hover:text-foreground" aria-label="Close">
						✕
					</button>
				</div>
			)}
			{render.status === "processing" && (
				<div className="flex flex-col gap-2">
					<div className="h-2 w-full animate-pulse rounded-full bg-blue-600/60" />
					<p className="text-sm text-foreground/70">
						🎬 Making your video… usually 1–3 minutes. Keep editing or switch tabs, you&apos;ll hear a ding when it&apos;s ready.
					</p>
				</div>
			)}
			{render.status === "failed" && <p className="text-sm text-red-500">❌ {render.error}</p>}
			{render.status === "done" && render.videoUrl && (
				<div className="flex flex-wrap items-center gap-3 rounded-xl border border-green-600/30 bg-green-600/5 p-3 text-sm">
					<span>✅ Your video is ready!</span>
					<a href={render.videoUrl} target="_blank" rel="noreferrer" className="text-blue-600 underline">
						▶ Watch
					</a>
					<a href={render.downloadUrl} className="rounded-lg border border-foreground/20 px-3 py-1.5 font-medium hover:bg-foreground/5">
						⬇️ Download video
					</a>
					<span className="text-xs text-foreground/50">Changed something after this? Press Make video again.</span>
				</div>
			)}

			<ScriptView
				videoUrl={analysis.videoUrl}
				studio={analysis.studio ?? null}
				duration={analysis.duration}
				words={analysis.words}
				cuts={analysis.cuts}
				deleted={deleted}
				onChange={changeDeleted}
				fixes={fixes}
				onFixesChange={changeFixes}
				dictionary={dictionary}
				onDictionaryApplied={dictionaryApplied}
				onLearn={learn}
				subtitle={subtitle}
				onSubtitleChange={changeSubtitle}
			/>
		</main>
	);
}
