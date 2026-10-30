"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { wordCuts } from "@/lib/edit";

type Word = { text: string; start: number; end: number };
type Cut = { start: number; end: number };

const PARAGRAPH_GAP = 1.5; // a pause this long (seconds) starts a new paragraph

const isThai = (text: string) => /[฀-๿]/.test(text);
const script = (text: string) => (isThai(text) ? "thai" : /^\d/.test(text) ? "number" : "latin");
// Deepgram writes sara am as nikhahit + sara aa (ํา), which fonts draw badly.
const fixThai = (text: string) => text.replace(/ํา/g, "ำ");

type Item =
	| { kind: "word"; index: number; last: number; text: string; space: boolean }
	| { kind: "silence"; seconds: number; at: number }
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
function layout(words: Word[], cuts: Cut[]): Item[] {
	const items: Item[] = [];
	// Thai clips only get spaces where Thai, numbers and English meet (Deepgram also splits English
	// into pieces there: "P r ice"). English clips get a space between every word.
	const thaiClip = words.filter((w) => isThai(w.text)).length > words.length / 2;
	const starts = thaiClip ? thaiWordStarts(words) : null;
	const silenceBetween = (from: number, to: number) => {
		const inside = cuts.filter((c) => c.start >= from - 0.01 && c.end <= to + 0.01);
		return inside.length ? { seconds: inside.reduce((sum, c) => sum + c.end - c.start, 0), at: inside[0].start } : null;
	};

	words.forEach((w, i) => {
		const prev = words[i - 1];
		const silence = silenceBetween(prev ? prev.end : 0, w.start);
		const last = items[items.length - 1];
		// Glue this piece onto the word before it (same Thai word, nothing in between).
		if (starts && !starts.has(i) && !silence && last?.kind === "word") {
			last.text += fixThai(w.text);
			last.last = i;
			return;
		}
		if (prev && w.start - prev.end >= PARAGRAPH_GAP) items.push({ kind: "break" });
		if (silence) items.push({ kind: "silence", ...silence });
		const space = Boolean(prev) && (thaiClip ? script(prev.text) !== script(w.text) : true);
		items.push({ kind: "word", index: i, last: i, text: fixThai(w.text), space });
	});

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
};

export function ScriptView({ videoUrl, duration, words, cuts, deleted, onChange }: Props) {
	const videoRef = useRef<HTMLVideoElement>(null);
	const boxRef = useRef<HTMLDivElement>(null);
	const [current, setCurrent] = useState(-1);
	const [playing, setPlaying] = useState(false);
	const [selected, setSelected] = useState<number[]>([]);
	const items = useMemo(() => layout(words, cuts), [words, cuts]);
	const gone = useMemo(() => new Set(deleted), [deleted]);
	// Where playback jumps over deleted words, so the preview sounds like the final video.
	const skips = useMemo(() => wordCuts(words, deleted, duration), [words, deleted, duration]);

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

	// Delete / Backspace removes the highlighted words, like in a text editor.
	useEffect(() => {
		if (!selected.length) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Delete" && e.key !== "Backspace") return;
			e.preventDefault();
			apply(true);
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [selected, apply]);

	const anyKept = selected.some((i) => !gone.has(i));
	const anyGone = selected.some((i) => gone.has(i));

	// While playing, follow the video every frame (timeupdate alone is too jumpy for word highlights).
	useEffect(() => {
		if (!playing) return;
		let frame = 0;
		const tick = () => {
			const video = videoRef.current;
			if (video) {
				const skip = skips.find((c) => video.currentTime >= c.start && video.currentTime < c.end - 0.05);
				if (skip) video.currentTime = Math.min(skip.end, video.duration || skip.end);
				setCurrent(wordAt(words, video.currentTime));
			}
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [playing, words, skips]);

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

	function seek(seconds: number) {
		// A click that ends a drag-to-select should select, not jump.
		if (!window.getSelection()?.isCollapsed) return;
		const video = videoRef.current;
		if (!video) return;
		video.currentTime = seconds;
		setCurrent(wordAt(words, seconds));
		void video.play();
	}

	return (
		<div className="flex flex-col gap-3">
			<video
				ref={videoRef}
				src={videoUrl}
				controls
				playsInline
				preload="metadata"
				onPlay={() => setPlaying(true)}
				onPause={() => setPlaying(false)}
				onEnded={() => setPlaying(false)}
				onSeeked={(e) => setCurrent(wordAt(words, e.currentTarget.currentTime))}
				className="max-h-[50vh] w-full rounded-lg bg-black"
			/>
			<p className="text-xs text-foreground/60">
				Click a word to jump there. Drag across words to delete them. ✂️ marks a silence that will be cut.
			</p>
			<div className="flex min-h-9 flex-wrap items-center gap-2">
				{/* onMouseDown preventDefault: keep the highlighted words selected while clicking the button */}
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
			<div ref={boxRef} className="relative max-h-80 overflow-y-auto rounded-lg bg-foreground/5 p-4 text-base leading-8">
				{items.map((item, i) => {
					if (item.kind === "break") return <span key={i} className="block h-3" />;
					if (item.kind === "silence") {
						return (
							<button
								key={i}
								onClick={() => seek(item.at)}
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
								onClick={() => seek(words[item.index].start)}
								className={`cursor-pointer rounded transition-colors ${
									gone.has(item.index)
										? "text-red-600/60 line-through decoration-2"
										: item.index <= current && current <= item.last
											? "bg-blue-600 text-white"
											: "hover:bg-foreground/10"
								}`}
							>
								{item.text}
							</span>
						</Fragment>
					);
				})}
			</div>
		</div>
	);
}
