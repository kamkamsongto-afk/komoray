"use client";

import { useRef, useState } from "react";
import { clockText, readClock } from "@/lib/layers";

// The clock the timeline's ruler shows (coach, 17 Nov: the boxes showed seconds of the final video, "183.4", while
// the ruler with Show cuts on counts the whole upload, so the numbers never matched). Things are still saved in
// seconds of the final video: shown turns those into the ruler's clock, back turns a typed time into them.
export type Clock = { shown: (out: number) => number; back: (onRuler: number) => number };
export const FINAL_CLOCK: Clock = { shown: (t) => t, back: (t) => t };

// One time, written 1:05.3 and typed the same way (or plain seconds). Applied on Enter or when it loses focus.
export function TimeField({ value, onChange, clock, label }: { value: number; onChange: (out: number) => void; clock: Clock; label: string }) {
	const [typing, setTyping] = useState<string | null>(null);
	const cancelled = useRef(false);
	const apply = () => {
		if (typing === null || cancelled.current) {
			cancelled.current = false;
			setTyping(null);
			return;
		}
		const t = readClock(typing);
		setTyping(null);
		if (t !== null) onChange(Math.round(clock.back(t) * 10) / 10);
	};
	return (
		<input
			value={typing ?? clockText(clock.shown(value))}
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
			title="Minutes:seconds, the same clock as the timeline. Type a time and press Enter."
			className="w-[4.5rem] rounded border border-foreground/20 bg-background px-1 tabular-nums"
		/>
	);
}

// "Shows 1:05.3 to 1:08.3": a thing's start and end in its box (Cutout, Frame Me, Layout).
export function TimeRange({ start, end, total, clock, onChange }: { start: number; end: number; total: number; clock: Clock; onChange: (patch: { start?: number; end?: number }) => void }) {
	return (
		<span className="flex items-center gap-1">
			<TimeField value={start} clock={clock} label="Shows from" onChange={(t) => onChange({ start: Math.max(0, Math.min(t, end - 0.3)) })} />
			to
			<TimeField value={end} clock={clock} label="Shows to" onChange={(t) => onChange({ end: Math.min(total, Math.max(t, start + 0.3)) })} />
		</span>
	);
}

// The same for a line in a box's list: 1:05.3–1:08.3.
export const rangeText = (start: number, end: number, clock: Clock) => `${clockText(clock.shown(start))}–${clockText(clock.shown(end))}`;
