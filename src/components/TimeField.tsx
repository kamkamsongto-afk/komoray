"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { createContext, type PointerEvent, useContext, useRef, useState } from "react";
import { clockText, readClock as readTimelineClock } from "@/lib/layers";

// The clock the timeline's ruler shows (coach, 17 Nov: the boxes showed seconds of the final video, "183.4", while
// the ruler with Show cuts on counts the whole upload, so the numbers never matched). Things are still saved in
// seconds of the final video: shown turns those into the ruler's clock, back turns a typed time into them.
export type Clock = { shown: (out: number) => number; back: (onRuler: number) => number };
export const FINAL_CLOCK: Clock = { shown: (t) => t, back: (t) => t };
const NUDGE_DRAG_PX = 3; // a press on < or > that moves this far is a drag, not a click
const NUDGE_SECONDS_PER_PX = 0.04; // dragging: 25 px a second

// One time, written 1:05.3 and typed the same way (or plain seconds). Applied on Enter or when it loses focus.
// hint: what the box's tip says instead (Trim counts the clip's own seconds, not the timeline's).
// seconds: shown and typed as plain seconds with two decimals, 11.25 (Trim, coach 19 Nov: easier than 0:11.3).
export function TimeField({ value, onChange, clock, label, hint, seconds = false }: { value: number; onChange: (out: number) => void; clock: Clock; label: string; hint?: string; seconds?: boolean }) {
	const [typing, setTyping] = useState<string | null>(null);
	const cancelled = useRef(false);
	const steps = seconds ? 100 : 10; // kept to hundredths or tenths of a second
	const readClock = (text: string) => {
		if (!seconds) return readTimelineClock(text);
		const n = Number(text.trim().replace(/,/g, "."));
		return Number.isFinite(n) && n >= 0 ? n : null;
	};
	const apply = () => {
		if (typing === null || cancelled.current) {
			cancelled.current = false;
			setTyping(null);
			return;
		}
		const t = readClock(typing);
		setTyping(null);
		if (t !== null) onChange(Math.round(clock.back(t) * steps) / steps);
	};
	// The < and > beside it (coach, 17 Nov): a click moves it a tenth of a second; held and dragged left or right, it
	// moves with the mouse, so the strip grows or shrinks bit by bit. In seconds of the final video, so it never
	// jumps over a cut the way a typed time on the Show cuts clock can.
	const nudge = (e: PointerEvent<HTMLButtonElement>, step: number) => {
		e.preventDefault();
		const from = { x: e.clientX, value };
		let dragged = false;
		const move = (ev: globalThis.PointerEvent) => {
			const dx = ev.clientX - from.x;
			if (!dragged && Math.abs(dx) < NUDGE_DRAG_PX) return;
			dragged = true;
			onChange(Math.max(0, Math.round((from.value + dx * NUDGE_SECONDS_PER_PX) * steps) / steps));
		};
		const stop = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", stop);
			window.removeEventListener("pointercancel", stop);
			if (!dragged) onChange(Math.max(0, Math.round((from.value + step) * steps) / steps));
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", stop);
		window.addEventListener("pointercancel", stop);
	};
	const arrow = (step: number) => (
		<button
			type="button"
			onPointerDown={(e) => nudge(e, step)}
			aria-label={`${label}: ${step < 0 ? "earlier" : "later"} by a tenth of a second`}
			title="Click: a tenth of a second. Hold and drag left or right to move it further."
			className="flex h-5 w-4 cursor-ew-resize touch-none items-center justify-center rounded text-foreground/60 hover:bg-foreground/10 hover:text-foreground"
		>
			{step < 0 ? <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
		</button>
	);
	return (
		<span className="inline-flex items-center">
			<input
				value={typing ?? (seconds ? value.toFixed(2) : clockText(clock.shown(value)))}
				onFocus={(e) => {
					setTyping(e.currentTarget.value);
					e.currentTarget.select();
				}}
				onChange={(e) => setTyping(e.target.value)}
				onBlur={apply}
				onKeyDown={(e) => {
					if (e.key === "Enter") e.currentTarget.blur();
					if (e.key === "Escape") {
						cancelled.current = true; // back to what it was
						e.currentTarget.blur();
					}
				}}
				inputMode="decimal"
				aria-label={label}
				title={hint ?? "Minutes:seconds, the same clock as the timeline. Type a time (1:05.3 or 1.05.3) and press Enter."}
				className="w-[4.5rem] rounded border border-foreground/20 bg-background px-1 tabular-nums"
			/>
			{arrow(-0.1)}
			{arrow(0.1)}
		</span>
	);
}

// Keeps a typed or nudged time out of the next strip in the same timeline row (coach, 17 Nov: it stops right at
// that strip, which never moves). Given by ScriptView from the timeline's rows (lib/lane-rows.ts fitInRow).
type Fit = (id: string, was: { start: number; end: number }, want: { start?: number; end?: number }) => { start?: number; end?: number };
export const RowFit = createContext<Fit | null>(null);

// "Shows 1:05.3 to 1:08.3": a thing's start and end in its box (Cutout, Frame Me, Layout).
export function TimeRange({ id, start, end, total, clock, onChange }: { id: string; start: number; end: number; total: number; clock: Clock; onChange: (patch: { start?: number; end?: number }) => void }) {
	const fit = useContext(RowFit);
	const set = (want: { start?: number; end?: number }) => onChange(fit ? fit(id, { start, end }, want) : want);
	return (
		<span className="flex items-center gap-1">
			<TimeField value={start} clock={clock} label="Shows from" onChange={(t) => set({ start: Math.max(0, Math.min(t, end - 0.3)) })} />
			to
			<TimeField value={end} clock={clock} label="Shows to" onChange={(t) => set({ end: Math.min(total, Math.max(t, start + 0.3)) })} />
		</span>
	);
}

// The label of a box's TimeRange row (coach 19 Nov): where on the video it shows, never taken for Trim (clip).
export const ON_TIMELINE = (
	<span className="leading-tight">
		Start - End <span className="block text-[10px] text-foreground/45">(on timeline)</span>
	</span>
);

// The same for a line in a box's list: 1:05.3–1:08.3.
export const rangeText = (start: number, end: number, clock: Clock) => `${clockText(clock.shown(start))}–${clockText(clock.shown(end))}`;
