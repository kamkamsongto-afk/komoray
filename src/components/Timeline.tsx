"use client";

import { type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TakeGroup } from "@/lib/takes";
import { FPS, type Segment, toOutSeconds, totalFrames } from "@/lib/timeline";
import { loadPeaks, PEAKS_PER_SECOND } from "@/lib/waveform";

type Word = { text: string; start: number; end: number };
// A word as the script draws it (a fixed run of words is one item, with the new text).
type ScriptWord = { index: number; last: number; text: string; space: boolean };

type Props = {
	duration: number;
	words: Word[];
	scriptWords: ScriptWord[];
	gone: Set<number>; // deleted word positions
	segments: Segment[]; // the kept pieces of the source
	timeRef: RefObject<number>; // where the player is in the source, seconds (read every frame)
	playing: boolean;
	onTogglePlay: () => void;
	onSeek: (source: number) => void;
	audioUrl: string | null; // the preview's sound, for the waveform; null until it is made
	groups: TakeGroup[];
	onPickTake: (group: TakeGroup, take: number) => void;
	onListen: (from: number, to: number) => void; // play these words (in the Original if they are cut)
};

// Heights, px: time ruler, sentence chips, waveform.
const RULER = 22;
const CHIPS_TOP = RULER + 4;
const CHIPS = 26;
const WAVE_TOP = CHIPS_TOP + CHIPS + 6;
const WAVE = 58;
const HEIGHT = WAVE_TOP + WAVE + 4;

const CHIP_GAP = 0.7; // a pause this long (seconds) starts a new chip
const CHIP_MAX = 12; // a chip never covers more seconds than this
const MAX_PPS = 300; // most zoomed in: pixels per second
const START_PPS = 40;
const TICK_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const SHOW_CUTS = "komoray.timelineCuts"; // remembers the Show cuts switch in this browser

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const clockTenths = (s: number) => `${clock(s)}.${Math.floor((s * 10) % 10)}`;

// A run of script words drawn as one chip: a sentence or so, all kept or all deleted.
type Chip = { start: number; end: number; text: string; gone: boolean };

function makeChips(words: Word[], items: ScriptWord[], gone: Set<number>): Chip[] {
	const chips: Chip[] = [];
	let chip: Chip | null = null;
	for (const it of items) {
		const start = words[it.index].start;
		const end = words[it.last].end;
		const isGone = gone.has(it.index);
		if (!chip || chip.gone !== isGone || start - chip.end >= CHIP_GAP || end - chip.start > CHIP_MAX || /[.!?…]$/.test(chip.text)) {
			if (chip) chips.push(chip);
			chip = { start, end, text: it.text, gone: isGone };
		} else {
			chip.text += (it.space ? " " : "") + it.text;
			chip.end = end;
		}
	}
	if (chip) chips.push(chip);
	return chips;
}

// The timeline under the editor, like a video editor's: time ruler, the script as chips, the
// waveform, and the cuts. With Show cuts on it is the whole upload (cuts shaded); off, it is the
// final video with the cuts closed up. 🔁 marks a sentence said more than once: pick the take to keep.
export function Timeline({
	duration,
	words,
	scriptWords,
	gone,
	segments,
	timeRef,
	playing,
	onTogglePlay,
	onSeek,
	audioUrl,
	groups,
	onPickTake,
	onListen,
}: Props) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const headRef = useRef<HTMLDivElement>(null);
	const timeTextRef = useRef<HTMLSpanElement>(null);
	const [viewWidth, setViewWidth] = useState(800);
	const [pps, setPps] = useState(START_PPS);
	const [showCuts, setShowCuts] = useState(true);
	const [peaks, setPeaks] = useState<{ data: Float32Array; version: number } | null>(null);
	const [openGroup, setOpenGroup] = useState<number | null>(null);
	const anchor = useRef<{ time: number; at: number } | null>(null); // keep this moment under this x after zooming

	useEffect(() => {
		try {
			if (localStorage.getItem(SHOW_CUTS) === "0") setShowCuts(false);
		} catch {
			// no storage: the switch starts on
		}
	}, []);
	const toggleCuts = (on: boolean) => {
		setShowCuts(on);
		try {
			localStorage.setItem(SHOW_CUTS, on ? "1" : "0");
		} catch {
			// not remembered, that's fine
		}
	};

	const total = totalFrames(segments) / FPS;
	const length = showCuts ? duration : total; // seconds across the whole timeline
	const fit = viewWidth / Math.max(1, length);
	const scale = Math.max(fit, Math.min(MAX_PPS, pps));
	const width = Math.max(viewWidth, Math.ceil(length * scale));

	// Source seconds → x on the timeline, and back.
	const xOf = useCallback((t: number) => (showCuts ? t : toOutSeconds(t, segments)) * scale, [showCuts, segments, scale]);
	const timeAt = useCallback(
		(x: number) => {
			const t = Math.max(0, x / scale);
			if (showCuts) return Math.min(duration, t);
			const f = t * FPS;
			const s = segments.find((seg) => f < seg.from + seg.frames) ?? segments[segments.length - 1];
			return s ? (s.trim + Math.min(s.frames, Math.max(0, f - s.from))) / FPS : 0;
		},
		[showCuts, segments, scale, duration],
	);

	const chips = useMemo(() => makeChips(words, scriptWords, gone), [words, scriptWords, gone]);
	// The cut parts of the source, merged (for shading with Show cuts on).
	const cutSpans = useMemo(() => {
		const spans: [number, number][] = [];
		let pos = 0;
		for (const s of segments) {
			if (s.trim / FPS > pos + 0.01) spans.push([pos, s.trim / FPS]);
			pos = (s.trim + s.frames) / FPS;
		}
		if (duration > pos + 0.01) spans.push([pos, duration]);
		return spans;
	}, [segments, duration]);

	// The waveform, loaded once per video in the background.
	useEffect(() => {
		if (!audioUrl) return;
		const abort = new AbortController();
		let version = 0;
		loadPeaks(audioUrl, (data) => setPeaks({ data, version: ++version }), abort.signal).catch(() => {});
		return () => abort.abort();
	}, [audioUrl]);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const observer = new ResizeObserver(() => setViewWidth(el.clientWidth));
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	// Draw what is in view: ruler, waveform, shaded cuts (only the visible part, so long videos stay fast).
	const draw = useCallback(() => {
		const canvas = canvasRef.current;
		const el = scrollRef.current;
		if (!canvas || !el) return;
		const dpr = window.devicePixelRatio || 1;
		const w = el.clientWidth;
		if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(HEIGHT * dpr)) {
			canvas.width = Math.round(w * dpr);
			canvas.height = Math.round(HEIGHT * dpr);
			canvas.style.width = `${w}px`;
		}
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, w, HEIGHT);
		const left = el.scrollLeft;
		const ink = getComputedStyle(canvas).color;

		// Ruler: a label every `step` seconds, at least ~70 px apart, small ticks between.
		const step = TICK_STEPS.find((s) => s * scale >= 70) ?? TICK_STEPS[TICK_STEPS.length - 1];
		const minor = step / (step >= 10 && step % 3 === 0 ? 3 : 5);
		const rulerSeconds = (x: number) => x / scale; // seconds of whichever timeline is showing
		ctx.fillStyle = ink;
		ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
		ctx.textBaseline = "top";
		// Counted in whole ticks: adding up 0.4 + 0.4 + ... drifts and labels 4 s as "0:03".
		const perMajor = Math.round(step / minor);
		for (let k = Math.floor(rulerSeconds(left) / minor); k * minor * scale - left < w; k++) {
			const s = Math.round(k * minor * 1000) / 1000;
			const x = Math.round(s * scale - left) + 0.5;
			const major = k % perMajor === 0;
			ctx.globalAlpha = major ? 0.5 : 0.25;
			ctx.fillRect(x, RULER - (major ? 9 : 4), 1, major ? 9 : 4);
			if (major) {
				ctx.globalAlpha = 0.6;
				ctx.fillText(step < 1 ? clockTenths(s) : clock(s), x + 3, 2);
			}
		}
		ctx.globalAlpha = 1;

		// Shaded cuts, behind the chips and the waveform.
		if (showCuts) {
			ctx.fillStyle = "rgba(239, 68, 68, 0.14)";
			for (const [a, b] of cutSpans) {
				const x0 = a * scale - left;
				const x1 = b * scale - left;
				if (x1 < 0 || x0 > w) continue;
				ctx.fillRect(x0, CHIPS_TOP - 2, Math.max(1, x1 - x0), HEIGHT - CHIPS_TOP);
			}
		} else {
			// The joins between kept pieces.
			ctx.fillStyle = ink;
			ctx.globalAlpha = 0.25;
			for (const s of segments) {
				const x = (s.from / FPS) * scale - left;
				if (x > 0 && x < w) ctx.fillRect(Math.round(x), WAVE_TOP, 1, WAVE);
			}
			ctx.globalAlpha = 1;
		}

		// Waveform: one bar per pixel, the loudest moment under it, mirrored around the middle.
		const data = peaks?.data;
		if (data) {
			let loudest = 0.05;
			for (let i = 0; i < data.length; i += 7) loudest = Math.max(loudest, data[i]);
			const mid = WAVE_TOP + WAVE / 2;
			const keptAt = (t: number) => segments.some((s) => t * FPS >= s.trim && t * FPS < s.trim + s.frames);
			for (let px = 0; px < w; px++) {
				const t0 = timeAt(left + px);
				const t1 = timeAt(left + px + 1);
				const a = Math.floor(Math.min(t0, t1) * PEAKS_PER_SECOND);
				const b = Math.max(a + 1, Math.floor(Math.max(t0, t1) * PEAKS_PER_SECOND));
				let v = 0;
				for (let i = a; i < b && i < data.length; i++) v = Math.max(v, data[i]);
				const h = Math.max(1, Math.min(1, v / loudest) * (WAVE / 2 - 2));
				ctx.fillStyle = showCuts && !keptAt(t0) ? "rgba(239, 68, 68, 0.45)" : "rgba(37, 99, 235, 0.75)";
				ctx.fillRect(px, mid - h, 1, h * 2);
			}
		} else {
			ctx.fillStyle = ink;
			ctx.globalAlpha = 0.08;
			ctx.fillRect(0, WAVE_TOP, w, WAVE);
			ctx.globalAlpha = 1;
		}
	}, [scale, showCuts, cutSpans, segments, peaks, timeAt]);

	// Zooming keeps the moment under the mouse (or the playhead) where it was.
	useLayoutEffect(() => {
		const el = scrollRef.current;
		if (el && anchor.current) {
			el.scrollLeft = xOf(anchor.current.time) - anchor.current.at;
			anchor.current = null;
		}
		draw();
	}, [draw, xOf, width]);

	const zoomTo = useCallback(
		(next: number, atX?: number) => {
			const el = scrollRef.current;
			if (!el) return;
			const at = atX ?? Math.min(el.clientWidth / 2, Math.max(0, xOf(timeRef.current ?? 0) - el.scrollLeft));
			anchor.current = { time: timeAt(el.scrollLeft + at), at };
			setPps(Math.max(fit, Math.min(MAX_PPS, next)));
		},
		[fit, xOf, timeAt, timeRef],
	);

	// The mouse wheel scrolls sideways; Ctrl (⌘) + wheel zooms.
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			if (e.ctrlKey || e.metaKey) {
				e.preventDefault();
				zoomTo(scale * Math.exp(-e.deltaY / 300), e.clientX - el.getBoundingClientRect().left);
			} else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
				e.preventDefault();
				el.scrollLeft += e.deltaY;
			}
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, [scale, zoomTo]);

	// The playhead and the clock follow the player every frame, without redrawing React.
	const follow = useRef(true);
	useEffect(() => {
		let frame = 0;
		const tick = () => {
			const t = timeRef.current ?? 0;
			const x = xOf(t);
			if (headRef.current) headRef.current.style.transform = `translateX(${x}px)`;
			if (timeTextRef.current) timeTextRef.current.textContent = clockTenths(showCuts ? t : toOutSeconds(t, segments));
			const el = scrollRef.current;
			if (el && playing && follow.current && (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40)) el.scrollLeft = x - 40;
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [xOf, showCuts, segments, playing, timeRef]);

	// Click or drag on the timeline to move the playhead.
	const dragging = useRef(false);
	const seekAt = (clientX: number) => {
		const el = scrollRef.current;
		if (!el) return;
		onSeek(timeAt(clientX - el.getBoundingClientRect().left + el.scrollLeft));
	};

	// Slider position 0..100 ↔ zoom (pixels per second), on a log scale.
	const sliderMax = Math.max(fit * 1.001, MAX_PPS);
	const toSlider = (v: number) => (Math.log(v / fit) / Math.log(sliderMax / fit)) * 100;
	const fromSlider = (n: number) => fit * Math.pow(sliderMax / fit, n / 100);

	const textOf = (from: number, to: number, max = 70) => {
		const text = scriptWords
			.filter((it) => it.index >= from && it.last <= to)
			.map((it, k) => (k > 0 && it.space ? " " : "") + it.text)
			.join("");
		return text.length > max ? text.slice(0, max) + "…" : text;
	};
	const isKept = (t: { from: number; to: number }) => !gone.has(t.from) && !gone.has(t.to);
	const group = openGroup !== null ? groups[openGroup] : null;
	const scrollLeft = scrollRef.current?.scrollLeft ?? 0;

	useEffect(() => {
		if (openGroup === null) return;
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenGroup(null);
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [openGroup]);

	return (
		<div className="relative flex flex-col gap-1 rounded-lg border border-foreground/15 bg-background p-2 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
			<div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-sm">
				<button
					onClick={onTogglePlay}
					className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background hover:opacity-80"
					aria-label={playing ? "Pause" : "Play"}
					title="Play / Pause (Space)"
				>
					{playing ? "❚❚" : "▶"}
				</button>
				<span className="tabular-nums text-foreground/80">
					<span ref={timeTextRef}>0:00.0</span>
					<span className="text-foreground/40"> / {clockTenths(showCuts ? duration : total)}</span>
				</span>
				<label className="flex cursor-pointer items-center gap-2 select-none" title="Show the parts that will be cut">
					<span className={`relative inline-block h-5 w-9 rounded-full transition-colors ${showCuts ? "bg-blue-600" : "bg-foreground/25"}`}>
						<input type="checkbox" checked={showCuts} onChange={(e) => toggleCuts(e.target.checked)} className="peer sr-only" />
						<span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${showCuts ? "left-[18px]" : "left-0.5"}`} />
					</span>
					Show cuts
				</label>
				<span className="text-xs text-foreground/50">
					{cutSpans.length} cuts
					{groups.length > 0 && ` · 🔁 ${groups.length} repeated ${groups.length === 1 ? "take" : "takes"}`}
				</span>
				<div className="ml-auto flex items-center gap-2">
					<button onClick={() => zoomTo(scale / 1.5)} className="rounded px-1.5 text-lg leading-none text-foreground/70 hover:text-foreground" aria-label="Zoom out">
						−
					</button>
					<input
						type="range"
						min={0}
						max={100}
						step={0.5}
						value={toSlider(scale)}
						onChange={(e) => zoomTo(fromSlider(Number(e.target.value)))}
						aria-label="Zoom"
						className="w-28 accent-blue-600"
					/>
					<button onClick={() => zoomTo(scale * 1.5)} className="rounded px-1.5 text-lg leading-none text-foreground/70 hover:text-foreground" aria-label="Zoom in">
						+
					</button>
					<button onClick={() => zoomTo(fit)} className="rounded border border-foreground/20 px-2 py-0.5 text-xs hover:bg-foreground/5" title="See the whole video">
						Fit
					</button>
				</div>
			</div>

			<div
				ref={scrollRef}
				onScroll={() => {
					draw();
					if (openGroup !== null) setOpenGroup(null);
				}}
				onPointerDown={(e) => {
					if ((e.target as HTMLElement).closest("button")) return;
					dragging.current = true;
					follow.current = false;
					e.currentTarget.setPointerCapture(e.pointerId);
					seekAt(e.clientX);
				}}
				onPointerMove={(e) => dragging.current && seekAt(e.clientX)}
				onPointerUp={() => {
					dragging.current = false;
					follow.current = true;
				}}
				className="relative cursor-text overflow-x-auto overflow-y-hidden text-foreground select-none"
				style={{ height: HEIGHT + 12, touchAction: "pan-x" }}
			>
				<div className="relative" style={{ width, height: HEIGHT }}>
					<canvas ref={canvasRef} className="sticky left-0 block" style={{ height: HEIGHT }} />
					{chips.map((c, i) => {
						if (c.gone && !showCuts) return null;
						const x0 = xOf(c.start);
						const x1 = xOf(c.end);
						if (x1 - x0 < 2) return null;
						return (
							<div
								key={i}
								title={c.text}
								className={`absolute truncate rounded px-1.5 text-xs leading-[26px] ${
									c.gone ? "bg-red-500/15 text-red-600/70 line-through" : "bg-emerald-500/25 text-foreground"
								}`}
								style={{ left: x0, width: x1 - x0 - 1, top: CHIPS_TOP, height: CHIPS }}
							>
								{c.text}
							</div>
						);
					})}
					{groups.map((g, i) => {
						const kept = g.takes.find(isKept) ?? g.takes[g.takes.length - 1];
						const x = xOf(words[kept.from].start);
						return (
							<button
								key={i}
								onClick={() => setOpenGroup(openGroup === i ? null : i)}
								title={`This was said ${g.takes.length} times. Click to pick the take to keep.`}
								className={`absolute z-[1] flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full text-[11px] shadow ${
									openGroup === i ? "bg-amber-500 text-white" : "bg-amber-400 text-black hover:bg-amber-500"
								}`}
								style={{ left: Math.max(10, x), top: 1 }}
							>
								🔁
							</button>
						);
					})}
					<div ref={headRef} className="pointer-events-none absolute top-0 left-0 z-[2]" style={{ height: HEIGHT }}>
						<div className="absolute -left-[5px] top-0 h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-blue-600" />
						<div className="absolute -left-px top-0 h-full w-0.5 bg-blue-600" />
					</div>
				</div>
			</div>

			{group && openGroup !== null && (
				<div
					className="absolute bottom-full z-10 mb-2 w-[min(28rem,calc(100%-1rem))] rounded-lg border border-foreground/15 bg-background p-3 shadow-xl"
					style={{ left: Math.max(8, Math.min(viewWidth - 300, xOf(words[group.takes[0].from].start) - scrollLeft)) }}
				>
					<div className="mb-2 flex items-center gap-2">
						<p className="flex-1 text-sm font-medium">🔁 Said {group.takes.length} times. Which take do you keep?</p>
						<button onClick={() => setOpenGroup(null)} className="text-foreground/50 hover:text-foreground" aria-label="Close">
							✕
						</button>
					</div>
					<ul className="flex flex-col gap-1">
						{group.takes.map((t, k) => {
							const kept = isKept(t);
							return (
								<li key={k} className={`flex items-center gap-2 rounded-md p-1.5 text-sm ${kept ? "bg-emerald-500/15" : ""}`}>
									<button
										onClick={() => onListen(t.from, t.to)}
										className="shrink-0 rounded-full border border-foreground/20 px-2 py-0.5 text-xs hover:bg-foreground/5"
										title="Listen to this take"
									>
										▶
									</button>
									<span className="shrink-0 text-xs font-medium text-foreground/60">Take {k + 1}</span>
									<span className={`min-w-0 flex-1 truncate ${kept ? "" : "text-foreground/50"}`} title={textOf(t.from, t.to, 500)}>
										{textOf(t.from, t.to)}
									</span>
									{kept ? (
										<span className="shrink-0 text-xs font-medium text-emerald-700 dark:text-emerald-400">✓ Keeping</span>
									) : (
										<button
											onClick={() => onPickTake(group, k)}
											className="shrink-0 rounded-md bg-blue-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-blue-700"
										>
											Use this
										</button>
									)}
								</li>
							);
						})}
					</ul>
					<p className="mt-2 text-xs text-foreground/50">The takes you don&apos;t keep are cut. Ctrl+Z undoes.</p>
				</div>
			)}
		</div>
	);
}
