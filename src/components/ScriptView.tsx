"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";

type Word = { text: string; start: number; end: number };
type Cut = { start: number; end: number };

const PARAGRAPH_GAP = 1.5; // a pause this long (seconds) starts a new paragraph

const isThai = (text: string) => /[฀-๿]/.test(text);
const script = (text: string) => (isThai(text) ? "thai" : /^\d/.test(text) ? "number" : "latin");
// Deepgram writes sara am as nikhahit + sara aa (ํา), which fonts draw badly.
const fixThai = (text: string) => text.replace(/ํา/g, "ำ");

type Item =
	| { kind: "word"; index: number; text: string; space: boolean }
	| { kind: "silence"; seconds: number; at: number }
	| { kind: "break" };

// Turn the word list into what we draw: words, "silence cut here" markers, and paragraph breaks.
function layout(words: Word[], cuts: Cut[]): Item[] {
	const items: Item[] = [];
	// In Thai clips Deepgram splits English words into pieces ("P r ice"), so only put spaces
	// where Thai, numbers and English meet. English clips get a space between every word.
	const thaiClip = words.filter((w) => isThai(w.text)).length > words.length / 2;
	const silenceBetween = (from: number, to: number) => {
		const inside = cuts.filter((c) => c.start >= from - 0.01 && c.end <= to + 0.01);
		return inside.length ? { seconds: inside.reduce((sum, c) => sum + c.end - c.start, 0), at: inside[0].start } : null;
	};

	words.forEach((w, i) => {
		const prev = words[i - 1];
		const silence = silenceBetween(prev ? prev.end : 0, w.start);
		if (prev && w.start - prev.end >= PARAGRAPH_GAP) items.push({ kind: "break" });
		if (silence) items.push({ kind: "silence", ...silence });
		const space = Boolean(prev) && (thaiClip ? script(prev.text) !== script(w.text) : true);
		items.push({ kind: "word", index: i, text: fixThai(w.text), space });
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

export function ScriptView({ videoUrl, words, cuts }: { videoUrl: string; words: Word[]; cuts: Cut[] }) {
	const videoRef = useRef<HTMLVideoElement>(null);
	const boxRef = useRef<HTMLDivElement>(null);
	const [current, setCurrent] = useState(-1);
	const [playing, setPlaying] = useState(false);
	const items = useMemo(() => layout(words, cuts), [words, cuts]);

	// While playing, follow the video every frame (timeupdate alone is too jumpy for word highlights).
	useEffect(() => {
		if (!playing) return;
		let frame = 0;
		const tick = () => {
			const video = videoRef.current;
			if (video) setCurrent(wordAt(words, video.currentTime));
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [playing, words]);

	// Keep the highlighted word visible inside the transcript box (without scrolling the whole page).
	useEffect(() => {
		if (!playing || current < 0) return;
		const box = boxRef.current;
		const el = box?.querySelector<HTMLElement>(`[data-word="${current}"]`);
		if (!box || !el) return;
		const top = el.offsetTop; // the box is position:relative, so this is measured from its top
		if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - 40) box.scrollTo({ top: top - box.clientHeight / 3, behavior: "smooth" });
	}, [current, playing]);

	function seek(seconds: number) {
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
			<p className="text-xs text-foreground/60">Click any word to jump there. ✂️ marks a silence that will be cut.</p>
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
								onClick={() => seek(words[item.index].start)}
								className={`cursor-pointer rounded px-0.5 transition-colors ${
									item.index === current ? "bg-blue-600 text-white" : "hover:bg-foreground/10"
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
