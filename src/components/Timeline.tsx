"use client";

import { type PointerEvent, type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TakeGroup } from "@/lib/takes";
import { FPS, type Segment, toOutSeconds, totalFrames } from "@/lib/timeline";
import { loadPeaks, PEAKS_PER_SECOND } from "@/lib/waveform";
import { ZOOM, zoomTrack } from "@/lib/zoom";

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
	onCut: (start: number, end: number) => void; // cut this stretch of the source by hand
	onKeep: (start: number, end: number) => void; // keep it (bring back what was cut there)
	onAuto: (start: number, end: number) => void; // forget the hand cuts and keeps there (back to the automatic cuts)
	handSpans: { start: number; end: number }[]; // where cuts were changed by hand (marked on the timeline)
	zoomMode: string; // Auto zoom: "off" hides the zoom strip
	noZoom: { start: number; end: number }[]; // parts with Auto zoom turned off
	onZoomRange: (start: number, end: number, on: boolean) => void;
	onPlayFrom: (source: number) => void; // play from here (to hear a cut edge just moved)
};

// Heights, px: time ruler, sentence chips, zoom strip, waveform.
const RULER = 22;
const CHIPS_TOP = RULER + 4;
const CHIPS = 26;
const ZOOM_TOP = CHIPS_TOP + CHIPS + 3;
const ZOOM_STRIP = 9;
const WAVE_TOP = ZOOM_TOP + ZOOM_STRIP + 3;
const WAVE = 58;
const HEIGHT = WAVE_TOP + WAVE + 4;

const CHIP_GAP = 0.7; // a pause this long (seconds) starts a new chip
const CHIP_MAX = 12; // a chip never covers more seconds than this
const MAX_PPS = 300; // most zoomed in: pixels per second
const START_PPS = 40;
const TICK_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const SHOW_CUTS = "komoray.timelineCuts"; // remembers the Show cuts switch in this browser
const DRAG_PX = 4; // the mouse has to move this far before a press becomes a drag (else it is a click)
const EDGE_PX = 6; // how close to a picked stretch's edge grabs the edge
const MIN_PICK = 0.05; // seconds

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
	onCut,
	onKeep,
	onAuto,
	handSpans,
	zoomMode,
	noZoom,
	onZoomRange,
	onPlayFrom,
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
	// The stretch picked by dragging, in source seconds: cut it or keep it.
	const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
	// A cut's edge being dragged (Show cuts on): which cut, which side, and where it is now.
	const [edge, setEdge] = useState<{ cut: [number, number]; side: "start" | "end"; to: number } | null>(null);
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
	const zoomOn = zoomMode !== "off";
	const zoomAt = useMemo(() => zoomTrack(segments, noZoom, zoomMode), [segments, noZoom, zoomMode]);
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
			// Cuts changed by hand: a thin amber bar along the bottom.
			ctx.fillStyle = "rgba(245, 158, 11, 0.9)";
			for (const h of handSpans) {
				const x0 = h.start * scale - left;
				const x1 = h.end * scale - left;
				if (x1 < 0 || x0 > w) continue;
				ctx.fillRect(x0, HEIGHT - 3, Math.max(2, x1 - x0), 3);
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

		// Zoom strip: purple as strong as the zoom at that moment, grey where zoom was turned off.
		if (zoomOn) {
			for (let px = 0; px < w; px++) {
				const t = timeAt(left + px);
				if (!segments.some((s) => t * FPS >= s.trim && t * FPS < s.trim + s.frames)) continue;
				if (noZoom.some((n) => t >= n.start && t < n.end)) ctx.fillStyle = "rgba(127, 127, 127, 0.4)";
				else ctx.fillStyle = `rgba(147, 51, 234, ${0.25 + (0.75 * (zoomAt(Math.round(toOutSeconds(t, segments) * FPS)) - 1)) / (ZOOM - 1)})`;
				ctx.fillRect(px, ZOOM_TOP, 1, ZOOM_STRIP);
			}
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
	}, [scale, showCuts, cutSpans, segments, peaks, timeAt, handSpans, zoomOn, zoomAt, noZoom]);

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

	// Pressing on the ruler moves the playhead (drag to scrub). Anywhere else: a click moves the
	// playhead (or, in a red cut, picks that cut), a drag picks a stretch, and an edge of the picked
	// stretch can be dragged to fine-tune it. A click on the zoom strip turns zoom off (or back on) for that piece.
	type Press = { kind: "scrub" | "pick" | "start" | "end" | "cut"; x: number; at: number; moved: boolean; cut?: [number, number]; side?: "start" | "end"; strip?: boolean };
	const press = useRef<Press | null>(null);
	const xAt = (clientX: number) => {
		const el = scrollRef.current;
		return el ? clientX - el.getBoundingClientRect().left + el.scrollLeft : 0;
	};
	const nearEdge = (x: number) =>
		!selection ? null : Math.abs(x - xOf(selection.start)) <= EDGE_PX ? "start" : Math.abs(x - xOf(selection.end)) <= EDGE_PX ? "end" : null;
	// The edge of a cut under x (Show cuts on): drag it to cut a little more or less than the automatic cut.
	const cutEdgeAt = (x: number) => {
		if (!showCuts) return null;
		for (const cut of cutSpans) {
			if (Math.abs(x - cut[0] * scale) <= EDGE_PX && cut[0] > 0) return { cut, side: "start" as const };
			if (Math.abs(x - cut[1] * scale) <= EDGE_PX && cut[1] < duration) return { cut, side: "end" as const };
		}
		return null;
	};
	const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
		if ((e.target as HTMLElement).closest("button")) return;
		const el = scrollRef.current;
		if (!el) return;
		follow.current = false;
		try {
			e.currentTarget.setPointerCapture(e.pointerId);
		} catch {
			// the pointer is already gone: the press still works while it stays over the timeline
		}
		const x = xAt(e.clientX);
		const y = e.clientY - el.getBoundingClientRect().top;
		const onRuler = y < RULER + 2;
		const grab = onRuler || nearEdge(x) ? null : cutEdgeAt(x);
		const kind = onRuler ? "scrub" : (nearEdge(x) ?? (grab ? "cut" : "pick"));
		press.current = { kind, x, at: timeAt(x), moved: false, cut: grab?.cut, side: grab?.side, strip: zoomOn && y >= ZOOM_TOP - 1 && y <= ZOOM_TOP + ZOOM_STRIP + 1 };
		if (kind === "scrub") onSeek(timeAt(x));
	};
	const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
		const p = press.current;
		const x = xAt(e.clientX);
		if (!p) {
			e.currentTarget.style.cursor = nearEdge(x) || cutEdgeAt(x) ? "ew-resize" : "";
			return;
		}
		if (!p.moved && Math.abs(x - p.x) < DRAG_PX) return;
		p.moved = true;
		const t = timeAt(x);
		if (p.kind === "scrub") onSeek(t);
		else if (p.kind === "cut" && p.cut && p.side) {
			// An edge never crosses the other edge of its cut.
			const to = p.side === "start" ? Math.min(t, p.cut[1] - MIN_PICK) : Math.max(t, p.cut[0] + MIN_PICK);
			setEdge({ cut: p.cut, side: p.side, to });
		} else if (p.kind === "pick") setSelection({ start: Math.min(p.at, t), end: Math.max(p.at, t) });
		else if (selection) {
			const other = p.kind === "start" ? selection.end : selection.start;
			setSelection({ start: Math.min(other, t), end: Math.max(other, t) });
		}
	};
	const onPointerUp = () => {
		const p = press.current;
		press.current = null;
		follow.current = true;
		if (!p) return;
		if (p.kind === "cut" && p.moved) {
			if (edge) moveEdge(edge);
			setEdge(null);
			return;
		}
		if (p.moved) return setSelection((s) => (s && s.end - s.start >= MIN_PICK ? s : null));
		if (p.kind === "scrub") return;
		const piece = p.strip && p.kind === "pick" ? segments.find((s) => p.at * FPS >= s.trim && p.at * FPS < s.trim + s.frames) : undefined;
		if (piece) return onZoomRange(piece.trim / FPS, (piece.trim + piece.frames) / FPS, noZoom.some((n) => p.at >= n.start && p.at < n.end));
		const cut = showCuts ? cutSpans.find(([a, b]) => p.at >= a && p.at < b) : undefined;
		if (cut) setSelection({ start: cut[0], end: cut[1] });
		else {
			setSelection(null);
			onSeek(p.at);
		}
	};

	// A cut edge let go: the stretch between where it was and where it is now is kept (cut shrunk)
	// or cut (cut grown). Then play across the new join, so it can be heard right away.
	const moveEdge = ({ cut: [a, b], side, to }: { cut: [number, number]; side: "start" | "end"; to: number }) => {
		const from = side === "start" ? a : b;
		if (Math.abs(to - from) < 0.01) return;
		const shrinks = side === "start" ? to > from : to < from;
		if (shrinks) onKeep(Math.min(from, to), Math.max(from, to));
		else onCut(Math.min(from, to), Math.max(from, to));
		onPlayFrom(Math.max(0, (side === "start" ? to : a) - 1.5));
	};

	// What the picked stretch holds: any of it still in the video? any of it cut?
	const picked = useMemo(() => {
		if (!selection) return null;
		const f0 = selection.start * FPS;
		const f1 = selection.end * FPS;
		let kept = 0;
		for (const s of segments) kept += Math.max(0, Math.min(f1, s.trim + s.frames) - Math.max(f0, s.trim));
		const hand = handSpans.some((h) => h.end > selection.start && h.start < selection.end);
		const zoomOff = noZoom.some((n) => n.end > selection.start && n.start < selection.end); // some of it has zoom off
		const zoomOffAll = noZoom.some((n) => n.start <= selection.start && n.end >= selection.end);
		return { kept: kept > 1, cut: f1 - f0 - kept > 1, hand, zoomOff, zoomOffAll, seconds: selection.end - selection.start };
	}, [selection, segments, handSpans, noZoom]);
	const cutPicked = useCallback(() => {
		if (!selection) return;
		onCut(selection.start, selection.end);
		setSelection(null);
	}, [selection, onCut]);
	const keepPicked = () => {
		if (!selection) return;
		onKeep(selection.start, selection.end);
		setSelection(null);
	};

	// Delete / Backspace cuts the picked stretch, Esc lets it go (not while typing or with script words highlighted).
	useEffect(() => {
		if (!selection) return;
		const onKey = (e: KeyboardEvent) => {
			if ((e.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable='true']")) return;
			if (e.key === "Escape") setSelection(null);
			else if ((e.key === "Delete" || e.key === "Backspace") && window.getSelection()?.isCollapsed !== false) {
				e.preventDefault();
				cutPicked();
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [selection, cutPicked]);

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
				{selection && picked ? (
					<span className="flex items-center gap-1.5">
						<span className="text-xs tabular-nums text-foreground/60">{picked.seconds.toFixed(1)}s picked</span>
						{picked.kept && (
							<button
								onClick={cutPicked}
								className="rounded-md bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700"
								title="Cut this part out of the video (Delete)"
							>
								✂️ Cut
							</button>
						)}
						{picked.cut && (
							<button
								onClick={keepPicked}
								className="rounded-md border border-foreground/25 px-2 py-0.5 text-xs font-medium hover:bg-foreground/5"
								title="Put this part back in the video"
							>
								↩️ Keep
							</button>
						)}
						{picked.hand && (
							<button
								onClick={() => {
									onAuto(selection.start, selection.end);
									setSelection(null);
								}}
								className="rounded-md border border-foreground/25 px-2 py-0.5 text-xs font-medium hover:bg-foreground/5"
								title="Undo the hand changes here and go back to the automatic cuts"
							>
								↺ Auto
							</button>
						)}
						{zoomOn && picked.kept && !picked.zoomOffAll && (
							<button
								onClick={() => {
									onZoomRange(selection.start, selection.end, false);
									setSelection(null);
								}}
								className="rounded-md border border-foreground/25 px-2 py-0.5 text-xs font-medium hover:bg-foreground/5"
								title="No Auto zoom in this part"
							>
								🚫 No zoom
							</button>
						)}
						{zoomOn && picked.zoomOff && (
							<button
								onClick={() => {
									onZoomRange(selection.start, selection.end, true);
									setSelection(null);
								}}
								className="rounded-md bg-purple-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-purple-700"
								title="Auto zoom again in this part"
							>
								🔍 Zoom
							</button>
						)}
						<button onClick={() => setSelection(null)} className="px-1 text-foreground/50 hover:text-foreground" aria-label="Clear the selection" title="Esc">
							✕
						</button>
					</span>
				) : (
					<span className="text-xs text-foreground/50" title="Drag across the timeline to cut or keep any part. Drag the edge of a red cut to cut a little more or less (to keep the end of a word). Click a red cut to pick it.">
						{cutSpans.length} cuts
						{groups.length > 0 && ` · 🔁 ${groups.length} repeated ${groups.length === 1 ? "take" : "takes"}`}
						<span className="hidden sm:inline"> · drag across to cut · drag a red edge to fine-tune{zoomOn && " · click the purple strip for no zoom there"}</span>
					</span>
				)}
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
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerUp}
				onDoubleClick={(e) => {
					// Double-click a sentence to pick it.
					const t = timeAt(xAt(e.clientX));
					const chip = chips.find((c) => t >= c.start && t <= c.end && (showCuts || !c.gone));
					if (chip) setSelection({ start: chip.start, end: chip.end });
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
					{edge && (
						<div
							className={`pointer-events-none absolute z-[1] border-blue-600 ${
								(edge.side === "start" ? edge.to > edge.cut[0] : edge.to < edge.cut[1]) ? "bg-emerald-500/30" : "bg-red-500/35"
							} ${edge.side === "start" ? "border-l-2" : "border-r-2"}`}
							style={{
								left: Math.min(edge.to, edge.side === "start" ? edge.cut[0] : edge.cut[1]) * scale,
								width: Math.max(2, Math.abs(edge.to - (edge.side === "start" ? edge.cut[0] : edge.cut[1])) * scale),
								top: CHIPS_TOP - 3,
								height: HEIGHT - CHIPS_TOP + 3,
							}}
						/>
					)}
					{selection && (
						<div
							className="pointer-events-none absolute z-[1] rounded-sm border-x-2 border-blue-600 bg-blue-500/20"
							style={{
								left: xOf(selection.start),
								width: Math.max(2, xOf(selection.end) - xOf(selection.start)),
								top: CHIPS_TOP - 3,
								height: HEIGHT - CHIPS_TOP + 3,
							}}
						/>
					)}
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
