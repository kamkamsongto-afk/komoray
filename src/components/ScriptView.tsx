"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { allCuts, type Fix, fixedWords, setFix } from "@/lib/edit";
import { LIMITS, type SubtitleStyle } from "@/lib/subtitle-style";
import { keepSegments, subtitleLines } from "@/lib/timeline";
import { type PreviewHandle, PreviewPlayer } from "./PreviewPlayer";

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

// Deepgram splits Thai into pieces ("พ" "ัด" "ล" "ม"). Glue the pieces back into real words using the
// browser's Thai word splitter, keeping each piece whole. Returns the first piece index of each word.
function thaiWordStarts(words: Word[]): Set<number> {
	const starts = new Set<number>();
	const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("th", { granularity: "word" }) : null;
	let i = 0;
	while (i < words.length) {
		// A run of Thai pieces with no real pause between them.
		let j = i + 1;
		while (j < words.length && isThai(words[i].text) && isThai(words[j].text) && words[j].start - words[j - 1].end < 0.3) j++;
		starts.add(i);
		if (segmenter && j - i > 1) {
			const offsets: number[] = [];
			let text = "";
			for (let k = i; k < j; k++) {
				offsets.push(text.length);
				text += fixThai(words[k].text);
			}
			const bounds = new Set([...segmenter.segment(text)].map((s) => s.index));
			for (let k = i + 1; k < j; k++) if (bounds.has(offsets[k - i])) starts.add(k);
		} else for (let k = i + 1; k < j; k++) starts.add(k);
		i = j;
	}
	return starts;
}

// Turn the word list into what we draw: words, "silence cut here" markers, and paragraph breaks.
// A fixed (retyped) run of words is drawn as one word with the new text.
function layout(words: Word[], cuts: Cut[], fixes: Fix[]): Item[] {
	const fixAt = new Map(fixes.map((f) => [f.from, f]));
	const items: Item[] = [];
	// Thai clips only get spaces where Thai, numbers and English meet (Deepgram also splits English
	// into pieces there: "P r ice"). English clips get a space between every word.
	const thaiClip = words.filter((w) => isThai(w.text)).length > words.length / 2;
	const starts = thaiClip ? thaiWordStarts(words) : null;
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
		const last = items[items.length - 1];
		// Glue this piece onto the word before it (same Thai word, nothing in between).
		if (!fix && starts && !starts.has(i) && !silence && last?.kind === "word" && !last.fixed) {
			last.text += fixThai(w.text);
			last.last = i;
			continue;
		}
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
	duration: number;
	words: Word[];
	cuts: Cut[];
	deleted: number[];
	onChange: (deleted: number[]) => void;
	fixes: Fix[];
	onFixesChange: (fixes: Fix[]) => void;
	subtitle: SubtitleStyle;
	onSubtitleChange: (style: SubtitleStyle) => void;
};

// The editor: script on the left, the video on the right (stacked on phones, video first).
export function ScriptView({ videoUrl, duration, words, cuts, deleted, onChange, fixes, onFixesChange, subtitle, onSubtitleChange }: Props) {
	const videoRef = useRef<HTMLVideoElement>(null);
	const boxRef = useRef<HTMLDivElement>(null);
	const [current, setCurrent] = useState(-1);
	const [playing, setPlaying] = useState(false);
	const [selected, setSelected] = useState<number[]>([]);
	const items = useMemo(() => layout(words, cuts, fixes), [words, cuts, fixes]);
	// Retyping words: the transcript positions being fixed and what is in the box so far.
	const [editing, setEditing] = useState<{ from: number; to: number; text: string; original: string } | null>(null);
	const gone = useMemo(() => new Set(deleted), [deleted]);
	// Preview = the final video (cuts, 9:16, subtitles), built live in the browser. Original = the raw upload.
	const [mode, setMode] = useState<"preview" | "original">("preview");
	const playerRef = useRef<PreviewHandle>(null);
	const segments = useMemo(
		() => keepSegments(duration, allCuts({ duration, words, cuts: cuts.map((c) => ({ ...c, reason: "silence" as const })), deleted })),
		[duration, words, cuts, deleted],
	);
	const lines = useMemo(() => subtitleLines(fixedWords(words, fixes), segments), [words, fixes, segments]);
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
		setEditing({ from: start, to: end, text, original: originalText(start, end) });
	}

	function saveEdit(text: string) {
		if (!editing) return;
		onFixesChange(setFix(fixes, editing.from, editing.to, text, editing.original));
		setEditing(null);
	}

	const editingFixed = editing && fixes.some((f) => f.to >= editing.from && f.from <= editing.to);

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

	const styleSlider = (label: string, key: "size" | "outline") => (
		<label className="flex items-center gap-3 text-sm text-foreground/70">
			<span className="w-24 shrink-0">{label}</span>
			<input
				type="range"
				min={LIMITS[key].min}
				max={LIMITS[key].max}
				step={LIMITS[key].step}
				value={subtitle[key]}
				onChange={(e) => onSubtitleChange({ ...subtitle, [key]: Number(e.target.value) })}
				className="flex-1"
			/>
			<span className="w-8 text-right tabular-nums">{subtitle[key]}</span>
		</label>
	);

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
				{mode === "preview" ? (
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
					<div className="flex flex-col gap-2 rounded-lg border border-foreground/15 p-3">
						<p className="text-sm font-medium">Subtitles</p>
						{styleSlider("Text size", "size")}
						{styleSlider("Black outline", "outline")}
						<p className="text-xs text-foreground/60">Drag the subtitles on the video to move them up or down.</p>
					</div>
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
				<div className="flex min-h-9 flex-wrap items-center gap-2">
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
							<Fragment key={i}>
								{item.space && " "}
								<span
									data-word={item.index}
									data-last={item.last}
									onClick={() => seek(words[item.index].start, gone.has(item.index))}
									onDoubleClick={() => startEdit(item.index, item.last)}
									title={item.fixed ? `Fixed · heard as "${originalText(item.index, item.last)}"` : undefined}
									className={`cursor-pointer rounded transition-colors ${
										gone.has(item.index)
											? "text-red-600/60 line-through decoration-2"
											: item.index <= current && current <= item.last
												? "bg-blue-600 text-white"
												: "hover:bg-foreground/10"
									} ${item.fixed ? "underline decoration-green-600 decoration-2 underline-offset-4" : ""}`}
								>
									{item.text}
								</span>
							</Fragment>
						);
					})}
				</div>
			</div>
		</div>
	);
}
