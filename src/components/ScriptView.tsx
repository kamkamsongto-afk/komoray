"use client";

import { Columns2, Crop, Film, FolderInput, Layers, type LucideIcon, Palette, Pencil, Scissors, Search, Shapes, Sparkles, Tag, Trash2, Type, Undo2, X, ZoomIn } from "lucide-react";
import { type CSSProperties, memo, type PointerEvent as ReactPointerEvent, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KIND_NOTE, learnFromFix } from "@/lib/word-rules";
import { allCuts, findInside, type Fix, fixedWords, MAX_FIX_LENGTH, mergeSpans, normText, setFix, subtractSpans, TRAIL, withNeighbours, type WordFix } from "@/lib/edit";
import { BANNER, BANNER_FILE, type Banner } from "@/lib/banners";
import { cleanInsertName, type CutoutLayers, INSERT, type Insert } from "@/lib/behind";
import { filesInUse, type LibraryItem, projectFileSrc } from "@/lib/media-library";
import type { useCutout } from "@/lib/use-cutout";
import type { Faces } from "@/lib/framing";
import { DEFAULT_STYLE, fontMetrics, outputSize, type SubtitleStyle } from "@/lib/subtitle-style";
import { findRepeatedTakes, groupTakes, type TakeGroup } from "@/lib/takes";
import { FPS, keepSegments, subtitleLines, toOutSeconds, toSourceSeconds, totalFrames } from "@/lib/timeline";
import { reportError } from "@/lib/report";
import { studioSupported } from "@/lib/player/engine";
import { type PreviewHandle, PreviewPlayer } from "./PreviewPlayer";
import { type StudioMedia, StudioPlayer } from "./StudioPlayer";
import { type ControlSection, SubtitleControls } from "./SubtitleControls";
import { BannerControls } from "./BannerControls";
import { CutoutControls } from "./CutoutControls";
import { FrameControls } from "./FrameControls";
import type { FrameMe } from "@/lib/frame-me";
import { LayoutControls } from "./LayoutControls";
import type { VideoLayout } from "@/lib/layout";
import { newClipSound } from "@/lib/clip-sound";
import { ImportControls } from "./ImportControls";
import { clock } from "@/lib/cutout";
import { waitLabel } from "@/lib/use-cutout";
import { AudioControls } from "./AudioControls";
import { Timeline } from "./Timeline";
import { type PartZoom, setZoomPart, type ZoomPart } from "@/lib/zoom";

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
// inside: also inside words, for what the Find box looks for in Thai (findInside).
function findMatches(words: WordItem[], query: string, inside = false) {
	const target = norm(query);
	const matches: { from: number; to: number; trail: string; keep?: string[] }[] = [];
	if (!target) return matches;
	if (inside && isThai(target)) return findInside(words, target);
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
	zoomParts: ZoomPart[]; // parts with their own kind of zoom
	onZoomChange: (change: { noZoom: Cut[]; zoomParts: ZoomPart[] }) => void;
	moments: "idle" | "finding" | "failed"; // the AI picking where to zoom
	onFindMoments: () => void;
	fixes: Fix[];
	onFixesChange: (fixes: Fix[]) => void;
	// Personal dictionary: apply it once (then onDictionaryApplied), and learn from every fix made here.
	dictionary?: WordFix[] | null;
	onDictionaryApplied?: (count: number, before: Fix[]) => void;
	onLearn?: (heard: string, fixed: string | null) => void; // null: forget (original words put back)
	subtitle: SubtitleStyle;
	onSubtitleChange: (style: SubtitleStyle) => void;
	videoKey?: string | null; // to remember which Brand Kit this video uses (this computer only)
	startKit?: string; // the Brand Kit picked when uploading (lib/upload-options.ts)
	banners: Banner[];
	onBannersChange: (banners: Banner[]) => void;
	// Cutout (lib/behind.ts): text behind the speaker, pictures and clips behind a smaller speaker.
	cutoutLayers: CutoutLayers;
	onCutoutChange: (layers: CutoutLayers) => void;
	cutout: ReturnType<typeof useCutout>;
	frames: FrameMe[]; // Frame Me: the speaker inside a shape over a background (lib/frame-me.ts)
	onFramesChange: (frames: FrameMe[]) => void;
	layouts: VideoLayout[]; // Layout: the screen split, the speaker and a picture or clip (lib/layout.ts)
	onLayoutsChange: (layouts: VideoLayout[]) => void;
	faces: Faces | null; // where the speaker's face is, for cropping and Auto zoom
	// Repeated takes are looked for once, when the video is first opened. withoutTakes: the deleted words if the earlier tries were cut.
	takesApplied?: boolean;
	onTakesApplied?: (count: number, withoutTakes: number[]) => void;
	suggested?: Set<number> | null; // words the AI suggests cutting (BadTakes); once there, they are the ones marked in the script
	listen?: { seconds: number; original: boolean; ask: number } | null; // play from here; ask changes every time
};

// What can be opened under the video. Nothing is open at first: the editor stays calm, and every
// setting is a click away (here, or by clicking its part of the timeline).
type Panel = ControlSection | "banners" | "cutout" | "frame" | "layout" | "import";
const SCRIPT_HEIGHT = "komoray.scriptHeight"; // the script box's dragged height, px
const PANELS: { id: Panel; icon: LucideIcon; name: string }[] = [
	{ id: "text", icon: Type, name: "Subtitles" },
	{ id: "zoom", icon: ZoomIn, name: "Zoom" },
	{ id: "banners", icon: Tag, name: "Banners" },
	{ id: "cutout", icon: Layers, name: "Cutout" }, // only for people with Cutout on (/admin)
	{ id: "frame", icon: Shapes, name: "Frame Me" }, // the speaker in a shape, nothing cut out (coach, 12 Nov)
	{ id: "layout", icon: Columns2, name: "Layout" }, // the screen split: you and a picture or clip (coach, 14 Nov)
	{ id: "import", icon: FolderInput, name: "Import" }, // pictures and clips kept in the project (Yoshi, 12 Nov)
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
	zoomParts,
	onZoomChange,
	moments,
	onFindMoments,
	fixes,
	onFixesChange,
	dictionary,
	onDictionaryApplied,
	onLearn,
	subtitle,
	onSubtitleChange,
	videoKey,
	startKit,
	banners,
	onBannersChange,
	cutoutLayers,
	onCutoutChange,
	cutout,
	frames,
	onFramesChange,
	layouts,
	onLayoutsChange,
	faces,
	takesApplied,
	onTakesApplied,
	suggested,
	listen,
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
	const [focusBanner, setFocusBanner] = useState<string | null>(null);
	const [focusCutout, setFocusCutout] = useState<string | null>(null);
	const [focusFrame, setFocusFrame] = useState<string | null>(null);
	const [focusLayout, setFocusLayout] = useState<string | null>(null);
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
	// Once the speaker is cut out, the preview plays the copy with the matte under each picture (lib/cutout.ts).
	const stackedPreview = cutout.status === "done" ? (cutout.previewUrl ?? null) : null;
	// Never the link itself: it is signed anew on every look at the cutout, which threw the player away
	// and started the video from the beginning each time a layer was changed (coach, 9 Nov).
	const playerKey = stackedPreview ? `cutout-${cutout.version}` : "plain";
	// The dot on the Cutout button: a finished cutout nobody has looked at yet, also after coming back to the page.
	const cutoutBusy = cutout.status === "processing" || Boolean(cutout.local);
	const seenKey = `komoray.cutoutSeen.${cutout.version ?? ""}`;
	const [seenNow, setSeenNow] = useState<string | null>(null);
	// Only a press on the button counts as seen. Counting an open box hid the dot from everyone who
	// waited with the box open, which is nearly everyone (coach, 9 Nov).
	const markCutoutSeen = () => {
		if (!cutout.version || cutout.status !== "done") return;
		setSeenNow(cutout.version);
		try {
			localStorage.setItem(seenKey, "1");
		} catch {
			// no storage: the dot comes back on the next visit
		}
	};
	const cutoutNews = useMemo(() => {
		if (cutout.status !== "done" || !cutout.version || seenNow === cutout.version) return false;
		try {
			return !localStorage.getItem(seenKey);
		} catch {
			return true;
		}
	}, [cutout.status, cutout.version, seenNow, seenKey]);
	const cutoutWait = waitLabel(cutout);
	// Don't start the <video> player for a moment only to swap it for ours.
	const deciding = Boolean(studio) && canStudio === null;
	const segments = useMemo(
		() => keepSegments(duration, allCuts({ duration, words, cuts, deleted, manual, keep })),
		[duration, words, cuts, deleted, manual, keep],
	);
	const lines = useMemo(
		() => subtitleLines(fixedWords(words, fixes), segments, subtitle.look, subtitle.size, subtitle.letterSpacing, subtitle.splits, subtitle.spots),
		[words, fixes, segments, subtitle.look, subtitle.size, subtitle.letterSpacing, subtitle.splits, subtitle.spots],
	);
	// Where we are in the source video, so switching between Preview and Original keeps the spot.
	const timeRef = useRef(0);
	// A banner, picture or text picked in a box (or just added): the blue line goes to its start, and the
	// timeline picks its strip and scrolls to it (coach, 12 Nov). n: a new ask each time, also for the same one.
	const [revealed, setRevealed] = useState<{ id: string; n: number } | null>(null);
	const reveal = (id: string, start: number) => {
		jump(toSourceSeconds(start, segments));
		setRevealed((s) => ({ id, n: (s?.n ?? 0) + 1 }));
	};
	// Import: a project file put on the video where it is now, then its box opens on it to place it.
	const putAsBanner = (item: LibraryItem) => {
		if (banners.length >= BANNER.maxBanners) return;
		const total = totalFrames(segments) / FPS;
		const start = Math.round(Math.min(toOutSeconds(timeRef.current, segments), Math.max(0, total - 1)) * 10) / 10;
		const end = Math.round(Math.min(total, start + Math.max(0.5, item.seconds ?? BANNER.seconds)) * 10) / 10;
		const banner: Banner = { id: crypto.randomUUID(), kind: "file", text: item.name, sub: "", start, end, place: "top", x: BANNER_FILE.x, y: BANNER_FILE.y, file: item.file, media: item.media, ...newClipSound(item.media) };
		onBannersChange([...banners, banner]); // on top of the others (lib/layers.ts)
		setFocusBanner(banner.id);
		openPanel("banners");
		reveal(banner.id, start);
	};
	const putInPicClip = (item: LibraryItem) => {
		const total = totalFrames(segments) / FPS;
		const start = Math.round(Math.min(toOutSeconds(timeRef.current, segments), Math.max(0, total - 1)) * 100) / 100;
		const end = Math.round(Math.min(total, start + Math.max(0.5, item.seconds ?? 3)) * 100) / 100;
		const clear = Boolean(item.clear);
		const insert: Insert = { ...newClipSound(item.media), id: crypto.randomUUID(), kind: item.media, file: item.file, start, end, speakerScale: clear ? 1 : INSERT.scale.start, speakerX: clear ? 0.5 : 0.25, hidden: false, seeThrough: clear, name: cleanInsertName(item.name) || undefined };
		onCutoutChange({ ...cutoutLayers, inserts: [...cutoutLayers.inserts, insert] });
		setFocusCutout(insert.id);
		openPanel("cutout");
		reveal(insert.id, start);
	};
	// Frame Me: dragged or resized on the video (while its box is open and the video paused).
	const changeFrame = (id: string, patch: Partial<FrameMe>) => onFramesChange(frames.map((f) => (f.id === id ? { ...f, ...patch } : f)));
	// Layout: you dragged inside your part of the screen (while its box is open and the video paused).
	const changeLayout = (id: string, patch: Partial<VideoLayout>) => onLayoutsChange(layouts.map((l) => (l.id === id ? { ...l, ...patch } : l)));
	// Project files in Pic/Clip have a link at once (the Cutout check signs them only after the next save).
	const cutoutFiles = useMemo(
		() => ({ ...Object.fromEntries(cutoutLayers.inserts.map((i) => [i.file, projectFileSrc(i.file)])), ...cutout.files }),
		[cutoutLayers.inserts, cutout.files],
	);

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

	// What saving words from..to as `text` teaches My words (lib/word-rules.ts): only the misspelled words, never
	// spacing, words added or taken out, numbers or ๆ, which belong to this video (coach, 13 Nov).
	const lessonOf = (from: number, to: number, text: string) => learnFromFix(words.slice(from, to + 1).map((w) => fixThai(w.text)), text);

	// Remember a fix in the personal dictionary, keyed by what speech-to-text wrote. Back to the original: forget what
	// the fix there (`before`) had taught.
	function learn(from: number, to: number, text: string, before = "") {
		const original = originalText(from, to);
		if (!text.trim() || norm(text) === norm(original)) {
			for (const p of before ? lessonOf(from, to, before).pairs : []) onLearn?.(p.heard, null);
			onLearn?.(original, null);
			return;
		}
		for (const p of lessonOf(from, to, text).pairs) onLearn?.(p.heard, p.fixed);
	}

	// The words from..to as the script draws them now (fixes in).
	const drawnText = (from: number, to: number) =>
		wordItems
			.filter((w) => w.index >= from && w.last <= to)
			.map((w, k) => (k && w.space ? " " : "") + w.text)
			.join("");

	// remember: also into My words (the box's "Save + My words"); "Save (this video only)" leaves it out.
	function saveEdit(text: string, remember = true) {
		if (!editing || text.trim().length > MAX_FIX_LENGTH) return;
		// Typed in the word next to it too ("ใช่" → "ไม่ใช่" right after "ไม่"): the fix covers that word, never repeats it.
		const { from, to } = withNeighbours(wordItems, editing.from, editing.to, text, editing.before);
		const original = from === editing.from && to === editing.to ? editing.original : originalText(from, to);
		onFixesChange(setFix(fixes, from, to, text, original));
		if (remember) learn(from, to, text, editing.before);
		setEditing(null);
	}

	// Put `replacement` on every run of words in `matches` (keeping a comma or full stop after it).
	// Fix all and the dictionary too never repeat the word next to a match (withNeighbours).
	// skip: a stretch (after widening) not to touch. Returns the fixes, how many matches were fixed, and those not widened.
	function fixMatches(current: Fix[], matches: ReturnType<typeof findMatches>, replacement: string, skip?: (span: { from: number; to: number }) => boolean) {
		let next = current;
		let applied = 0;
		const plain: typeof matches = [];
		for (const m of matches) {
			const text = m.keep ? m.keep.join(replacement.trim()) : replacement.trim() && m.trail && !TRAIL.test(replacement.trim()) ? replacement.trim() + m.trail : replacement;
			const span = withNeighbours(wordItems, m.from, m.to, text, drawnText(m.from, m.to));
			if (skip?.(span)) continue;
			next = setFix(next, span.from, span.to, text, originalText(span.from, span.to));
			if (norm(text) !== norm(originalText(span.from, span.to))) applied++; // widened onto words that already read so: nothing changed
			if (span.from === m.from && span.to === m.to) plain.push(m);
		}
		return { next, applied, plain };
	}

	// Everywhere the script reads `query`.
	function replaceAll(query: string, replacement: string, inside = false) {
		const { next, plain } = fixMatches(fixes, findMatches(wordItems, query, inside), replacement);
		onFixesChange(next);
		// Only what was replaced as found is learned: "ใช่" → "ไม่ใช่" next to "ไม่" took that word in, and must not
		// teach the dictionary to put "ไม่" before every "ใช่" (Codex review 13 Nov).
		const learned = new Map(plain.flatMap((m) => lessonOf(m.from, m.to, m.keep ? m.keep.join(replacement.trim()) : replacement).pairs).map((p) => [p.heard, p.fixed]));
		for (const [heard, fixed] of learned) onLearn?.(heard, fixed);
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
			// Widened over a word fixed by hand (withNeighbours): left alone, the hand fix wins (Codex review 13 Nov).
			const done = fixMatches(next, matches, entry.fixed, handFixed);
			next = done.next;
			count += done.applied;
		}
		if (count) onFixesChange(next);
		onDictionaryApplied?.(count, fixes);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [dictionary]);

	const editTooLong = Boolean(editing && editing.text.trim().length > MAX_FIX_LENGTH);
	// What this fix would teach My words, worked out as it is typed (the same widening as saveEdit).
	const editSpan = editing ? withNeighbours(wordItems, editing.from, editing.to, editing.text, editing.before) : null;
	const editLesson = editing && editSpan && editing.text.trim() ? lessonOf(editSpan.from, editSpan.to, editing.text) : null;
	const editTeaches = Boolean(onLearn && editLesson?.kind === "spelling" && editLesson.pairs.length);
	const editingFixed = editing && fixes.some((f) => f.to >= editing.from && f.from <= editing.to);
	const sameElsewhere = editing ? findMatches(wordItems, editing.before).filter((m) => m.from !== editing.from).length : 0;
	const findCount = finding ? findMatches(wordItems, finding.find, true).reduce((sum, m) => sum + (m.keep ? m.keep.length - 1 : 1), 0) : 0;

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
	// Give a stretch of the source its own zoom: a kind, "off" (no zoom), or null (back to the whole video's zoom).
	const zoomRange = (a: number, b: number, zoom: PartZoom | "off" | null) => {
		const span = { start: a, end: b };
		onZoomChange({
			noZoom: zoom === "off" ? mergeSpans([...noZoom, span]) : subtractSpans(noZoom, [span]),
			zoomParts: setZoomPart(zoomParts, span, zoom === "off" ? null : zoom),
		});
	};

	// First time the video is opened: say what was found and what cutting it would leave. Never cut by
	// itself: a list ("the days with sad news, the days with bad news") looks the same as a retry, and
	// cutting one turned "not what is prettiest, but what changes" into "not what changes".
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
		onTakesApplied?.(count, [...next].sort((a, b) => a - b));
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
	}, [mode, playerKey]); // playerKey: a finished cutout swaps the player, the video stays where it was

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

	// A fixed word can stand for several: it is marked if any of them is.
	const markedWord = (item: WordItem) => {
		const marked = suggested ?? retakeWords;
		for (let i = item.index; i <= item.last; i++) if (marked.has(i)) return true;
		return false;
	};

	// The list of suggested cuts asks to hear one.
	useEffect(() => {
		if (!listen) return;
		const later = setTimeout(() => seek(listen.seconds, listen.original), 0);
		return () => clearTimeout(later);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [listen]);

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

	// Brand Kits (api/brand, coach 13 Nov: one per channel). The panel shows the one this video uses, and can only save
	// into that one, or into a new one: picking a kit in one place and saving into another made one channel's kit take
	// another's look (coach, 13 Nov). Another kit is changed on the Brand Kit page. Which kit a video uses is kept on
	// this computer; else the one picked when uploading, else the starred one.
	type Kit = { id: string; name: string; style: SubtitleStyle };
	const [kits, setKits] = useState<Kit[] | null>(null);
	const [inUse, setInUse] = useState<string | null>(null);
	const [brandSaved, setBrandSaved] = useState<"saving" | "saved" | "failed" | null>(null);
	const [savedNew, setSavedNew] = useState(false); // which button the "Saved" goes after
	const kitMemory = videoKey ? `komoray-kit-in-use:${videoKey}` : null;
	const remember = (id: string) => {
		setInUse(id);
		try {
			if (kitMemory) localStorage.setItem(kitMemory, id);
		} catch {}
	};
	const kitsAsked = useRef(false);
	useEffect(() => {
		if (panel !== "brand" || kitsAsked.current) return;
		kitsAsked.current = true;
		fetch("/api/brand")
			.then((res) => (res.ok ? (res.json() as Promise<{ kits?: Kit[]; defaultId?: string | null }>) : null))
			.catch(() => null)
			.then((data) => {
				const list = data?.kits ?? [];
				let kept: string | null = null;
				try {
					kept = kitMemory ? localStorage.getItem(kitMemory) : null;
				} catch {}
				setKits(list);
				setInUse([kept, startKit, data?.defaultId].find((id) => id && list.some((k) => k.id === id)) ?? null);
			});
	}, [panel, kitMemory, startKit]);
	// A kit's look as it goes on this video: an English-only font has no Thai letters, so a Thai video uses Kanit
	// instead, as when a video first opens (edit page; Codex review 13 Nov).
	const onThisVideo = (kit: Kit) => ({ ...kit.style, font: thaiClip && !fontMetrics(kit.style).thai ? DEFAULT_STYLE.font : kit.style.font });
	// Same look, whatever order the settings are in; where subtitles were split or moved belongs to the video.
	const lookKey = (style: SubtitleStyle) => {
		const sorted = (v: unknown): unknown => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])])) : v);
		const look: Record<string, unknown> = { ...style };
		delete look.splits;
		delete look.spots;
		return JSON.stringify(sorted(look));
	};
	const kitInUse = kits?.find((k) => k.id === inUse) ?? null;
	const kitChanged = Boolean(kitInUse && lookKey(subtitle) !== lookKey(onThisVideo(kitInUse)));
	function applyKit(id: string) {
		const kit = kits?.find((k) => k.id === id);
		if (!kit) return;
		if (kitChanged && !window.confirm(`Put "${kit.name}" on this video? The changes you made to "${kitInUse?.name}" here go.`)) return;
		onSubtitleChange({ ...onThisVideo(kit), splits: subtitle.splits, spots: subtitle.spots });
		remember(id);
	}
	async function saveBrand(fresh: boolean) {
		if (!fresh && !kitInUse) return;
		const name = fresh ? window.prompt("Name the new Brand Kit (a channel name, say):", `Brand Kit ${(kits?.length ?? 0) + 1}`) : null;
		if (fresh && name === null) return;
		setSavedNew(fresh);
		setBrandSaved("saving");
		const res = await fetch("/api/brand", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ style: subtitle, ...(fresh ? { name } : { kitId: kitInUse!.id }) }),
		}).catch(() => null);
		const data = res?.ok ? ((await res.json()) as { kits?: Kit[] }) : null;
		setBrandSaved(data ? "saved" : "failed");
		if (res?.status === 404) {
			window.alert("That Brand Kit was deleted. Use Create New Brand Kit instead.");
			kitsAsked.current = false; // read the kits again next time the panel opens
			setKits((list) => list?.filter((k) => k.id !== kitInUse?.id) ?? null);
			setInUse(null);
		}
		if (data?.kits) {
			setKits(data.kits);
			if (fresh) remember(data.kits[data.kits.length - 1].id);
		}
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

	// The settings box closes with a click anywhere outside it (coach, 6 Nov: the X was too small to aim for),
	// or Esc. Not on the video or the timeline: settings are changed while watching the video, and the zoom
	// strip and banners on the timeline belong to the open box.
	const panelRef = useRef<HTMLDivElement>(null);
	const tabsRef = useRef<HTMLDivElement>(null);
	const playerAreaRef = useRef<HTMLDivElement>(null);
	const timelineRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!panel) return;
		const onDown = (e: PointerEvent) => {
			const target = e.target as Node | null;
			if (!target || !document.contains(target)) return; // something that went away as it was clicked
			if ([panelRef, tabsRef, playerAreaRef, timelineRef].some((r) => r.current?.contains(target))) return;
			// A question it asks (ConfirmDelete) sits on the page itself, outside the box: answering it keeps the box open.
			if (target instanceof Element && target.closest("[data-confirm]")) return;
			setPanel(null);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || (e.target as HTMLElement | null)?.closest("input, textarea, select")) return;
			setPanel(null);
		};
		document.addEventListener("pointerdown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("pointerdown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [panel]);

	// How tall the script box is once the line above the timeline is dragged (remembered in this browser).
	// Only drawn in the browser (the page waits for the video's data), so the saved height can be read at once.
	const [scriptHeight, setScriptHeight] = useState<number | null>(() => {
		try {
			const saved = Number(localStorage.getItem(SCRIPT_HEIGHT));
			return saved > 0 ? Math.min(window.innerHeight - 140, saved) : null;
		} catch {
			return null; // no storage: as tall as the screen allows
		}
	});
	const resizeScript = (h: number | null) => {
		const next = h === null ? null : Math.round(Math.min(window.innerHeight - 140, Math.max(120, h)));
		setScriptHeight(next);
		try {
			if (next === null) localStorage.removeItem(SCRIPT_HEIGHT);
			else localStorage.setItem(SCRIPT_HEIGHT, String(next));
		} catch {
			// not remembered, that's fine
		}
	};
	function startScriptResize(e: ReactPointerEvent<HTMLElement>) {
		e.preventDefault();
		const box = boxRef.current;
		if (!box) return;
		const from = { y: e.clientY, height: box.getBoundingClientRect().height };
		const move = (ev: PointerEvent) => resizeScript(from.height + ev.clientY - from.y);
		const stop = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", stop);
			window.removeEventListener("pointercancel", stop);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", stop);
		window.addEventListener("pointercancel", stop);
	}

	// How tall the settings box is once dragged by its corner, while this video is open; null: as tall as it needs, up to a limit.
	const [panelHeight, setPanelHeight] = useState<number | null>(null);
	const resizePanel = (height: number | null) => setPanelHeight(height === null ? null : Math.round(Math.min(window.innerHeight - 32, Math.max(160, height))));
	function startPanelResize(e: ReactPointerEvent<HTMLElement>) {
		e.preventDefault();
		const box = panelRef.current;
		if (!box) return;
		const from = { y: e.clientY, height: box.getBoundingClientRect().height };
		const move = (ev: PointerEvent) => resizePanel(from.height + ev.clientY - from.y);
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
					className="flex flex-col gap-3 [--player-h:42vh] lg:sticky lg:top-4 lg:z-30 lg:order-3 lg:[--player-h:max(15rem,calc(100vh-14rem))]"
				>
					<div className="flex flex-col gap-2 lg:flex-row lg:items-start">
					<div ref={playerAreaRef} className="relative min-w-0 flex-1">
					{/* Over the video, where people look when their text is still in front. */}
					{mode === "preview" && cutoutWait && (
						<div className="pointer-events-none absolute inset-x-0 top-2 z-20 flex justify-center px-2">
							<span className="rounded-full bg-black/75 px-3 py-1 text-xs text-white tabular-nums">Cutting you out · {cutoutWait}</span>
						</div>
					)}
					{mode === "preview" && deciding ? (
						<div
							className="mx-auto w-full rounded-lg bg-black"
							style={{ aspectRatio: `${outputSize(subtitle).width} / ${outputSize(subtitle).height}`, maxWidth: `calc(var(--player-h, 70vh) * ${outputSize(subtitle).width} / ${outputSize(subtitle).height})` }}
						/>
					) : mode === "preview" && useStudio && studio ? (
						<StudioPlayer
							key={playerKey}
							ref={playerRef}
							media={stackedPreview ? { ...studio, videoUrl: stackedPreview, stacked: true } : studio}
							cutout={{ layers: cutoutLayers, files: cutoutFiles, onInsert: (id, patch) => onCutoutChange({ ...cutoutLayers, inserts: cutoutLayers.inserts.map((i) => (i.id === id ? { ...i, ...patch } : i)) }) }}
							segments={segments}
							lines={lines}
							subtitle={subtitle}
							onSubtitleChange={onSubtitleChange}
							onTime={onPreviewTime}
							onPlayingChange={setPlaying}
							banners={banners}
							onBannersChange={onBannersChange}
							frames={frames}
							onFrameChange={panel === "frame" ? changeFrame : undefined}
							layouts={layouts}
							onLayoutChange={panel === "layout" ? changeLayout : undefined}
							faces={faces}
							noZoom={noZoom}
							zoomParts={zoomParts}
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
							frames={frames}
							onFrameChange={panel === "frame" ? changeFrame : undefined}
							layouts={layouts}
							onLayoutChange={panel === "layout" ? changeLayout : undefined}
							noZoom={noZoom}
							zoomParts={zoomParts}
						/>
					) : (
						<>
						<div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-blue-600/10 px-3 py-1.5 text-xs">
							<span>The original video, before any cuts. Your edits are safe.</span>
							<button onClick={() => setMode("preview")} className="shrink-0 rounded-md bg-blue-600 px-2 py-1 font-medium text-white hover:bg-blue-700">
								Back to editing
							</button>
						</div>
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
						</>
					)}
					</div>
					{/* Beside the video on big screens, so the tools never take height from it. */}
					<div ref={tabsRef} className="flex shrink-0 flex-wrap justify-center gap-1 lg:flex-col" role="tablist" aria-label="Settings">
						{mode === "preview" &&
							PANELS.filter((p) => p.id !== "cutout" || cutout.on).map((p) => (
								<button
									key={p.id}
									role="tab"
									aria-selected={panel === p.id}
									title={p.name}
									onClick={() => {
										if (p.id === "cutout") markCutoutSeen();
										setPanel(panel === p.id ? null : p.id);
									}}
									className={`flex w-14 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[10px] leading-3 ${
										panel === p.id ? "bg-foreground text-background" : "text-foreground/70 hover:bg-foreground/5 hover:text-foreground"
									}`}
								>
									<span className="relative">
										<p.icon className="h-[18px] w-[18px]" aria-hidden />
										{p.id === "cutout" && cutoutBusy && <span title="Cutting you out" className="absolute -top-1 -right-1 h-2 w-2 animate-pulse rounded-full bg-blue-500" />}
										{p.id === "cutout" && cutoutNews && <span title="Your cutout is ready" className="absolute -top-1.5 -right-1.5 h-3 w-3 animate-pulse rounded-full bg-green-500 ring-2 ring-background" />}
									</span>
									{p.id === "cutout" && cutout.timeLeft !== null && cutout.timeLeft > 0 ? <span className="tabular-nums">{clock(cutout.timeLeft)}</span> : p.name}
								</button>
							))}
						<button
							onClick={() => setMode(mode === "preview" ? "original" : "preview")}
							aria-pressed={mode === "original"}
							title={mode === "preview" ? "See the original video, before any cuts" : "Back to the edited video: nothing was lost"}
							className={`flex w-14 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[10px] leading-3 ${
								mode === "original" ? "bg-blue-600 text-white hover:bg-blue-700" : "text-foreground/70 hover:bg-foreground/5 hover:text-foreground"
							}`}
						>
							{/* In the Original, the same button says how to get back, so it doesn't look like the edits are gone (coach, 6 Nov). */}
							{mode === "original" ? <Undo2 className="h-[18px] w-[18px]" aria-hidden /> : <Film className="h-[18px] w-[18px]" aria-hidden />}
							{mode === "original" ? "Back to editing" : "Original"}
						</button>
					</div>
					</div>
					{mode === "preview" && <AudioControls style={subtitle} onChange={onSubtitleChange} />}
					{/* Floats over the script on big screens: the video keeps its size while you watch the change. */}
					{mode === "preview" && panel && (
						<div
							ref={panelRef}
							className={`relative flex flex-col surface-inverse rounded-lg border border-foreground/15 shadow-xl lg:absolute lg:top-0 lg:right-full lg:z-30 lg:mr-3 lg:w-[26rem] ${panelHeight ? "" : "lg:max-h-[calc(100vh-26rem)]"}`}
							style={panelHeight ? ({ "--panel-h": `${panelHeight}px` } as CSSProperties) : undefined}
						>
						<div className={`flex min-h-0 flex-col gap-2 lg:overflow-y-auto ${panelHeight ? "lg:h-[min(var(--panel-h),calc(100vh-2rem))]" : "lg:flex-1"}`}>
							<div className="flex items-center justify-between px-3 pt-2 text-sm font-medium">
								{PANELS.find((p) => p.id === panel)?.name}
								<button onClick={() => setPanel(null)} aria-label="Close settings" title="Close (Esc, or click outside)" className="rounded p-1 text-foreground/50 hover:bg-foreground/5 hover:text-foreground">
									<X className="h-4 w-4" aria-hidden />
								</button>
							</div>
					{panel !== "banners" && panel !== "cutout" && panel !== "frame" && panel !== "layout" && panel !== "import" && (
						<SubtitleControls
							style={subtitle}
							onChange={onSubtitleChange}
							thai={thaiClip}
							section={panel}
							top={
								panel === "zoom" ? (
									<div className="flex flex-col gap-1.5 rounded-lg border border-purple-500/40 bg-purple-500/10 p-2 text-xs">
										<div className="flex flex-wrap items-center gap-2">
											<button
												onClick={onFindMoments}
												disabled={moments === "finding"}
												title={zoomParts.length ? "Puts back the zoom parts the AI picked, in place of these" : "The AI reads the script and zooms only where it adds something: a punchline, a key point, a strong feeling"}
												className="inline-flex items-center gap-1 rounded-md bg-purple-600 px-2.5 py-1 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-60"
											>
												<Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
												{moments === "finding" ? "Finding key moments…" : zoomParts.length ? "Find key moments again" : "Zoom on key moments"}
											</button>
											{zoomParts.length > 0 && (
												<button onClick={() => onZoomChange({ noZoom, zoomParts: [] })} className="rounded-md border border-foreground/20 px-2 py-1 hover:bg-foreground/5">
													Remove all {zoomParts.length} zoom parts
												</button>
											)}
										</div>
										<span className="text-foreground/70">
											{moments === "failed"
												? "Could not find the key moments. Please try again."
												: zoomParts.length
													? `${zoomParts.length} ${zoomParts.length === 1 ? "part zooms" : "parts zoom"} on its own (purple on the timeline). Click one there to change it.`
													: "The AI picks the moments worth a zoom, and how each one zooms."}{" "}
											Drag across the timeline to pick any part, then choose how it zooms.
										</span>
									</div>
								) : undefined
							}
							footer={
								panel === "brand" ? (
									<div className="flex flex-col gap-2">
										{kits && kits.length > 0 && (
											<label className="flex flex-wrap items-center gap-2 text-sm">
												<span className="text-foreground/70">Brand Kit for this video</span>
												<select value={inUse ?? ""} onChange={(e) => applyKit(e.target.value)} className="rounded-md border border-foreground/20 bg-background px-2 py-1 text-sm">
													{!inUse && (
														<option value="" disabled>
															Custom look
														</option>
													)}
													{kits.map((k) => (
														<option key={k.id} value={k.id}>
															{k.name}
														</option>
													))}
												</select>
												{kitChanged && <span className="text-xs font-medium text-amber-600">changed</span>}
											</label>
										)}
										{/* Coach, 13 Nov: "Save to" the kit in use, "Saved" right after the button pressed, "Create New Brand Kit" below. */}
										{kitInUse && (
											<div className="flex flex-wrap items-center gap-2 text-sm">
												<button
													onClick={() => void saveBrand(false)}
													disabled={brandSaved === "saving" || !kitChanged}
													title={kitChanged ? `Your next videos with "${kitInUse.name}" start with this look` : "Nothing changed yet"}
													className="rounded-md border border-foreground/20 px-2.5 py-1 hover:bg-foreground/5 disabled:opacity-50"
												>
													Save to &ldquo;{kitInUse.name}&rdquo;
												</button>
												{!savedNew && brandSaved === "saved" && <span className="text-xs font-medium text-green-600">Saved</span>}
												{!savedNew && brandSaved === "failed" && <span className="text-xs text-red-600">Could not save, try again</span>}
											</div>
										)}
										<div className="flex flex-wrap items-center gap-2 text-sm">
											<button
												onClick={() => void saveBrand(true)}
												disabled={brandSaved === "saving" || kits === null}
												className="rounded-md border border-foreground/20 px-2.5 py-1 hover:bg-foreground/5 disabled:opacity-50"
											>
												Create New Brand Kit
											</button>
											{savedNew && brandSaved === "saved" && <span className="text-xs font-medium text-green-600">Saved</span>}
											{savedNew && brandSaved === "failed" && <span className="text-xs text-red-600">Could not save, try again</span>}
										</div>
										{/* Coach, 6 Nov: does a saved logo stay? 13 Nov: several Brand Kits, one per channel. */}
										<p className="text-xs text-foreground/60">
											Brand Kits are looks kept in your account, one per channel if you like. New videos start with the starred one, or the one you pick when
											uploading. Here you save only into the kit this video uses, or a new one; change other kits on the Brand Kit page. Videos you already made keep their own look, but your logo is one picture: Change picture
											uses the new one everywhere.
										</p>
									</div>
								) : undefined
							}
						/>
					)}
					{panel === "cutout" && (
						<CutoutControls
							layers={cutoutLayers}
							onChange={onCutoutChange}
							cutout={{ ...cutout, files: cutoutFiles }}
							segments={segments}
							now={() => toOutSeconds(timeRef.current, segments)}
							total={totalFrames(segments) / FPS}
							videoUrl={studio?.videoUrl ?? null}
							thai={thaiClip}
							focus={focusCutout}
							onReveal={reveal}
						/>
					)}
					{panel === "frame" && (
						<FrameControls
							frames={frames}
							onChange={onFramesChange}
							now={() => toOutSeconds(timeRef.current, segments)}
							total={totalFrames(segments) / FPS}
							focus={focusFrame}
							onReveal={reveal}
						/>
					)}
					{panel === "layout" && (
						<LayoutControls
							layouts={layouts}
							onChange={onLayoutsChange}
							now={() => toOutSeconds(timeRef.current, segments)}
							total={totalFrames(segments) / FPS}
							focus={focusLayout}
							onReveal={reveal}
						/>
					)}
					{panel === "import" && (
						<ImportControls
							onUseAsBanner={putAsBanner}
							onUseInPicClip={cutout.on ? putInPicClip : undefined}
							usedNow={filesInUse({ banners, cutout: cutoutLayers, frames, layouts })}
						/>
					)}
					{panel === "banners" && (
						<BannerControls
							banners={banners}
							onChange={onBannersChange}
							now={() => toOutSeconds(timeRef.current, segments)}
							total={totalFrames(segments) / FPS}
							brand={subtitle.color}
							focus={focusBanner}
							format={subtitle.format}
							onUseFile={putAsBanner}
							onReveal={reveal}
						/>
					)}
						</div>
						{/* Drag the corner to make the box taller, instead of scrolling inside it (coach, 6 Nov). */}
						<div
							role="separator"
							aria-orientation="horizontal"
							aria-label="Drag to make the settings taller or shorter"
							title="Drag to make this box taller or shorter (double-click: back to normal)"
							onPointerDown={startPanelResize}
							onDoubleClick={() => resizePanel(null)}
							className="absolute right-0 bottom-0 hidden h-4 w-4 cursor-nwse-resize touch-none items-end justify-end p-0.5 text-foreground/40 hover:text-foreground lg:flex"
						>
							<svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden>
								<path d="M9 1 1 9M9 5 5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
							</svg>
						</div>
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
							<button
								type="submit"
								disabled={editTooLong}
								title={editTeaches ? "Fix it here and in your next videos (Enter)" : undefined}
								className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
							>
								{editTeaches ? "Save + My words" : "Save"}
							</button>
							{editTeaches && !editTooLong && (
								<button
									type="button"
									onClick={() => saveEdit(editing.text, false)}
									title="Fix it in this video only. My words stays as it is."
									className="rounded-lg border border-blue-600 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-600/10"
								>
									Save (this video only)
								</button>
							)}
							{sameElsewhere > 0 && !editTooLong && (
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
							{editTooLong && <span className="w-full text-xs font-medium text-red-600">That is too much text to fix at once. Select a shorter part, up to {MAX_FIX_LENGTH} letters.</span>}
							{editTeaches && editLesson && (
								<span className="w-full text-xs text-foreground/70">
									My words will remember: <span className="font-medium">{editLesson.pairs.map((p) => `${p.heard} → ${p.fixed}`).join(", ")}</span>. A word that is right either way is only fixed where the sentence fits.
								</span>
							)}
							{editLesson && editLesson.kind !== "spelling" && editLesson.kind !== "same" && onLearn && <span className="w-full text-xs text-foreground/70">{KIND_NOTE[editLesson.kind]}</span>}
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
								replaceAll(finding.find, finding.replace, true);
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
						className={`relative overflow-y-auto rounded-lg bg-foreground/5 p-4 text-base leading-8 lg:text-lg lg:leading-9 ${scriptHeight ? "" : "max-h-[50vh] lg:max-h-[calc(100vh-29rem)]"}`}
						style={scriptHeight ? { height: scriptHeight } : undefined}
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
									retake={markedWord(item)}
									heardAs={item.fixed ? originalText(item.index, item.last) : null}
									actions={wordActions}
								/>
							);
						})}
					</div>
			{/* Pinned to the bottom of the screen on big screens, like a video editor's timeline. */}
			<div ref={timelineRef} className="sticky bottom-0 z-20 flex flex-col lg:bottom-2">
				{/* Drag to give the script more room, or the timeline (coach, 7 Nov: only a few lines of the script showed). */}
				<div
					role="separator"
					aria-orientation="horizontal"
					aria-label="Drag to make the script taller or shorter"
					title="Drag to make the script taller or shorter (double-click: back to normal)"
					onPointerDown={startScriptResize}
					onDoubleClick={() => resizeScript(null)}
					className="group flex h-3 cursor-row-resize touch-none items-center justify-center"
				>
					<span className="h-1 w-12 rounded-full bg-foreground/15 transition-colors group-hover:bg-blue-600" />
				</div>
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
					banners={banners}
					onBannersChange={onBannersChange}
					onOpenBanners={(id) => {
						setFocusBanner(id);
						openPanel("banners");
					}}
					cutoutLayers={cutoutLayers}
					onCutoutChange={onCutoutChange}
					revealed={revealed}
					splits={subtitle.splits ?? []}
					onSplitsChange={(splits) => onSubtitleChange({ ...subtitle, splits })}
					onOpenCutout={(id) => {
						setFocusCutout(id);
						openPanel("cutout");
					}}
					frames={frames}
					onFramesChange={onFramesChange}
					onOpenFrame={(id) => {
						setFocusFrame(id);
						openPanel("frame");
					}}
					layouts={layouts}
					onLayoutsChange={onLayoutsChange}
					onOpenLayout={(id) => {
						setFocusLayout(id);
						openPanel("layout");
					}}
					noZoom={noZoom}
					zoomParts={zoomParts}
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
