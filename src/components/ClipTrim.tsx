"use client";

import { Film } from "lucide-react";
import { useContext } from "react";
import { CLIP_LAST, useClipLengths } from "@/lib/clip-length";
import { CLIP_TRIM } from "@/lib/clip-sound";
import { FINAL_CLOCK, RowFit, TimeField } from "./TimeField";

const CLIP_HINT = "Seconds of the clip itself (0.00 is its first picture). Type them (11.25) and press Enter, or drag the < >.";

// "Trim (clip)" (coach 19 Nov): which part of an uploaded clip plays, in the clip's own seconds (11.25, two decimals),
// e.g. 11.00 to 40.00 of a one-minute clip. Its own box with a bar of the whole clip, so it is never taken for
// "Start - End (on timeline)", which says where on the video it shows. Each number moves its own edge of the strip,
// as dragging that edge on the timeline does (Timeline.tsx, startItemDrag; coach 19 Nov: "from" moving the right
// edge was confusing): "from" moves the start edge (what stays keeps its place), "to" moves the end edge.
// clipFrom: lib/clip-sound.ts.
export function ClipTrim({ id, file, start, end, clipFrom, total, onChange }: { id: string; file: string; start: number; end: number; clipFrom?: number; total: number; onChange: (patch: { start?: number; clipFrom?: number; end?: number }) => void }) {
	const fit = useContext(RowFit);
	const length = useClipLengths([file])[file] as number | undefined;
	const from = clipFrom ?? 0;
	const to = from + (end - start);
	const round = (n: number) => Math.round(n * 100) / 100;
	// The row's limit (fitInRow) only where a strip is in the way: it rounds to tenths, and Trim keeps hundredths.
	const limit = (want: number, fitted: number | undefined) => (fitted === undefined || Math.abs(fitted - want) <= 0.05 ? want : fitted);
	// A new end on the video, kept out of the next strip in its row and within the video.
	const endAt = (want: number) => {
		const e = Math.min(total, Math.max(start + CLIP_TRIM.min, want));
		return round(fit ? limit(e, fit(id, { start, end }, { end: e }).end) : e);
	};
	const setFrom = (f: number) => {
		// Never at or past the clip's end, even on a clip shown longer than it lasts (agent review 19 Nov), never before
		// the video's start, and never over the strip before it in its row.
		const want = Math.max(0, Math.min(f, to - CLIP_TRIM.min, length !== undefined ? length - CLIP_LAST : Infinity));
		const wantStart = Math.max(0, start + want - from);
		const fitted = fit ? limit(wantStart, fit(id, { start, end }, { start: wantStart }).start) : wantStart;
		const next = round(Math.max(0, from + fitted - start));
		onChange({ start: round(start + next - from), clipFrom: next || undefined });
	};
	const setTo = (t: number) => onChange({ end: endAt(start + Math.min(t, length ?? Infinity) - from) });
	const held = length !== undefined && to > length + 0.05; // shown longer than it lasts (before Trim): its last picture holds
	const share = (s: number) => `${Math.max(0, Math.min(100, (s / (length || 1)) * 100))}%`;
	return (
		<div className="flex flex-col gap-1 rounded-md border border-orange-500/40 bg-orange-500/5 p-1.5 text-xs text-foreground/70">
			<div className="flex items-center gap-1.5">
				<Film className="h-3.5 w-3.5 text-orange-600" aria-hidden />
				<span className="font-medium text-foreground">Trim (clip)</span>
				<span className="ml-auto tabular-nums text-foreground/50">
					uses {(to - from).toFixed(2)} s{length ? ` of ${length.toFixed(2)} s` : ""}
				</span>
			</div>
			{length !== undefined && (
				<div className="relative h-2 rounded-full bg-foreground/10" title="The whole clip: the dark part plays" aria-hidden>
					<div className="absolute inset-y-0 rounded-full bg-orange-500" style={{ left: share(from), width: `calc(${share(Math.min(to, length))} - ${share(from)})` }} />
				</div>
			)}
			<span className="flex items-center gap-1">
				<TimeField value={from} clock={FINAL_CLOCK} label="Clip from" hint={CLIP_HINT} seconds onChange={setFrom} />
				to
				<TimeField value={to} clock={FINAL_CLOCK} label="Clip to" hint={CLIP_HINT} seconds onChange={setTo} />
				<span className="text-foreground/50">s</span>
			</span>
			{held && <p className="text-[11px] text-foreground/50">The clip ends at {length.toFixed(2)} s: its last picture stays after that.</p>}
		</div>
	);
}
