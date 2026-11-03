"use client";

import { Crop, Film, type LucideIcon, Palette, Pencil, Scissors, Search, Tag, Trash2, Type, Undo2, X, ZoomIn } from "lucide-react";
import { type CSSProperties, memo, type PointerEvent as ReactPointerEvent, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { allCuts, type Fix, fixedWords, mergeSpans, normText, setFix, subtractSpans, TRAIL, type WordFix } from "@/lib/edit";
import type { Banner } from "@/lib/banners";
import type { Faces } from "@/lib/framing";
import { outputSize, type SubtitleStyle } from "@/lib/subtitle-style";
import { findRepeatedTakes, groupTakes, type TakeGroup } from "@/lib/takes";
import { FPS, keepSegments, subtitleLines, toOutSeconds, totalFrames } from "@/lib/timeline";
import { reportError } from "@/lib/report";
import { studioSupported } from "@/lib/player/engine";
import { type PreviewHandle, PreviewPlayer } from "./PreviewPlayer";
import { type StudioMedia, StudioPlayer } from "./StudioPlayer";
import { type ControlSection, SubtitleControls } from "./SubtitleControls";
import { BannerControls } from "./BannerControls";
import { Timeline } from "./Timeline";

type Word = { text: string; start: number; end: number };
type Cut = { start: number; end: number };

const PARAGRAPH_GAP = 1.5; // a pause this long (seconds) starts a new paragraph

const isThai = (text: string) => /[฀-๿]/.test(text);
const script = (text: string) => (isThai(text) ? "thai" : /^\d/.test(text) ? "number" : "latin");
// Deepgram writes sara am as nikhahit + sara aa (ํา), which fonts draw badly.
const fixThai = (text: string) => text.replace(/ํา/g, "ำ");

type Item =
	| { kind: "word"; index: number; last: number; text: string; space: boolean; fixed: boolean }
	| { kind: "silence"; seconds: number; at: number; end: number }
	| { kind: "break" };

// Turn the word list into what we draw: words, "silence cut here" markers, and paragraph breaks.
// A fixed (retyped) run of words is drawn as one word with the new text. Thai words arrive already
// joined from Deepgram's pieces (lib/thai-words.ts).
function layout(words: Word[], cuts: Cut[], fixes: Fix[]): Item[] {
	const fixAt = new Map(fixes.map((f) => [f.from, f]));
	const items: Item[] = [];
	// Thai clips only get spaces where Thai, numbers and English meet (Deepgram also splits English
	// into pieces there: "P r ice"). English clips get a space between every word.
	const thaiClip = words.filter((w) => isThai(w.text)).length > words.length / 2;
	const silenceBetween = (from: number, to: number) => {
		const inside = cuts.filter((c) => c.start >= from - 0.01 && c.end <= to + 0.01);
		return inside.length
			? { seconds: inside.reduce((sum, c) => sum + c.end - c.start, 0), at: inside[0].start, end: inside[inside.length - 1].end }
			: null;
	};

	for (let i = 0; i < words.length; i++) {
		const w = words[i];
		const prev = words[i - 1];
		const fix = fixAt.get(i);
		const silence = silenceBetween(prev ? prev.end : 0, w.start);
		if (prev && w.start - prev.end >= PARAGRAPH_GAP) items.push({ kind: "break" });
		if (silence) items.push({ kind: "silence", ...silence });
		const space = Boolean(prev) && (thaiClip ? script(prev.text) !== script(fix?.text ?? w.text) : true);
		if (fix) {
			items.push({ kind: "word", index: i, last: fix.to, text: fix.text, space, fixed: true });
			i = fix.to;
		} else items.push({ kind: "word", index: i, last: i, text: fixThai(w.text), space, fixed: false });
	}

	const last = words[words.length - 1];
	const tail = last && silenceBetween(last.end, Infinity);
	if (tail) items.push({ kind: "silence", ...tail });
	return items;
}

type WordActions = { click: (index: number) => void; edit: (from: number, to: number) => void };
type WordItem = Extract<Item, { kind: "word" }>;

const norm = normText;

// Every run of drawn words that reads `query`. Runs can span several words ("the best", or a Thai
// phrase Deepgram split into pieces). trail = punctuation after the run, kept when replacing.
function findMatches(words: WordItem[], query: string) {
	const target = norm(query);
	const matches: { from: number; to: number; trail: string }[] = [];
	if (!target) return matches;
	for (let i = 0; i < words.length; i++) {
		let text = "";
		for (let j = i; j < words.length; j++) {
			text += (j > i && words[j].space ? " " : "") + words[j].text;
			const n = norm(text);
			if (n === target) {
				matches.push({ from: words[i].index, to: words[j].last, trail: words[j].text.match(TRAIL)?.[0] ?? "" });
				i = j;
				break;
			}
			if (n.length >= target.length || !target.startsWith(n)) break;
		}
	}
	return matches;
}

// One word of the script. Memoized: while playing, the highlight moves a few times a second, and
// redrawing thousands of words each time froze long scripts (and the preview drawn on the page).
const WordSpan = memo(function WordSpan({
	item,
	gone,
	active,
	retake,
	heardAs,
	actions,
}: {
	item: WordItem;
	gone: boolean;
	active: boolean;
	retake: boolean; // the kept take of a sentence said more than once (🔁 on the timeline)
	heardAs: string | null;
	actions: RefObject<WordActions>;
}) {
	return (
		<>
			{item.space && " "}
			<span
				data-word={item.index}
				data-last={item.last}
				onClick={() => actions.current.click(item.index)}
				onDoubleClick={() => actions.current.edit(item.index, item.last)}
				title={heardAs !== null ? `Fixed · heard as "${heardAs}"` : undefined}
				className={`cursor-pointer rounded transition-colors ${
					gone ? "text-red-600/60 line-through decoration-2" : active ? "bg-blue-600 text-white" : retake ? "bg-amber-500/15 hover:bg-amber-500/25" : "hover:bg-foreground/10"
				} ${item.fixed ? "underline decoration-green-600 decoration-2 underline-offset-4" : retake && !gone ? "underline decoration-amber-500 decoration-dashed decoration-2 underline-offset-4" : ""}`}
			>
				{item.text}
			</span>
		</>
	);
});

// Index of the word being said at time t (-1 before the first word).
function wordAt(words: Word[], t: number) {
	let lo = 0;
	let hi = words.length - 1;
	let found = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (words[mid].start <= t) {
			found = mid;
			lo = mid + 1;
		} else hi = mid - 1;
	}
	return found;
}

type Props = {
	videoUrl: string;
	studio: StudioMedia | null; // the preview copy for our own player; null until it is made
	duration: number;
	words: Word[];
	cuts: Cut[];
	deleted: number[];
	onChange: (deleted: number[]) => void;
	// Cut and kept by hand on the timeline; a timeline edit changes them and the deleted words together.
	manual: Cut[];
	keep: Cut[];
	onTimelineChange: (change: { deleted: number[]; manual: Cut[]; keep: Cut[] }) => void;
	noZoom: Cut[]; // parts with Auto zoom turned off (lib/zoom.ts)
	onNoZoomChange: (noZoom: Cut[]) => void;
	fixes: Fix[];
	onFixesChange: (fixes: Fix[]) => void;
	// Personal dictionary: apply it once (then onDictionaryApplied), and learn from every fix made here.
	dictionary?: WordFix[] | null;
	onDictionaryApplied?: (count: number, before: Fix[]) => void;
	onLearn?: (heard: string, fixed: string | null) => void; // null: forget (original words put back)
	subtitle: SubtitleStyle;
	onSubtitleChange: (style: SubtitleStyle) => void;
	banners: Banner[];
	onBannersChange: (banners: Banner[]) => void;
	faces: Faces | null; // where the speaker's face is, for cropping and Auto zoom
	// Repeated takes are cut once, when the video is first opened (keeping the last try).
	takesApplied?: boolean;
	onTakesApplied?: (count: number, before: number[]) => void;
};

// What can be opened under the video. Nothing is open at first: the editor stays calm, and every
// setting is a click away (here, or by clicking its part of the timeline).
type Panel = ControlSection | "banners";
const PANELS: { id: Panel; icon: LucideIcon; name: string }[] = [
	{ id: "text", icon: Type, name: "Subtitles" },
	{ id: "zoom", icon: ZoomIn, name: "Zoom" },
	{ id: "banners", icon: Tag, name: "Banners" },
	{ id: "shape", icon: Crop, name: "Shape" },
	{ id: "brand", icon: Palette, name: "Brand" },
];

const PREVIEW_PREF = "komoray.previewWidth"; // remembers how wide the video's side is, in this browser
const PREVIEW_WIDTH = { start: 400, min: 280, screen: 0.6 }; // px; at most this part of the screen

// The editor: script on the left, the video on the right (stacked on phones, video first).
export function ScriptView({
	videoUrl,
	studio,
	duration,
	words,
	cuts,
	deleted,
	onChange,
	manual,
	keep,
	onTimelineChange,
	noZoom,
	onNoZoomChange,
	fixes,
	onFixesChange,
	dictionary,
	onDictionaryApplied,
	onLearn,
	subtitle,
	onSubtitleChange,
	banners,
	onBannersChange,
	faces,
	takesApplied,
	onTakesApplied,
}: Props) {
	const videoRef = useRef<HTMLVideoElement>(null);
	const boxRef = useRef<HTMLDivElement>(null);
	const [current, setCurrent] = useState(-1);
	const [playing, setPlaying] = useState(false);
	const [selected, setSelected] = useState<number[]>([]);
	// What the script marks with ✂️: the silences still cut, and the parts cut by hand.
	const shownCuts = useMemo(() => mergeSpans([...subtractSpans(cuts, keep), ...manual]), [cuts, keep, manual]);
	const items = useMemo(() => layout(words, shownCuts, fixes), [words, shownCuts, fixes]);
	// Retyping words: the transcript positions being fixed, what showed before and what is in the box now.
	const [editing, setEditing] = useState<{ from: number; to: number; text: string; before: string; original: string } | null>(null);
	// Find & replace across the whole script.
	const [finding, setFinding] = useState<{ find: string; replace: string } | null>(null);
	const wordItems = useMemo(() => items.filter((it): it is WordItem => it.kind === "word"), [items]);
	const gone = useMemo(() => new Set(deleted), [deleted]);
	// Preview = the final video (cuts, 9:16, subtitles), built live in the browser. Original = the raw upload.
	const [mode, setMode] = useState<"preview" | "original">("preview");
	const [panel, setPanel] = useState<Panel | null>(null);
	// From the timeline: the panels live under the preview.
	const openPanel = (next: Panel) => {
		setMode("preview");
		setPanel(next);
	};
	const playerRef = useRef<PreviewHandle>(null);
	// Our own player (smooth on every browser) once the preview copy is ready and the browser can
	// run it; else the <video> player. ?engine=old in the address forces the old one, to compare.
	const [studioFailed, setStudioFailed] = useState(false);
	const [canStudio, setCanStudio] = useState<boolean | null>(null); // null: not checked yet (first render)
	useEffect(() => setCanStudio(studioSupported() && !new URLSearchParams(window.location.search).has("engine", "old")), []);
	const useStudio = Boolean(studio) && canStudio === true && !studioFailed;
	// Don't start the <video> player for a moment only to swap it for ours.
	const deciding = Boolean(studio) && canStudio === null;
	const segments = useMemo(
		() => keepSegments(duration, allCuts({ duration, words, cuts, deleted, manual, keep })),
		[duration, words, cuts, deleted, manual, keep],
	);
	const lines = useMemo(
		() => subtitleLines(fixedWords(words, fixes), segments, subtitle.look, subtitle.size, subtitle.letterSpacing),
		[words, fixes, segments, subtitle.look, subtitle.size],
	);
	// Where we are in the source video, so switching between Preview and Original keeps the spot.
	const timeRef = useRef(0);

	// Which words the user has highlighted with the mouse (or a long press on a phone).
	useEffect(() => {
		const update = () => {
			const box = boxRef.current;
			const sel = window.getSelection();
			if (!box || !sel || sel.isCollapsed || !sel.anchorNode || !box.contains(sel.anchorNode)) return setSelected([]);
			const picked: number[] = [];
			box.querySelectorAll<HTMLElement>("[data-word]").forEach((el) => {
				if (!sel.containsNode(el, true)) return;
				for (let i = Number(el.dataset.word); i <= Number(el.dataset.last); i++) picked.push(i);
			});
			setSelected(picked);
		};
		document.addEventListener("selectionchange", update);
		return () => document.removeEventListener("selectionchange", update);
	}, []);

	const apply = useCallback(
		(remove: boolean) => {
			const next = new Set(deleted);
			selected.forEach((i) => (remove ? next.add(i) : next.delete(i)));
			onChange([...next].sort((a, b) => a - b));
			window.getSelection()?.removeAllRanges();
		},
		[deleted, selected, onChange],
	);

	// The words from..to as Deepgram wrote them, spaced the way the script shows them.
	const thaiClip = useMemo(() => words.filter((w) => isThai(w.text)).length > words.length / 2, [words]);
	const originalText = (from: number, to: number) =>
		words
			.slice(from, to + 1)
			.map((w, k, run) => (k > 0 && (!thaiClip || script(run[k - 1].text) !== script(w.text)) ? " " : "") + fixThai(w.text))
			.join("");

	// Open the box to retype words from..to (stretched to whole drawn words), starting from what shows now.
	function startEdit(from: number, to: number) {
		const shown = items.filter((it): it is Extract<Item, { kind: "word" }> => it.kind === "word" && it.last >= from && it.index <= to);
		if (!shown.length) return;
		const start = shown[0].index;
		const end = shown[shown.length - 1].last;
		const text = shown.map((it, k) => (k > 0 && it.space ? " " : "") + it.text).join("");
		playerRef.current?.pause();
		videoRef.current?.pause();
		window.getSelection()?.removeAllRanges();
		setFinding(null);
		setEditing({ from: start, to: end, text, before: text, original: originalText(start, end) });
	}

	// Remember a fix in the personal dictionary, keyed by what speech-to-text wrote.
	function learn(original: string, text: string) {
		const fixed = text.trim();
		onLearn?.(original, fixed && norm(fixed) !== norm(original) ? fixed : null);
	}

	function saveEdit(text: string) {
		if (!editing) return;
		onFixesChange(setFix(fixes, editing.from, editing.to, text, editing.original));
		learn(editing.original, text);
		setEditing(null);
	}

	// Put `replacement` on every run of words in `matches` (keeping a comma or full stop after it).
	function fixMatches(current: Fix[], matches: ReturnType<typeof findMatches>, replacement: string) {
		let next = current;
		for (const m of matches) {
			const text = replacement.trim() && m.trail && !TRAIL.test(replacement.trim()) ? replacement.trim() + m.trail : replacement;
			next = setFix(next, m.from, m.to, text, originalText(m.from, m.to));
		}
		return next;
	}

	// Everywhere the script reads `query`.
	function replaceAll(query: string, replacement: string) {
		const matches = findMatches(wordItems, query);
		onFixesChange(fixMatches(fixes, matches, replacement));
		for (const original of new Set(matches.map((m) => originalText(m.from, m.to)))) learn(original, replacement);
	}

	// Personal dictionary, once per video: fix every word it knows that isn't fixed by hand already.
	const appliedRef = useRef(false);
	useEffect(() => {
		if (!dictionary || appliedRef.current) return;
		appliedRef.current = true;
		const handFixed = (m: { from: number; to: number }) => fixes.some((f) => f.to >= m.from && f.from <= m.to);
		let next = fixes;
		let count = 0;
		for (const entry of dictionary) {
			const matches = findMatches(wordItems, entry.heard).filter((m) => !handFixed(m) && norm(originalText(m.from, m.to)) === entry.heard);
			next = fixMatches(next, matches, entry.fixed);
			count += matches.length;
		}
		if (count) onFixesChange(next);
		onDictionaryApplied?.(count, fixes);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [dictionary]);

	const editingFixed = editing && fixes.some((f) => f.to >= editing.from && f.from <= editing.to);
	const sameElsewhere = editing ? findMatches(wordItems, editing.before).filter((m) => m.from !== editing.from).length : 0;
	const findCount = finding ? findMatches(wordItems, finding.find).length : 0;

	// Delete / Backspace removes the highlighted words, like in a text editor.
	useEffect(() => {
		if (!selected.length || editing) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Delete" && e.key !== "Backspace") return;
			if (e.target instanceof HTMLInputElement) return;
			e.preventDefault();
			apply(true);
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [selected, apply, editing]);

	const togglePlay = useCallback(() => {
		if (mode === "preview") {
			if (playing) playerRef.current?.pause();
			else playerRef.current?.play();
		} else {
			const video = videoRef.current;
			if (video?.paused) void video.play();
			else video?.pause();
		}
	}, [mode, playing]);

	// Space plays and pauses, like every video editor (not while typing, or on a focused button).
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== " " || e.ctrlKey || e.metaKey || e.altKey) return;
			if ((e.target as HTMLElement | null)?.closest("input, textarea, select, button, a, [contenteditable='true']")) return;
			e.preventDefault();
			togglePlay();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [togglePlay]);

	// Repeated takes (lib/takes.ts): every try of a sentence, the last one kept unless the user picks
	// another on the timeline. Takes not kept are deleted words.
	const groups = useMemo(() => groupTakes(words, findRepeatedTakes(words)), [words]);
	const takeRange = (t: { from: number; to: number }) => Array.from({ length: t.to - t.from + 1 }, (_, k) => t.from + k);
	const retakeWords = useMemo(
		() => new Set(groups.flatMap((g) => g.takes.filter((t) => !gone.has(t.from) && !gone.has(t.to)).flatMap(takeRange))),
		[groups, gone],
	);
	const pickTake = (group: TakeGroup, pick: number) => {
		const next = new Set(deleted);
		group.takes.forEach((t, k) => takeRange(t).forEach((i) => (k === pick ? next.delete(i) : next.add(i))));
		onChange([...next].sort((a, b) => a - b));
	};

	// Cut or keep a stretch of the source picked on the timeline. Words said mostly inside it are
	// deleted (or put back), so the script shows the change too; the stretch itself is cut by hand
	// (or kept, which also brings back silence the pace would cut).
	const wordsInside = (a: number, b: number) =>
		words.flatMap((w, i) => ((w.start + w.end) / 2 >= a && (w.start + w.end) / 2 <= b ? [i] : []));
	const cutRange = (a: number, b: number) => {
		const next = new Set(deleted);
		wordsInside(a, b).forEach((i) => next.add(i));
		const span = { start: a, end: b };
		onTimelineChange({ deleted: [...next].sort((x, y) => x - y), manual: mergeSpans([...manual, span]), keep: subtractSpans(keep, [span]) });
	};
	const keepRange = (a: number, b: number) => {
		const next = new Set(deleted);
		wordsInside(a, b).forEach((i) => next.delete(i));
		const span = { start: a, end: b };
		onTimelineChange({ deleted: [...next].sort((x, y) => x - y), manual: subtractSpans(manual, [span]), keep: mergeSpans([...keep, span]) });
	};

	// Back to the automatic cuts in a stretch: the hand cuts and keeps there are forgotten.
	const autoRange = (a: number, b: number) => {
		const span = { start: a, end: b };
		onTimelineChange({ deleted, manual: subtractSpans(manual, [span]), keep: subtractSpans(keep, [span]) });
	};
	const handSpans = useMemo(() => mergeSpans([...manual, ...keep]), [manual, keep]);

	// Turn Auto zoom on or off for a stretch of the source.
	const zoomRange = (a: number, b: number, on: boolean) => {
		const span = { start: a, end: b };
		onNoZoomChange(on ? subtractSpans(noZoom, [span]) : mergeSpans([...noZoom, span]));
	};

	// First time the video is opened: cut every earlier try, keep the last one (the user's own
	// deletions and restores stay as they are on takes they already touched).
	const takesRef = useRef(false);
	useEffect(() => {
		if (takesApplied !== false || takesRef.current) return;
		takesRef.current = true;
		const next = new Set(deleted);
		let count = 0;
		for (const g of groups) {
			for (const t of g.takes.slice(0, -1)) {
				if (takeRange(t).some((i) => next.has(i))) continue;
				takeRange(t).forEach((i) => next.add(i));
				count++;
			}
		}
		if (count) onChange([...next].sort((a, b) => a - b));
		onTakesApplied?.(count, deleted);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [takesApplied]);

	const anyKept = selected.some((i) => !gone.has(i));
	const anyGone = selected.some((i) => gone.has(i));

	// Original: follow the video every frame (timeupdate alone is too jumpy for word highlights).
	useEffect(() => {
		if (mode !== "original" || !playing) return;
		let frame = 0;
		const tick = () => {
			const video = videoRef.current;
			if (video) {
				timeRef.current = video.currentTime;
				setCurrent(wordAt(words, video.currentTime));
			}
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [mode, playing, words]);

	// Preview: the player reports where it is in the source every frame.
	const onPreviewTime = useCallback(
		(t: number) => {
			timeRef.current = t;
			setCurrent(wordAt(words, t));
		},
		[words],
	);

	// After switching, start the other player where the last one was.
	useEffect(() => {
		setPlaying(false);
		if (mode === "preview") playerRef.current?.seek(timeRef.current);
		else if (videoRef.current) videoRef.current.currentTime = timeRef.current;
	}, [mode]);

	// Keep the highlighted word visible inside the transcript box (without scrolling the whole page).
	useEffect(() => {
		if (!playing || current < 0) return;
		const box = boxRef.current;
		const word = items.find((it) => it.kind === "word" && it.index <= current && current <= it.last);
		const el = word?.kind === "word" ? box?.querySelector<HTMLElement>(`[data-word="${word.index}"]`) : null;
		if (!box || !el) return;
		const top = el.offsetTop; // the box is position:relative, so this is measured from its top
		if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - 40) box.scrollTo({ top: top - box.clientHeight / 3, behavior: "smooth" });
	}, [current, playing, items]);

	// Jump to a moment of the source. Silences and deleted words only exist in the Original,
	// so clicking those switches over; everything else plays in the Preview.
	function seek(seconds: number, original = false) {
		// A click that ends a drag-to-select should select, not jump.
		if (!window.getSelection()?.isCollapsed) return;
		timeRef.current = seconds;
		setCurrent(wordAt(words, seconds));
		if (original && mode === "preview") {
			setMode("original");
			requestAnimationFrame(() => void videoRef.current?.play());
			return;
		}
		if (mode === "preview") {
			playerRef.current?.seek(seconds);
			playerRef.current?.play();
			return;
		}
		const video = videoRef.current;
		if (!video) return;
		video.currentTime = seconds;
		void video.play();
	}

	// The timeline moves the playhead without starting or stopping playback.
	function jump(seconds: number) {
		timeRef.current = seconds;
		setCurrent(wordAt(words, seconds));
		if (mode === "preview") playerRef.current?.seek(seconds);
		else if (videoRef.current) videoRef.current.currentTime = seconds;
	}

	// What clicking a word does, behind a ref so word spans never re-render just for new handlers.
	const wordActions = useRef<WordActions>({ click: () => {}, edit: () => {} });
	wordActions.current = {
		click: (index) => seek(words[index].start, gone.has(index)),
		edit: (from, to) => startEdit(from, to),
	};

	// This video's subtitle look becomes the Brand Kit: every new video starts with it.
	const [brandSaved, setBrandSaved] = useState<"saving" | "saved" | "failed" | null>(null);
	async function saveBrand() {
		setBrandSaved("saving");
		const res = await fetch("/api/brand", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ style: subtitle }) }).catch(() => null);
		setBrandSaved(res?.ok ? "saved" : "failed");
	}
	useEffect(() => setBrandSaved((s) => (s === "saved" ? null : s)), [subtitle]);

	// Drag the bar between the script and the video to give either one more room.
	const [previewWidth, setPreviewWidth] = useState(PREVIEW_WIDTH.start);
	useEffect(() => {
		try {
			const saved = Number(localStorage.getItem(PREVIEW_PREF));
			if (saved) setPreviewWidth(saved);
		} catch {
			// no browser storage here: start at the usual width
		}
	}, []);
	function resizePreview(width: number) {
		const next = Math.round(Math.min(window.innerWidth * PREVIEW_WIDTH.screen, Math.max(PREVIEW_WIDTH.min, width)));
		setPreviewWidth(next);
		try {
			localStorage.setItem(PREVIEW_PREF, String(next));
		} catch {
			// not remembered this time
		}
	}
	function startResize(e: ReactPointerEvent<HTMLElement>) {
		e.preventDefault();
		const from = { x: e.clientX, width: previewWidth };
		const move = (ev: PointerEvent) => resizePreview(from.width + from.x - ev.clientX);
		const stop = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", stop);
			window.removeEventListener("pointercancel", stop);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", stop);
		window.addEventListener("pointercancel", stop);
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_12px_var(--preview-w)] lg:items-start lg:gap-x-1" style={{ "--preview-w": `${previewWidth}px` } as CSSProperties}>
				{/* Right on big screens (sticky while the script scrolls), on top on phones. */}
				<div
					className="flex flex-col gap-3 lg:sticky lg:top-4 lg:z-30 lg:order-3 lg:[--player-h:max(15rem,calc(100vh-11.5rem))]"
				>
					<div className="flex flex-col gap-2 lg:flex-row lg:items-start">
					<div className="min-w-0 flex-1">
					{mode === "preview" && deciding ? (
						<div
							className="mx-auto w-full rounded-lg bg-black"
							style={{ aspectRatio: `${outputSize(subtitle).width} / ${outputSize(subtitle).height}`, maxWidth: `calc(var(--player-h, 70vh) * ${outputSize(subtitle).width} / ${outputSize(subtitle).height})` }}
						/>
					) : mode === "preview" && useStudio && studio ? (
						<StudioPlayer
							key={studio.videoUrl}
							ref={playerRef}
							media={studio}
							segments={segments}
							lines={lines}
							subtitle={subtitle}
							onSubtitleChange={onSubtitleChange}
							onTime={onPreviewTime}
							onPlayingChange={setPlaying}
							banners={banners}
							onBannersChange={onBannersChange}
							faces={faces}
							noZoom={noZoom}
							onFail={(error) => {
								reportError("studio player", error.message);
								setStudioFailed(true);
							}}
						/>
					) : mode === "preview" ? (
						<PreviewPlayer
							key={videoUrl} // start fresh when the preview copy replaces the original
							ref={playerRef}
							src={videoUrl}
							segments={segments}
							lines={lines}
							subtitle={subtitle}
							onSubtitleChange={onSubtitleChange}
							onTime={onPreviewTime}
							onPlayingChange={setPlaying}
							banners={banners}
							onBannersChange={onBannersChange}
							noZoom={noZoom}
						/>
					) : (
						<video
							ref={videoRef}
							src={videoUrl}
							controls
							playsInline
							preload="metadata"
							onPlay={() => setPlaying(true)}
							onPause={() => setPlaying(false)}
							onEnded={() => setPlaying(false)}
							onSeeked={(e) => {
								timeRef.current = e.currentTarget.currentTime;
								setCurrent(wordAt(words, e.currentTarget.currentTime));
							}}
							className="max-h-[65vh] w-full rounded-lg bg-black"
						/>
					)}
					</div>
					{/* Beside the video on big screens, so the tools never take height from it. */}
					<div className="flex shrink-0 flex-wrap justify-center gap-1 lg:flex-col" role="tablist" aria-label="Settings">
						{mode === "preview" &&
							PANELS.map((p) => (
								<button
									key={p.id}
									role="tab"
									aria-selected={panel === p.id}
									title={p.name}
									onClick={() => setPanel(panel === p.id ? null : p.id)}
									className={`flex w-14 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[10px] leading-3 ${
										panel === p.id ? "bg-foreground text-background" : "text-foreground/70 hover:bg-foreground/5 hover:text-foreground"
									}`}
								>
									<p.icon className="h-[18px] w-[18px]" aria-hidden />
									{p.name}
								</button>
							))}
						<button
							onClick={() => setMode(mode === "preview" ? "original" : "preview")}
							aria-pressed={mode === "original"}
							title={mode === "preview" ? "See the original video, before any cuts" : "Back to the final video"}
							className={`flex w-14 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[10px] leading-3 ${
								mode === "original" ? "bg-foreground text-background" : "text-foreground/70 hover:bg-foreground/5 hover:text-foreground"
							}`}
						>
							<Film className="h-[18px] w-[18px]" aria-hidden />
							Original
						</button>
					</div>
					</div>
					{/* Floats over the script on big screens: the video keeps its size while you watch the change. */}
					{mode === "preview" && panel && (
						<div className="flex flex-col gap-2 rounded-lg border border-foreground/15 bg-background shadow-xl lg:absolute lg:top-0 lg:right-full lg:z-30 lg:mr-3 lg:max-h-[calc(100vh-10rem)] lg:w-[26rem] lg:overflow-y-auto">
							<div className="flex items-center justify-between px-3 pt-2 text-sm font-medium">
								{PANELS.find((p) => p.id === panel)?.name}
								<button onClick={() => setPanel(null)} aria-label="Close settings" title="Close" className="rounded p-1 text-foreground/50 hover:bg-foreground/5 hover:text-foreground">
									<X className="h-4 w-4" aria-hidden />
								</button>
							</div>
					{panel !== "banners" && (
						<SubtitleControls
							style={subtitle}
							onChange={onSubtitleChange}
							thai={thaiClip}
							section={panel}
							footer={
								panel === "brand" ? (
									<button
										onClick={() => void saveBrand()}
										disabled={brandSaved === "saving"}
										className="self-start rounded-md border border-foreground/20 px-2.5 py-1 text-sm hover:bg-foreground/5 disabled:opacity-50"
										title="Use this look for every new video"
									>
										{brandSaved === "saved" ? "Saved to Brand Kit" : brandSaved === "failed" ? "Could not save, try again" : "Save as my Brand Kit"}
									</button>
								) : panel === "zoom" && subtitle.zoom !== "off" ? (
									<div className="flex flex-wrap items-center gap-2 text-xs text-foreground/60">
										<span>
											{noZoom.length ? `Zoom is off in ${noZoom.length} ${noZoom.length === 1 ? "part" : "parts"}.` : "Zoom is on for the whole video."} Click the purple strip on the
											timeline to turn it off for a part, or drag across any stretch.
										</span>
										{noZoom.length > 0 && (
											<button onClick={() => onNoZoomChange([])} className="rounded-md border border-foreground/20 px-2 py-0.5 hover:bg-foreground/5">
												Zoom the whole video
											</button>
										)}
									</div>
								) : undefined
							}
						/>
					)}
					{panel === "banners" && (
						<BannerControls
							banners={banners}
							onChange={onBannersChange}
							now={() => toOutSeconds(timeRef.current, segments)}
							total={totalFrames(segments) / FPS}
							channel={subtitle.logo}
						/>
					)}
						</div>
					)}
				</div>
	
				<div
					role="separator"
					aria-orientation="vertical"
					aria-label="Drag to change the size of the video"
					aria-valuenow={previewWidth}
					tabIndex={0}
					title="Drag to make the video bigger or smaller"
					onPointerDown={startResize}
					onKeyDown={(e) => {
						if (e.key === "ArrowLeft") resizePreview(previewWidth + 24);
						if (e.key === "ArrowRight") resizePreview(previewWidth - 24);
					}}
					className="group hidden cursor-col-resize touch-none justify-center self-stretch lg:order-2 lg:flex"
				>
					<span className="my-2 w-1 rounded-full bg-foreground/10 transition-colors group-hover:bg-blue-600 group-focus-visible:bg-blue-600" />
				</div>

				<div className="flex min-w-0 flex-col gap-3 lg:order-1">
					<p className="text-xs text-foreground/60" title="On the timeline, drag across any part to cut it or keep it. Click a green sentence for subtitle settings.">
						Click a word to jump there. Double-click to fix it. Drag across words to delete them.
					</p>
					{editing && (
						<form
							onSubmit={(e) => {
								e.preventDefault();
								saveEdit(editing.text);
							}}
							className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-600/40 bg-blue-600/5 p-2"
						>
							<input
								autoFocus
								value={editing.text}
								onChange={(e) => setEditing({ ...editing, text: e.target.value })}
								onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
								aria-label="Fixed text"
								className="min-w-40 flex-1 rounded-md border border-foreground/20 bg-background px-2 py-1.5 text-base"
							/>
							<button type="submit" className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
								Save
							</button>
							{sameElsewhere > 0 && (
								<button
									type="button"
									onClick={() => {
										replaceAll(editing.before, editing.text);
										setEditing(null);
									}}
									title={`Also fix the other ${sameElsewhere} places that read "${editing.before}"`}
									className="rounded-lg border border-blue-600 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-600/10"
								>
									Fix all ({sameElsewhere + 1})
								</button>
							)}
							<button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-foreground/20 px-3 py-1.5 text-sm hover:bg-foreground/5">
								Cancel
							</button>
							{editingFixed && (
								<button
									type="button"
									onClick={() => saveEdit("")}
									title={`Back to "${editing.original}"`}
									className="rounded-lg border border-foreground/20 px-3 py-1.5 text-sm hover:bg-foreground/5"
								>
									Original
								</button>
							)}
							<span className="w-full text-xs text-foreground/60">
								Heard as: {editing.original} · The subtitles show what you type. Enter to save, Esc to cancel.
							</span>
						</form>
					)}
					{finding && (
						<form
							onSubmit={(e) => {
								e.preventDefault();
								if (!findCount || !finding.replace.trim()) return;
								replaceAll(finding.find, finding.replace);
								setFinding({ find: finding.replace, replace: "" });
							}}
							className="flex flex-wrap items-center gap-2 rounded-lg border border-foreground/20 p-2"
						>
							<input
								autoFocus
								value={finding.find}
								onChange={(e) => setFinding({ ...finding, find: e.target.value })}
								onKeyDown={(e) => e.key === "Escape" && setFinding(null)}
								placeholder="Find"
								aria-label="Find"
								className="min-w-32 flex-1 rounded-md border border-foreground/20 bg-background px-2 py-1.5 text-base"
							/>
							<span className="text-foreground/50">→</span>
							<input
								value={finding.replace}
								onChange={(e) => setFinding({ ...finding, replace: e.target.value })}
								onKeyDown={(e) => e.key === "Escape" && setFinding(null)}
								placeholder="Replace with"
								aria-label="Replace with"
								className="min-w-32 flex-1 rounded-md border border-foreground/20 bg-background px-2 py-1.5 text-base"
							/>
							<button
								type="submit"
								disabled={!findCount || !finding.replace.trim()}
								className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
							>
								Replace all{findCount ? ` (${findCount})` : ""}
							</button>
							<button type="button" onClick={() => setFinding(null)} className="rounded-lg border border-foreground/20 px-3 py-1.5 text-sm hover:bg-foreground/5">
								Close
							</button>
							<span className="w-full text-xs text-foreground/60">
								{finding.find.trim() ? (findCount ? `Found ${findCount} in the script.` : "Not found in the script.") : "Type a word as it shows in the script."}{" "}
								Capitals and punctuation don&apos;t matter.
							</span>
						</form>
					)}
					<div className="flex min-h-9 flex-wrap items-center gap-2">
						{!finding && !editing && (
							<button
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => setFinding({ find: "", replace: "" })}
								className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/20 px-3 py-1.5 text-sm hover:bg-foreground/5"
							>
								<Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
								Find &amp; replace
							</button>
						)}
						{/* onMouseDown preventDefault: keep the highlighted words selected while clicking the button */}
						{selected.length > 0 && !editing && (
							<button
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => startEdit(Math.min(...selected), Math.max(...selected))}
								className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
							>
								<Pencil className="h-3.5 w-3.5 shrink-0" aria-hidden />
								Fix text
							</button>
						)}
						{anyKept && (
							<button
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => apply(true)}
								className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
							>
								<Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
								Delete
							</button>
						)}
						{anyGone && (
							<button
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => apply(false)}
								className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/20 px-3 py-1.5 text-sm font-medium hover:bg-foreground/5"
							>
								<Undo2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
								Restore
							</button>
						)}
						{!selected.length && deleted.length > 0 && (
							<button
								onClick={() => onChange([])}
								className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/20 px-3 py-1.5 text-sm hover:bg-foreground/5"
							>
								<Undo2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
								Restore all deleted words
							</button>
						)}
					</div>
					<div
						ref={boxRef}
						className="relative max-h-[50vh] overflow-y-auto rounded-lg bg-foreground/5 p-4 text-base leading-8 lg:max-h-[calc(100vh-26.5rem)] lg:text-lg lg:leading-9"
					>
						{items.map((item, i) => {
							if (item.kind === "break") return <span key={i} className="block h-3" />;
							if (item.kind === "silence") {
								return (
									<button
										key={i}
										onClick={() => seek(item.at, true)}
										title="Silence that will be cut"
										className="mx-1 inline-flex items-center gap-1 rounded bg-red-500/15 px-1.5 align-middle text-xs leading-5 text-red-600 hover:bg-red-500/25"
									>
										<Scissors className="h-3 w-3 shrink-0" aria-hidden />
										{item.seconds.toFixed(1)}s
									</button>
								);
							}
							return (
								<WordSpan
									key={i}
									item={item}
									gone={gone.has(item.index)}
									active={item.index <= current && current <= item.last}
									retake={retakeWords.has(item.index)}
									heardAs={item.fixed ? originalText(item.index, item.last) : null}
									actions={wordActions}
								/>
							);
						})}
					</div>
			{/* Pinned to the bottom of the screen on big screens, like a video editor's timeline. */}
			<div className="z-20 lg:sticky lg:bottom-2">
				<Timeline
					duration={duration}
					words={words}
					scriptWords={wordItems}
					gone={gone}
					segments={segments}
					timeRef={timeRef}
					playing={playing}
					onTogglePlay={togglePlay}
					onSeek={jump}
					audioUrl={studio?.audioUrl ?? null}
					groups={groups}
					onPickTake={pickTake}
					onCut={cutRange}
					onKeep={keepRange}
					onAuto={autoRange}
					handSpans={handSpans}
					zoomStyle={subtitle}
					zoomEditing={mode === "preview" && panel === "zoom"}
					onOpenZoom={() => (panel === "zoom" ? setPanel(null) : openPanel("zoom"))}
					onOpenSubtitles={() => openPanel("text")}
					noZoom={noZoom}
					onZoomRange={zoomRange}
					onPlayFrom={(t) => seek(t)}
					onListen={(from) => seek(Math.max(0, words[from].start - 0.3), gone.has(from))}
				/>
			</div>
				</div>
			</div>
		</div>
	);
}
