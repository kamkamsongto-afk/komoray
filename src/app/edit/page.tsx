"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { SignInCard, useUser } from "@/components/Account";
import { ScriptView } from "@/components/ScriptView";
import type { StudioMedia } from "@/components/StudioPlayer";
import type { Banner } from "@/lib/banners";
import type { Faces } from "@/lib/framing";
import { type Pace, PACES } from "@/lib/silences";
import { allCuts, cutSeconds, type Fix, fixedWords, type WordFix, wordCuts } from "@/lib/edit";
import { reportError } from "@/lib/report";
import { DEFAULT_STYLE, fontMetrics, readStyle, type SubtitleStyle } from "@/lib/subtitle-style";
import { keepSegments, subtitleLines, toSrt } from "@/lib/timeline";

type Cut = { start: number; end: number };
type Analysis = {
	duration: number;
	cuts: Cut[];
	words: { text: string; start: number; end: number }[];
	deleted?: number[];
	fixes?: Fix[];
	dictionaryApplied?: boolean; // the personal dictionary already ran on this video once
	style?: unknown;
	banners?: Banner[];
	pace?: Pace;
	faces?: Faces | null; // where the speaker's face is (found by Modal after the preview copy)
	facesPending?: boolean;
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
const UNDO_STEPS = 100;
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
			// A video without its own look yet starts with the Brand Kit (saved, so Make video uses it too).
			if (!data.style) {
				const brand = (await (await fetch("/api/brand")).json().catch(() => ({}))) as { style?: SubtitleStyle | null };
				if (brand.style) {
					// English-only fonts have no Thai letters: a Thai video uses Kanit instead.
					const thai = data.words.some((w) => /[฀-๿]/.test(w.text));
					const style = thai && !fontMetrics(brand.style).thai ? { ...brand.style, font: DEFAULT_STYLE.font } : brand.style;
					setSubtitle(style);
					void fetch("/api/edit", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: saved, style }) });
				}
			}
			if (!data.dictionaryApplied) {
				const dict = (await (await fetch("/api/dictionary")).json().catch(() => ({}))) as { words?: WordFix[] };
				setDictionary((dict.words ?? []).map(({ heard, fixed }) => ({ heard, fixed })));
			}
			const rendered = (await (await fetch(`/api/render?key=${encodeURIComponent(saved)}`)).json()) as RenderState;
			if (rendered.status !== "none") setRender(rendered);
		})();
	}, [user]);

	// The preview copy (or where the face is) is still being worked out: play the original / frame the
	// middle until it is ready, then switch.
	const proxyPending = analysis?.proxy === "processing" || Boolean(analysis?.facesPending);
	useEffect(() => {
		if (!key || !proxyPending) return;
		const timer = setInterval(async () => {
			const res = await fetch(`/api/analyze?key=${encodeURIComponent(key)}`);
			const data = (await res.json().catch(() => ({}))) as Partial<Analysis>;
			if (!res.ok || data.proxy === "processing" || !data.videoUrl) return;
			setAnalysis((a) => {
				if (!a) return a;
				// Links already in use stay: new ones (new signatures) would restart the player.
				const media = a.proxy === "done" ? {} : { videoUrl: data.videoUrl!, studio: data.studio, proxy: data.proxy };
				return { ...a, ...media, faces: data.faces ?? null, facesPending: data.facesPending };
			});
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
		(patch: { deleted?: number[]; fixes?: Fix[]; dictionaryApplied?: boolean; style?: SubtitleStyle; banners?: Banner[] }) => {
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

	// Undo / Redo for script edits (deleted and fixed words): what they were before each change.
	type Snapshot = { deleted: number[]; fixes: Fix[] };
	const analysisRef = useRef(analysis);
	useEffect(() => {
		analysisRef.current = analysis;
	});
	const history = useRef<{ past: Snapshot[]; future: Snapshot[] }>({ past: [], future: [] });
	const [historySize, setHistorySize] = useState({ past: 0, future: 0 });
	const snapshot = (): Snapshot => ({ deleted: analysisRef.current?.deleted ?? [], fixes: analysisRef.current?.fixes ?? [] });
	const remember = useCallback(() => {
		const h = history.current;
		h.past = [...h.past.slice(-(UNDO_STEPS - 1)), snapshot()];
		h.future = [];
		setHistorySize({ past: h.past.length, future: 0 });
	}, []);
	const restore = useCallback(
		(from: "past" | "future") => {
			const h = history.current;
			const snap = h[from].pop();
			if (!snap) return;
			h[from === "past" ? "future" : "past"].push(snapshot());
			setHistorySize({ past: h.past.length, future: h.future.length });
			setAnalysis((a) => (a ? { ...a, ...snap } : a));
			save(snap);
		},
		[save],
	);

	// Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y), ⌘ on a Mac. Not while typing in a box: that has its own undo.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
			const target = e.target as HTMLElement | null;
			if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
			const k = e.key.toLowerCase();
			if (k === "z" && !e.shiftKey) restore("past");
			else if ((k === "z" && e.shiftKey) || k === "y") restore("future");
			else return;
			e.preventDefault();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [restore]);

	const changeDeleted = useCallback(
		(deleted: number[]) => {
			remember();
			setAnalysis((a) => (a ? { ...a, deleted } : a));
			save({ deleted });
		},
		[save, remember],
	);

	const changeFixes = useCallback(
		(fixes: Fix[]) => {
			remember();
			setAnalysis((a) => (a ? { ...a, fixes } : a));
			save({ fixes });
		},
		[save, remember],
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

	// Banners are typed into, so they are saved a moment after the last change too.
	const bannersTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const changeBanners = useCallback(
		(banners: Banner[]) => {
			setAnalysis((a) => (a ? { ...a, banners } : a));
			if (bannersTimer.current) clearTimeout(bannersTimer.current);
			bannersTimer.current = setTimeout(() => save({ banners }), STYLE_SAVE_DELAY_MS);
		},
		[save],
	);

	// Tighter or looser: the server finds the silences again in the words it has (a second or so).
	const [paceBusy, setPaceBusy] = useState(false);
	async function changePace(pace: Pace) {
		if (!key) return;
		setPaceBusy(true);
		setSaveError("");
		try {
			await savingRef.current;
			const res = await fetch("/api/edit", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, pace }) });
			const data = (await res.json()) as { cuts?: Cut[]; error?: string };
			if (!res.ok || !data.cuts) throw new Error(data.error ?? "Could not change the pace");
			setAnalysis((a) => (a ? { ...a, pace, cuts: data.cuts! } : a));
		} catch (err) {
			const error = err instanceof Error ? err.message : "Could not change the pace";
			setSaveError(`${error}. Please try again.`);
			reportError("pace", error, { key });
		} finally {
			setPaceBusy(false);
		}
	}

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
		if (bannersTimer.current) {
			clearTimeout(bannersTimer.current);
			bannersTimer.current = null;
			save({ banners: analysis?.banners ?? [] });
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

	// The subtitles of the final video as a file, same lines and timing as the preview.
	function downloadSrt() {
		if (!analysis) return;
		const cuts = analysis.cuts.map((c) => ({ ...c, reason: "silence" as const }));
		const segments = keepSegments(analysis.duration, allCuts({ ...analysis, cuts, deleted }));
		const srt = toSrt(subtitleLines(fixedWords(analysis.words, analysis.fixes ?? []), segments, subtitle.look));
		const link = document.createElement("a");
		link.href = URL.createObjectURL(new Blob([srt], { type: "application/x-subrip;charset=utf-8" }));
		link.download = filename.replace(/\.[^.]+$/, "") + ".srt";
		link.click();
		URL.revokeObjectURL(link.href);
	}

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
					<div className="flex items-center gap-1 text-xs">
						<button
							onClick={() => restore("past")}
							disabled={!historySize.past}
							title="Undo (Ctrl+Z)"
							className="rounded border border-foreground/20 px-2 py-0.5 hover:bg-foreground/5 disabled:opacity-30"
						>
							↶ Undo
						</button>
						<button
							onClick={() => restore("future")}
							disabled={!historySize.future}
							title="Redo (Ctrl+Shift+Z)"
							className="rounded border border-foreground/20 px-2 py-0.5 hover:bg-foreground/5 disabled:opacity-30"
						>
							↷ Redo
						</button>
					</div>
					<label className="flex items-center gap-2 text-xs text-foreground/60" title="How short a pause has to be to stay in the video">
						Pace
						<select
							value={analysis.pace ?? "natural"}
							onChange={(e) => void changePace(e.target.value as Pace)}
							disabled={paceBusy}
							className="rounded-md border border-foreground/20 bg-background px-1.5 py-0.5 text-foreground disabled:opacity-50"
						>
							{(Object.keys(PACES) as Pace[]).map((p) => (
								<option key={p} value={p}>
									{PACES[p].name} (cuts pauses over {PACES[p].minSilence}s)
								</option>
							))}
						</select>
						{paceBusy && <span>Finding silences…</span>}
					</label>
				</div>
				<div className="flex flex-col items-end gap-1">
					<button
						onClick={makeVideo}
						disabled={render.status === "processing"}
						className="rounded-lg bg-blue-600 px-5 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
					>
						{render.status === "processing" ? "Making your video…" : render.status === "done" ? "Make video again" : "Make video"}
					</button>
					<button onClick={downloadSrt} className="text-xs text-foreground/60 underline hover:text-foreground">
						⬇️ Subtitles (.srt)
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
				banners={analysis.banners ?? []}
				onBannersChange={changeBanners}
				faces={analysis.faces ?? null}
			/>
		</main>
	);
}
