"use client";

import { Check, Download, Redo2, Scissors, Sparkles, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { SignInCard, useUser } from "@/components/Account";
import type { BadTake } from "@/lib/bad-takes";
import { HeaderMenu } from "@/components/HeaderMenu";
import { ScriptView } from "@/components/ScriptView";
import { VideoReady } from "@/components/VideoReady";
import type { StudioMedia } from "@/components/StudioPlayer";
import type { Banner } from "@/lib/banners";
import { type CutoutLayers, NO_LAYERS } from "@/lib/behind";
import { useCutout } from "@/lib/use-cutout";
import type { Faces } from "@/lib/framing";
import { type Pace, PACES, PADDING } from "@/lib/silences";
import { allCuts, cutSeconds, type Fix, fixedWords, type HandEdits, subtractSpans, type WordFix } from "@/lib/edit";
import { TRANSLATIONS } from "@/lib/languages";
import { reportError } from "@/lib/report";
import { DEFAULT_STYLE, fontMetrics, readStyle, type SubtitleStyle } from "@/lib/subtitle-style";
import { keepSegments, subtitleLines, toSrt } from "@/lib/timeline";
import type { UploadOptions } from "@/lib/upload-options";
import type { ZoomPart } from "@/lib/zoom";

type Cut = { start: number; end: number };
type Analysis = {
	duration: number;
	cuts: Cut[];
	words: { text: string; start: number; end: number }[];
	deleted?: number[];
	fixes?: Fix[];
	dictionaryApplied?: boolean; // the personal dictionary already ran on this video once
	takesApplied?: boolean; // repeated takes were already looked for on this video once
	options?: UploadOptions; // what was asked for when uploading (none on videos from before)
	badTakesApplied?: boolean; // the AI's bad takes were cut once, as asked when uploading
	style?: unknown;
	banners?: Banner[];
	cutout?: CutoutLayers; // text behind the speaker, pictures and clips behind them (lib/behind.ts)
	manual?: Cut[]; // cut by hand on the timeline
	keep?: Cut[]; // silences kept by hand on the timeline
	noZoom?: Cut[]; // parts with Auto zoom turned off on the timeline
	zoomParts?: ZoomPart[]; // parts with their own kind of zoom (the timeline, or the AI's key moments)
	zoomMomentsApplied?: boolean; // the AI's key moments were put in once, as Auto zoom asks when uploading
	pace?: Pace;
	faces?: Faces | null; // where the speaker's face is (found by Modal after the preview copy)
	facesPending?: boolean;
	videoUrl: string; // the small preview copy once it exists, else the original
	studio?: StudioMedia | null; // the preview copy and its sound, for the editor's own player
	proxy?: "done" | "processing" | "failed" | "none";
};
type RenderState = {
	percent?: number; // how far Modal is, while status is processing (not there until the machine has started)
	status: "none" | "processing" | "done" | "failed";
	videoUrl?: string;
	downloadUrl?: string;
	error?: string;
};

const POLL_MS = 5000;
const PROXY_POLL_MS = 10000;
const STYLE_SAVE_DELAY_MS = 600; // dragging a slider changes the style many times a second
const UNDO_STEPS = 100;
const BURST_MS = 1000;
const SAVE_TRIES = 3;
const TRANSLATE_TRIES = 3; // tries for one batch of lines; each batch that works starts the count again
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

// A word and the room around it (up to its neighbours, at most PADDING): what comes back with it.
function wordRoom(words: { start: number; end: number }[], i: number) {
	const prev = words[i - 1];
	const next = words[i + 1];
	return { start: Math.max(prev ? prev.end : 0, words[i].start - PADDING), end: Math.min(next ? next.start : Infinity, words[i].end + PADDING) };
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
	const [translating, setTranslating] = useState<string | null>(null); // what the Translate menu shows while it works
	const [render, setRender] = useState<RenderState>({ status: "none" });
	const renderRun = useRef(0); // counts Make video presses: a slow answer about the last one mustn't set this one's percent
	// False from the press until the server has taken the job. Until then it still answers about the last video.
	const renderAccepted = useRef(true);
	const [showReady, setShowReady] = useState(false); // the finished-video window: opens by itself when a render finishes
	const closeReady = useCallback(() => setShowReady(false), []);
	// Personal dictionary: loaded for a video it hasn't run on yet; what it fixed, to show and undo.
	const [dictionary, setDictionary] = useState<WordFix[] | null>(null);
	const [dictionaryFixed, setDictionaryFixed] = useState<{ count: number; before: Fix[] } | null>(null);
	const [takesFound, setTakesFound] = useState<{ count: number; withoutTakes: number[] } | null>(null);
	// The AI's bad takes (api/bad-takes). Read by itself when Bad takes was ticked when uploading; otherwise
	// only when the creator presses Find bad takes (it costs us, so not for nothing).
	const [badTakes, setBadTakes] = useState<{ status: "checking" | "done" | "failed"; takes: BadTake[] }>({ status: "checking", takes: [] });
	const [findTakes, setFindTakes] = useState(false);
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
			// A video without its own look yet starts with the Brand Kit, then what was asked for when uploading
			// (saved, so Make video uses it too).
			if (!data.style) {
				const brand = (await (await fetch("/api/brand")).json().catch(() => ({}))) as { style?: SubtitleStyle | null };
				let style = brand.style ?? null;
				if (style) {
					// English-only fonts have no Thai letters: a Thai video uses Kanit instead.
					const thai = data.words.some((w) => /[฀-๿]/.test(w.text));
					if (thai && !fontMetrics(style).thai) style = { ...style, font: DEFAULT_STYLE.font };
				}
				const asked = data.options;
				if (asked && (!asked.zoom || !asked.subtitles || asked.audio === false)) {
					style = {
						...(style ?? readStyle(null)),
						...(!asked.zoom && { zoom: "off" as const }),
						...(!asked.subtitles && { subtitles: false }),
						...(asked.audio === false && { audio: false }),
					};
				}
				if (style) {
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
			if (!renderAccepted.current) return;
			const run = renderRun.current;
			const res = await fetch(`/api/render?key=${encodeURIComponent(key)}`);
			const data = (await res.json()) as RenderState;
			if (run !== renderRun.current) return;
			if (data.status === "processing" && data.percent !== undefined) setRender((s) => (s.status === "processing" ? { ...s, percent: Math.max(s.percent ?? 0, data.percent ?? 0) } : s));
			if (data.status === "done" || data.status === "failed") {
				setRender(data);
				if (data.status === "done") setShowReady(true);
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
		(patch: {
			deleted?: number[];
			fixes?: Fix[];
			dictionaryApplied?: boolean;
			takesApplied?: boolean;
			badTakesApplied?: boolean;
			style?: SubtitleStyle;
			banners?: Banner[];
			manual?: Cut[];
			keep?: Cut[];
			noZoom?: Cut[];
			zoomParts?: ZoomPart[];
			zoomMomentsApplied?: boolean;
			cutout?: CutoutLayers;
		}) => {
			if (!key) return;
			setSaveError("");
			const previous = savingRef.current;
			savingRef.current = (async () => {
				await previous;
				try {
					// The server sometimes hiccups (an error page instead of an answer): try a second time.
					for (let attempt = 1; ; attempt++) {
						try {
							const res = await fetch("/api/edit", {
								method: "PUT",
								headers: { "Content-Type": "application/json" },
								body: JSON.stringify({ key, ...patch }),
							});
							const data = (await res.json().catch(() => ({}))) as { error?: string };
							if (!res.ok) throw new Error(data.error ?? `server error ${res.status}`);
							return true;
						} catch (err) {
							if (attempt >= SAVE_TRIES) throw err;
							await new Promise((r) => setTimeout(r, 1000 * attempt));
						}
					}
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

	// Undo / Redo for script and timeline edits (deleted and fixed words, hand cuts, zoom parts) and for
	// banners and Cutout layers: what they were before each change. Without banners in it, Undo after moving
	// a banner skipped back to the last fixed word and brought a wrong subtitle back (coach, 11 Nov).
	type Snapshot = { deleted: number[]; fixes: Fix[]; manual: Cut[]; keep: Cut[]; noZoom: Cut[]; zoomParts: ZoomPart[]; banners: Banner[]; cutout: CutoutLayers };
	const analysisRef = useRef(analysis);
	useEffect(() => {
		analysisRef.current = analysis;
	});
	const cutout = useCutout(key);
	const cutoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const bannersTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const refreshCutoutRef = useRef(cutout.refresh);
	useEffect(() => {
		refreshCutoutRef.current = cutout.refresh;
	});
	const history = useRef<{ past: Snapshot[]; future: Snapshot[] }>({ past: [], future: [] });
	const [historySize, setHistorySize] = useState({ past: 0, future: 0 });
	const snapshot = (): Snapshot => {
		const a = analysisRef.current;
		return { deleted: a?.deleted ?? [], fixes: a?.fixes ?? [], manual: a?.manual ?? [], keep: a?.keep ?? [], noZoom: a?.noZoom ?? [], zoomParts: a?.zoomParts ?? [], banners: a?.banners ?? [], cutout: a?.cutout ?? NO_LAYERS };
	};
	// Banners and Cutout layers change on every key typed and every step of a drag: changes from the same
	// place less than BURST_MS apart are one step to undo.
	const burst = useRef({ from: "", at: 0 });
	const remember = useCallback((from = "") => {
		const now = Date.now();
		const last = burst.current;
		burst.current = { from, at: now };
		if (from && last.from === from && now - last.at < BURST_MS) return;
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
			burst.current = { from: "", at: 0 };
			// A banner or layer change still waiting to be saved would put back what was just undone.
			if (bannersTimer.current) clearTimeout(bannersTimer.current);
			if (cutoutTimer.current) clearTimeout(cutoutTimer.current);
			setAnalysis((a) => (a ? { ...a, ...snap } : a));
			save(snap);
			void savingRef.current?.then(() => refreshCutoutRef.current());
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

	// Words put back in the script also come back where they were cut by hand on the timeline, and
	// words deleted again are cut again even where an edge was dragged to keep them.
	const changeDeleted = useCallback(
		(deleted: number[]) => {
			const a = analysisRef.current;
			if (!a) return;
			remember();
			const now = new Set(deleted);
			const before = new Set(a.deleted ?? []);
			const back = [...before].filter((i) => !now.has(i));
			const gone = deleted.filter((i) => !before.has(i));
			const manual = a.manual?.length && back.length ? subtractSpans(a.manual, back.map((i) => wordRoom(a.words, i))) : a.manual;
			const keep =
				a.keep?.length && gone.length
					? subtractSpans(a.keep, gone.map((i) => ({ start: a.words[i - 1]?.end ?? 0, end: a.words[i + 1]?.start ?? a.duration })))
					: a.keep;
			setAnalysis((b) => (b ? { ...b, deleted, manual, keep } : b));
			save({ deleted, ...(manual !== a.manual && { manual }), ...(keep !== a.keep && { keep }) });
		},
		[save, remember],
	);

	// A cut or keep made on the timeline: deleted words and hand cuts change together.
	const changeTimeline = useCallback(
		(change: { deleted: number[] } & Required<HandEdits>) => {
			remember();
			setAnalysis((a) => (a ? { ...a, ...change } : a));
			save(change);
		},
		[save, remember],
	);

	// Zoom turned off, or given its own kind, for parts of the video (both change together).
	const changeZoom = useCallback(
		(change: { noZoom: Cut[]; zoomParts: ZoomPart[] }) => {
			remember();
			setAnalysis((a) => (a ? { ...a, ...change } : a));
			save(change);
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

	const takesApplied = useCallback(
		(count: number, withoutTakes: number[]) => {
			setAnalysis((a) => (a ? { ...a, takesApplied: true } : a));
			save({ takesApplied: true });
			if (count) setTakesFound({ count, withoutTakes });
		},
		[save],
	);

	// Ask the AI for bad takes once the script is here, one part at a time. It is saved, so it is only paid for once.
	const hasScript = Boolean(analysis?.words?.length);
	// Only if ticked when uploading: videos from before the upload window wait for Find bad takes too.
	const readTakes = analysis?.options?.badTakes === true || findTakes;
	const takeWords = (take: BadTake) => Array.from({ length: take.to - take.from + 1 }, (_, k) => take.from + k);
	// Ticked when uploading: cut them once, when the AI has read the whole script. Never again by itself,
	// so bringing them back sticks.
	const cutFirstTime = useCallback(
		(takes: BadTake[]) => {
			const a = analysisRef.current;
			if (a?.options?.badTakes !== true || a.badTakesApplied) return;
			const words = takes.flatMap((t) => Array.from({ length: t.to - t.from + 1 }, (_, k) => t.from + k));
			if (words.length) changeDeleted([...new Set([...(a.deleted ?? []), ...words])].sort((x, y) => x - y));
			setAnalysis((b) => (b ? { ...b, badTakesApplied: true } : b));
			save({ badTakesApplied: true });
		},
		[changeDeleted, save],
	);
	useEffect(() => {
		if (!key || !hasScript || !readTakes) return;
		let stopped = false;
		void (async () => {
			for (;;) {
				const res = await fetch("/api/bad-takes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) }).catch(() => null);
				if (stopped) return;
				const data = res?.ok ? ((await res.json()) as { takes: BadTake[]; remaining: number; busy?: boolean }) : null;
				if (stopped) return;
				if (!data) return setBadTakes((b) => ({ ...b, status: "failed" }));
				setBadTakes({ status: data.remaining ? "checking" : "done", takes: data.takes });
				if (!data.remaining) return cutFirstTime(data.takes);
				// Another tab is reading this part: wait for it instead of paying again.
				if (data.busy) await new Promise((resolve) => setTimeout(resolve, 3000));
			}
		})();
		return () => {
			stopped = true;
		};
	}, [key, hasScript, readTakes, cutFirstTime]);
	const badWords = badTakes.takes.flatMap(takeWords);
	// One button for all of them: cut every bad take, or bring every one back. Other cuts stay as they are.
	const badTakesCut = badWords.length > 0 && badWords.every((i) => (analysis?.deleted ?? []).includes(i));
	const toggleBadTakes = (cut: boolean) => {
		const words = new Set(badWords);
		const rest = (analysisRef.current?.deleted ?? []).filter((i) => !words.has(i));
		changeDeleted(cut ? [...rest, ...words].sort((a, b) => a - b) : rest);
	};

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

	// Cutout layers: typed into and dragged like banners, so saved a moment after the last change. Then the
	// links to their pictures and clips are fetched again (a new one is shown from this computer meanwhile).
	const refreshCutout = cutout.refresh;
	const changeCutout = useCallback(
		(layers: CutoutLayers) => {
			remember("cutout");
			setAnalysis((a) => (a ? { ...a, cutout: layers } : a));
			if (cutoutTimer.current) clearTimeout(cutoutTimer.current);
			cutoutTimer.current = setTimeout(() => {
				save({ cutout: layers });
				void savingRef.current?.then(() => refreshCutout());
			}, STYLE_SAVE_DELAY_MS);
		},
		[save, refreshCutout, remember],
	);

	// Banners are typed into, so they are saved a moment after the last change too.
	const changeBanners = useCallback(
		(banners: Banner[]) => {
			remember("banners");
			setAnalysis((a) => (a ? { ...a, banners } : a));
			if (bannersTimer.current) clearTimeout(bannersTimer.current);
			bannersTimer.current = setTimeout(() => save({ banners }), STYLE_SAVE_DELAY_MS);
		},
		[save, remember],
	);

	// Key moments (api/zoom-moments): the AI picks where to zoom and how, instead of zooming every take
	// (coach, 6 Nov). Put in by itself once if Auto zoom was ticked when uploading, or with Find key moments.
	// They replace the zoom parts, and the rest of the video stops zooming. Saved, so only paid for once.
	const [moments, setMoments] = useState<"idle" | "finding" | "failed">("idle");
	const subtitleRef = useRef(subtitle);
	useEffect(() => {
		subtitleRef.current = subtitle;
	});
	const findMoments = useCallback(async () => {
		if (!key) return;
		setMoments("finding");
		for (;;) {
			const res = await fetch("/api/zoom-moments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) }).catch(() => null);
			const data = res?.ok ? ((await res.json()) as { parts: ZoomPart[]; remaining: number }) : null;
			if (!data) return setMoments("failed");
			if (data.remaining) continue;
			const a = analysisRef.current;
			changeZoom({ noZoom: a?.noZoom ?? [], zoomParts: data.parts });
			changeSubtitle({ ...subtitleRef.current, zoom: "off" });
			save({ zoomMomentsApplied: true });
			setAnalysis((b) => (b ? { ...b, zoomMomentsApplied: true } : b));
			return setMoments("idle");
		}
	}, [key, changeZoom, changeSubtitle, save]);
	const autoMoments = useRef(false);
	useEffect(() => {
		const a = analysisRef.current;
		if (!key || !hasScript || autoMoments.current || a?.options?.zoom !== true || a.zoomMomentsApplied || a.zoomParts?.length) return;
		autoMoments.current = true;
		void findMoments();
	}, [key, hasScript, findMoments]);

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
		// Save everything as it is on screen once more, so the render uses it even if an earlier save
		// failed (and a style change still waiting for its delay goes out now).
		if (styleTimer.current) clearTimeout(styleTimer.current);
		if (bannersTimer.current) clearTimeout(bannersTimer.current);
		if (cutoutTimer.current) clearTimeout(cutoutTimer.current);
		styleTimer.current = bannersTimer.current = cutoutTimer.current = null;
		save({
			deleted: analysis?.deleted ?? [],
			fixes: analysis?.fixes ?? [],
			style: subtitle,
			banners: analysis?.banners ?? [],
			manual: analysis?.manual ?? [],
			keep: analysis?.keep ?? [],
			noZoom: analysis?.noZoom ?? [],
			zoomParts: analysis?.zoomParts ?? [],
			...(analysis?.cutout && { cutout: analysis.cutout }),
		});
		renderRun.current += 1;
		renderAccepted.current = false;
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
			renderAccepted.current = true;
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
				<p>{loadError}</p>
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
	const finalSeconds = analysis.duration - cutSeconds(allCuts(analysis));
	const filename = key.split("/").pop() ?? key;

	// The subtitles of the final video as a file, same lines and timing as the preview.
	function downloadSrt() {
		if (!analysis) return;
		const segments = keepSegments(analysis.duration, allCuts(analysis));
		saveSrt(toSrt(subtitleLines(fixedWords(analysis.words, analysis.fixes ?? []), segments, subtitle.look, subtitle.size, subtitle.letterSpacing)), "");
	}

	function saveSrt(srt: string, suffix: string) {
		const link = document.createElement("a");
		link.href = URL.createObjectURL(new Blob([srt], { type: "application/x-subrip;charset=utf-8" }));
		link.download = filename.replace(/\.[^.]+$/, "") + suffix + ".srt";
		link.click();
		URL.revokeObjectURL(link.href);
	}

	// Translated subtitles as a file. Each call does one batch (api/translate), so keep asking until none are left.
	async function translateSrt(language: string) {
		setSaveError("");
		setTranslating("Translating…");
		try {
			for (let tries = 0; tries < TRANSLATE_TRIES; ) {
				const res = await fetch("/api/translate", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ key, language }),
				});
				const data = (await res.json().catch(() => ({}))) as { total?: number; remaining?: number; srt?: string; error?: string };
				if (!res.ok) {
					if (++tries === TRANSLATE_TRIES) throw new Error(data.error ?? `Translation failed (${res.status})`);
					continue;
				}
				tries = 0;
				if (data.srt !== undefined) return saveSrt(data.srt, `.${language}`);
				setTranslating(`Translating… ${data.total! - data.remaining!} of ${data.total} lines`);
			}
		} catch (e) {
			const error = e instanceof Error ? e.message : String(e);
			setSaveError(`${error}. Lines already translated are kept, so please try again.`);
			reportError("translate", error, { key });
		} finally {
			setTranslating(null);
		}
	}

	return (
		<main className="font-sans mx-auto flex min-h-screen max-w-7xl flex-col gap-4 p-4 sm:px-6">
			{/* A few buttons only: the settings that go together sit in a menu (coach, 7 Nov: the top was crowded, not minimal). */}
			<header className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground/10 pb-3">
				<div className="flex min-w-0 flex-col">
					<Link href="/projects" className="text-xs text-foreground/60 hover:text-foreground">
						← My projects
					</Link>
					<h1 className="truncate text-lg font-semibold">{filename}</h1>
					<p className="text-xs text-foreground/60">
						{clock(analysis.duration)} → {clock(finalSeconds)} · {analysis.cuts.length} silences ({silentSeconds.toFixed(1)}s)
						{deleted.length > 0 && ` · ${deleted.length} words deleted`}
						{fixes.length > 0 && ` · ${fixes.length} fixed`}
						{(analysis.manual?.length ?? 0) > 0 && ` · ${analysis.manual!.length} cut by hand`}
					</p>
				</div>
				<div className="flex flex-wrap items-center justify-end gap-2">
					<div className="flex items-center">
						<button
							onClick={() => restore("past")}
							disabled={!historySize.past}
							title="Undo (Ctrl+Z)"
							aria-label="Undo"
							className="rounded-l-lg border border-foreground/20 p-2 hover:bg-foreground/5 disabled:opacity-30"
						>
							<Undo2 className="h-3.5 w-3.5" aria-hidden />
						</button>
						<button
							onClick={() => restore("future")}
							disabled={!historySize.future}
							title="Redo (Ctrl+Shift+Z)"
							aria-label="Redo"
							className="-ml-px rounded-r-lg border border-foreground/20 p-2 hover:bg-foreground/5 disabled:opacity-30"
						>
							<Redo2 className="h-3.5 w-3.5" aria-hidden />
						</button>
					</div>
					<HeaderMenu
						icon={Scissors}
						label="Cuts"
						title="Pace, bad takes, language"
						badge={badTakes.status !== "failed" && readTakes && badTakes.takes.length && !badTakesCut ? badTakes.takes.length : undefined}
					>
						<label className="flex flex-col gap-1" title="How short a pause has to be to stay in the video">
							<span className="text-xs font-medium text-foreground/60">Pace</span>
							<select
								value={analysis.pace ?? "natural"}
								onChange={(e) => void changePace(e.target.value as Pace)}
								disabled={paceBusy}
								className="rounded-md border border-foreground/20 bg-background px-1.5 py-1 text-foreground disabled:opacity-50"
							>
								{(Object.keys(PACES) as Pace[]).map((p) => (
									<option key={p} value={p}>
										{PACES[p].name} (cuts pauses over {PACES[p].minSilence}s)
									</option>
								))}
							</select>
							{paceBusy && <span className="text-xs text-foreground/60">Finding silences…</span>}
						</label>
						{badTakes.status !== "failed" && (
							<div className="flex flex-col gap-1">
								<span className="text-xs font-medium text-foreground/60">Bad takes</span>
								{!readTakes ? (
									<button onClick={() => setFindTakes(true)} className="inline-flex items-center gap-1 self-start rounded border border-foreground/20 px-2 py-1 hover:bg-foreground/5">
										<Sparkles className="h-3 w-3 shrink-0" aria-hidden />
										Find bad takes
									</button>
								) : badTakes.status === "checking" ? (
									<span className="inline-flex items-center gap-1 text-foreground/60">
										<Sparkles className="h-3 w-3 shrink-0 animate-pulse" aria-hidden />
										Looking for bad takes…
									</span>
								) : !badTakes.takes.length ? (
									<span className="text-foreground/60">No bad takes found</span>
								) : (
									<button
										onClick={() => toggleBadTakes(!badTakesCut)}
										aria-pressed={badTakesCut}
										title={badTakesCut ? "Bring every bad take back" : "Cut every bad take the AI found. Press again to bring them back"}
										className={`inline-flex items-center gap-1 self-start rounded border px-2 py-1 ${badTakesCut ? "border-blue-600 bg-blue-600 text-white" : "border-foreground/20 hover:bg-foreground/5"}`}
									>
										{badTakesCut ? <Check className="h-3 w-3 shrink-0" aria-hidden /> : <Sparkles className="h-3 w-3 shrink-0" aria-hidden />}
										{badTakesCut ? `Bad takes cut (${badTakes.takes.length})` : `Cut bad takes (${badTakes.takes.length})`}
									</button>
								)}
							</div>
						)}
						<Link href={`/upload?key=${encodeURIComponent(key)}&again=1`} className="text-xs text-foreground/60 underline hover:text-foreground" title="Listen to this video again in another language">
							Wrong language?
						</Link>
					</HeaderMenu>
					<HeaderMenu icon={Download} label="Export" title="Subtitles files, translations, notifications">
						<button onClick={downloadSrt} className="inline-flex items-center gap-1 self-start rounded border border-foreground/20 px-2 py-1 hover:bg-foreground/5">
							<Download className="h-3 w-3 shrink-0" aria-hidden />
							Subtitles (.srt)
						</button>
						<select
							value=""
							onChange={(e) => void translateSrt(e.target.value)}
							disabled={translating !== null}
							aria-label="Translate subtitles"
							className="rounded-md border border-foreground/20 bg-background px-1.5 py-1 text-foreground/80 disabled:opacity-60"
						>
							<option value="" disabled>
								{translating ?? "Translate subtitles (.srt)…"}
							</option>
							{TRANSLATIONS.map((l) => (
								<option key={l.code} value={l.code}>
									{l.name}
								</option>
							))}
						</select>
						<label className="flex items-center gap-2 text-foreground/80">
							<input type="checkbox" checked={desktopNotify} onChange={(e) => void toggleDesktopNotify(e.target.checked)} />
							Notify me on my desktop
						</label>
					</HeaderMenu>
					<button
						onClick={makeVideo}
						disabled={render.status === "processing"}
						className="rounded-lg bg-blue-600 px-5 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
					>
						{render.status === "processing" ? `Making your video…${render.percent === undefined ? "" : ` ${render.percent}%`}` : render.status === "done" ? "Make video again" : "Make video"}
					</button>
				</div>
			</header>

			{notifyBlocked && (
				<p className="text-sm text-foreground/60">
					Your browser is blocking notifications. Click the icon left of the address bar → Notifications → Allow, then tick the box again.
				</p>
			)}
			{saveError && <p className="text-sm text-red-500">{saveError}</p>}
			{dictionaryFixed && (
				<div className="flex flex-wrap items-center gap-3 rounded-xl border border-green-600/30 bg-green-600/5 p-3 text-sm">
					<span>
						Your dictionary fixed {dictionaryFixed.count} {dictionaryFixed.count === 1 ? "word" : "words"} (underlined in green).
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
						<X className="h-3 w-3 shrink-0" aria-hidden />
					</button>
				</div>
			)}
			{/* The plain rule's own notice is only for when the AI could not read the video: it mistakes lists for retries. */}
			{takesFound && badTakes.status === "failed" && (
				<div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
					<span>
						{takesFound.count === 1 ? "A sentence" : `${takesFound.count} sentences`} may have been said more than once. Nothing was cut. They are underlined
						in the script: check them, or pick a take with the repeat mark on the timeline.
					</span>
					<button
						onClick={() => {
							changeDeleted(takesFound.withoutTakes);
							setTakesFound(null);
						}}
						className="rounded-lg border border-foreground/20 px-3 py-1 hover:bg-foreground/5"
					>
						Cut them all
					</button>
					<button onClick={() => setTakesFound(null)} className="text-foreground/50 hover:text-foreground" aria-label="Close">
						<X className="h-3 w-3 shrink-0" aria-hidden />
					</button>
				</div>
			)}
			{render.status === "processing" && (
				<div className="flex flex-col gap-2">
					<div className="h-2 w-full overflow-hidden rounded-full bg-foreground/10">
						<div className="h-full rounded-full bg-blue-600 transition-[width] duration-500" style={{ width: `${render.percent ?? 0}%` }} />
					</div>
					<p className="text-sm text-foreground/70">
						{render.percent === undefined ? "Getting started…" : `Making your video… ${render.percent}%`} Keep editing or switch tabs, you&apos;ll hear a ding when it&apos;s ready.
					</p>
				</div>
			)}
			{render.status === "failed" && <p className="text-sm text-red-500">{render.error}</p>}
			{render.status === "done" && render.videoUrl && (
				<div className="flex flex-wrap items-center gap-3 rounded-xl border border-green-600/30 bg-green-600/5 p-3 text-sm">
					<span>Your video is ready!</span>
					<button onClick={() => setShowReady(true)} className="rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700">
						Watch
					</button>
					<a href={render.downloadUrl} className="rounded-lg border border-foreground/20 px-3 py-1.5 font-medium hover:bg-foreground/5">
						Download video
					</a>
					<span className="text-xs text-foreground/50">Changed something after this? Press Make video again.</span>
				</div>
			)}

			{showReady && render.status === "done" && render.videoUrl && <VideoReady videoUrl={render.videoUrl} downloadUrl={render.downloadUrl} videoKey={key} onClose={closeReady} />}

			<ScriptView
				videoUrl={analysis.videoUrl}
				studio={analysis.studio ?? null}
				duration={analysis.duration}
				words={analysis.words}
				cuts={analysis.cuts}
				deleted={deleted}
				onChange={changeDeleted}
				manual={analysis.manual ?? []}
				keep={analysis.keep ?? []}
				onTimelineChange={changeTimeline}
				noZoom={analysis.noZoom ?? []}
				zoomParts={analysis.zoomParts ?? []}
				onZoomChange={changeZoom}
				moments={moments}
				onFindMoments={() => void findMoments()}
				fixes={fixes}
				onFixesChange={changeFixes}
				dictionary={dictionary}
				onDictionaryApplied={dictionaryApplied}
				onLearn={learn}
				subtitle={subtitle}
				onSubtitleChange={changeSubtitle}
				banners={analysis.banners ?? []}
				onBannersChange={changeBanners}
				cutoutLayers={analysis.cutout ?? NO_LAYERS}
				onCutoutChange={changeCutout}
				cutout={cutout}
				faces={analysis.faces ?? null}
				takesApplied={analysis.takesApplied ?? false}
				onTakesApplied={takesApplied}
				suggested={badTakes.status === "failed" ? null : new Set(readTakes ? badWords : [])}
			/>
		</main>
	);
}
