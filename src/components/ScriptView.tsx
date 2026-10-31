"use client";

import { memo, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { allCuts, type Fix, fixedWords, normText, setFix, TRAIL, type WordFix } from "@/lib/edit";
import type { Banner } from "@/lib/banners";
import { type SubtitleStyle } from "@/lib/subtitle-style";
import { findRepeatedTakes, type Take } from "@/lib/takes";
import { FPS, keepSegments, subtitleLines, toOutSeconds, totalFrames } from "@/lib/timeline";
import { reportError } from "@/lib/report";
import { studioSupported } from "@/lib/player/engine";
import { type PreviewHandle, PreviewPlayer } from "./PreviewPlayer";
import { type StudioMedia, StudioPlayer } from "./StudioPlayer";
import { SubtitleControls } from "./SubtitleControls";
import { BannerControls } from "./BannerControls";

type Word = { text: string; start: number; end: number };
type Cut = { start: number; end: number };

const PARAGRAPH_GAP = 1.5; // a pause this long (seconds) starts a new paragraph
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

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
	retake: boolean; // part of a repeated take that could be cut
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
};

// The editor: script on the left, the video on the right (stacked on phones, video first).
export function ScriptView({
	videoUrl,
	studio,
	duration,
	words,
	cuts,
	deleted,
	onChange,
	fixes,
	onFixesChange,
	dictionary,
	onDictionaryApplied,
	onLearn,
	subtitle,
	onSubtitleChange,
	banners,
	onBannersChange,
}: Props) {
	const videoRef = useRef<HTMLVideoElement>(null);
	const boxRef = useRef<HTMLDivElement>(null);
	const [current, setCurrent] = useState(-1);
	const [playing, setPlaying] = useState(false);
	const [selected, setSelected] = useState<number[]>([]);
	const items = useMemo(() => layout(words, cuts, fixes), [words, cuts, fixes]);
	// Retyping words: the transcript positions being fixed, what showed before and what is in the box now.
	const [editing, setEditing] = useState<{ from: number; to: number; text: string; before: string; original: string } | null>(null);
	// Find & replace across the whole script.
	const [finding, setFinding] = useState<{ find: string; replace: string } | null>(null);
	const wordItems = useMemo(() => items.filter((it): it is WordItem => it.kind === "word"), [items]);
	const gone = useMemo(() => new Set(deleted), [deleted]);
	// Preview = the final video (cuts, 9:16, subtitles), built live in the browser. Original = the raw upload.
	const [mode, setMode] = useState<"preview" | "original">("preview");
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
		() => keepSegments(duration, allCuts({ duration, words, cuts: cuts.map((c) => ({ ...c, reason: "silence" as const })), deleted })),
		[duration, words, cuts, deleted],
	);
	const lines = useMemo(() => subtitleLines(fixedWords(words, fixes), segments, subtitle.look), [words, fixes, segments, subtitle.look]);
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

	// Repeated takes (lib/takes.ts): cutting one deletes its words, keeping it restores them.
	const takes = useMemo(() => findRepeatedTakes(words), [words]);
	const [showTakes, setShowTakes] = useState(false);
	const takeRange = (t: Take) => Array.from({ length: t.to - t.from + 1 }, (_, k) => t.from + k);
	const isCut = (t: Take) => takeRange(t).every((i) => gone.has(i));
	const openTakes = takes.filter((t) => !isCut(t));
	const retakeWords = useMemo(() => new Set(takes.flatMap((t) => (takeRange(t).every((i) => gone.has(i)) ? [] : takeRange(t)))), [takes, gone]);
	const cutTakes = (list: Take[], cut: boolean) => {
		const next = new Set(deleted);
		for (const t of list) for (const i of takeRange(t)) (cut ? next.add(i) : next.delete(i));
		onChange([...next].sort((a, b) => a - b));
	};
	const shownText = (from: number, to: number, max: number) => {
		const text = wordItems
			.filter((it) => it.index >= from && it.last <= to)
			.map((it, k) => (k > 0 && it.space ? " " : "") + it.text)
			.join("");
		return text.length > max ? text.slice(0, max) + "…" : text;
	};

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

	return (
		<div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,440px)] lg:items-start">
			{/* Right on big screens (sticky while the script scrolls), on top on phones. */}
			<div className="flex flex-col gap-3 lg:sticky lg:top-4 lg:order-2">
				<div className="flex self-center rounded-lg border border-foreground/20 p-0.5 text-sm">
					{(["preview", "original"] as const).map((m) => (
						<button
							key={m}
							onClick={() => setMode(m)}
							className={`rounded-md px-3 py-1 ${mode === m ? "bg-foreground text-background" : "text-foreground/70 hover:text-foreground"}`}
						>
							{m === "preview" ? "Preview (final video)" : "Original"}
						</button>
					))}
				</div>
				{mode === "preview" && deciding ? (
					<div className="mx-auto aspect-[9/16] w-full rounded-lg bg-black" style={{ maxWidth: "calc(70vh * 9 / 16)" }} />
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
				{mode === "preview" && (
					<SubtitleControls
						style={subtitle}
						onChange={onSubtitleChange}
						thai={thaiClip}
						footer={
							<button
								onClick={() => void saveBrand()}
								disabled={brandSaved === "saving"}
								className="self-start rounded-md border border-foreground/20 px-2.5 py-1 text-sm hover:bg-foreground/5 disabled:opacity-50"
								title="Use this look for every new video"
							>
								{brandSaved === "saved" ? "✓ Saved to Brand Kit" : brandSaved === "failed" ? "❌ Could not save, try again" : "⭐ Save as my Brand Kit"}
							</button>
						}
					/>
				)}
				{mode === "preview" && (
					<BannerControls
						banners={banners}
						onChange={onBannersChange}
						now={() => toOutSeconds(timeRef.current, segments)}
						total={totalFrames(segments) / FPS}
						channel={subtitle.logo}
					/>
				)}
			</div>

			<div className="flex min-w-0 flex-col gap-3 lg:order-1">
				<p className="text-xs text-foreground/60">
					{mode === "preview"
						? "The video shows how your final video will look. Changes show up right away, no need to make the video first."
						: "The video as you uploaded it."}{" "}
					Click a word to jump there. Double-click a word to fix its spelling. Drag across words to delete them. Click ✂️ to hear a
					silence that will be cut.
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
								↩️ Original
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
				{showTakes && takes.length > 0 && (
					<div className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
						<div className="flex flex-wrap items-center gap-2">
							<p className="flex-1 text-sm font-medium">
								🔁 You said these again right after. Cut the first try and keep the last one?
							</p>
							{openTakes.length > 0 && (
								<button onClick={() => cutTakes(openTakes, true)} className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700">
									✂️ Cut all ({openTakes.length})
								</button>
							)}
							<button onClick={() => setShowTakes(false)} className="rounded-lg border border-foreground/20 px-3 py-1.5 text-sm hover:bg-foreground/5">
								Close
							</button>
						</div>
						<ul className="flex flex-col divide-y divide-foreground/10">
							{takes.map((t) => {
								const cut = isCut(t);
								return (
									<li key={t.from} className="flex flex-wrap items-center gap-2 py-2 text-sm">
										<span className="w-10 shrink-0 tabular-nums text-foreground/50">{clock(words[t.from].start)}</span>
										<span className="min-w-0 flex-1 break-words">
											<span className={cut ? "text-red-600/60 line-through" : "text-amber-700 dark:text-amber-400"}>{shownText(t.from, t.to, 90)}</span>
											<span className="text-foreground/50"> → again: </span>
											<span>{shownText(t.again, Math.min(words.length - 1, t.again + 12), 50)}</span>
										</span>
										<button
											onClick={() => seek(Math.max(0, words[t.from].start - 0.3), cut)}
											className="shrink-0 rounded-md border border-foreground/20 px-2 py-1 hover:bg-foreground/5"
										>
											▶ Listen
										</button>
										<button
											onClick={() => cutTakes([t], !cut)}
											className={`shrink-0 rounded-md px-2 py-1 ${cut ? "border border-foreground/20 hover:bg-foreground/5" : "bg-amber-600 text-white hover:bg-amber-700"}`}
										>
											{cut ? "↩️ Keep" : "✂️ Cut"}
										</button>
									</li>
								);
							})}
						</ul>
						<p className="text-xs text-foreground/60">Cut takes show as deleted words in the script. You can restore them any time.</p>
					</div>
				)}
				<div className="flex min-h-9 flex-wrap items-center gap-2">
					{takes.length > 0 && !showTakes && !editing && (
						<button
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => setShowTakes(true)}
							className={`rounded-lg px-3 py-1.5 text-sm ${openTakes.length ? "bg-amber-500/15 font-medium text-amber-800 hover:bg-amber-500/25 dark:text-amber-300" : "border border-foreground/20 hover:bg-foreground/5"}`}
						>
							🔁 Repeated takes ({openTakes.length || takes.length})
						</button>
					)}
					{!finding && !editing && (
						<button
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => setFinding({ find: "", replace: "" })}
							className="rounded-lg border border-foreground/20 px-3 py-1.5 text-sm hover:bg-foreground/5"
						>
							🔍 Find &amp; replace
						</button>
					)}
					{/* onMouseDown preventDefault: keep the highlighted words selected while clicking the button */}
					{selected.length > 0 && !editing && (
						<button
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => startEdit(Math.min(...selected), Math.max(...selected))}
							className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
						>
							✏️ Fix text
						</button>
					)}
					{anyKept && (
						<button
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => apply(true)}
							className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
						>
							🗑️ Delete
						</button>
					)}
					{anyGone && (
						<button
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => apply(false)}
							className="rounded-lg border border-foreground/20 px-3 py-1.5 text-sm font-medium hover:bg-foreground/5"
						>
							↩️ Restore
						</button>
					)}
					{!selected.length && deleted.length > 0 && (
						<button
							onClick={() => onChange([])}
							className="rounded-lg border border-foreground/20 px-3 py-1.5 text-sm hover:bg-foreground/5"
						>
							↩️ Restore all deleted words
						</button>
					)}
				</div>
				<div
					ref={boxRef}
					className="relative max-h-[50vh] overflow-y-auto rounded-lg bg-foreground/5 p-4 text-base leading-8 lg:max-h-[calc(100vh-12rem)] lg:text-lg lg:leading-9"
				>
					{items.map((item, i) => {
						if (item.kind === "break") return <span key={i} className="block h-3" />;
						if (item.kind === "silence") {
							return (
								<button
									key={i}
									onClick={() => seek(item.at, true)}
									title="Silence that will be cut"
									className="mx-1 rounded bg-red-500/15 px-1.5 align-middle text-xs leading-5 text-red-600 hover:bg-red-500/25"
								>
									✂️ {item.seconds.toFixed(1)}s
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
			</div>
		</div>
	);
}
