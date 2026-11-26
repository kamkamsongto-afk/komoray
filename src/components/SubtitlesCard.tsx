"use client";

import type { ReactNode } from "react";
import { LIMITS } from "@/lib/subtitle-style";
import { PLAIN_BUTTON, ToolGroup } from "./ToolGroup";

type Stretch = { start: number; end: number }; // seconds of the final video

// The subtitles' own height while one thing shows (ScriptView: placeStretch in lib/timeline.ts splits the subtitles at
// its two ends and moves that piece, so nobody has to). at: the height set there, or null = as the rest.
export type SubtitlesHere = {
	at: (item: Stretch) => number | null;
	normal: number;
	set: (item: Stretch, position: number | null) => void;
};

// The "Subtitles here" card, the same in the Layout, Frame Me, Cutout and Banners boxes (coach 20 and 26 Nov): what is
// shown often sits where the subtitles are. children: buttons of the box's own.
export function SubtitlesCard({ item, subtitles, tone, children }: { item: Stretch; subtitles: SubtitlesHere; tone: 1 | 2 | 3; children?: ReactNode }) {
	const own = subtitles.at(item);
	return (
		<ToolGroup tone={tone} title="Subtitles here">
			<label className="flex items-center gap-2 text-xs text-foreground/70">
				<span className="w-16 shrink-0">Height</span>
				<input type="range" min={LIMITS.position.min} max={LIMITS.position.max} step={0.01} value={own ?? subtitles.normal} onChange={(e) => subtitles.set(item, Math.round(Number(e.target.value) * 1000) / 1000)} className="min-w-0 flex-1 accent-blue-600" />
				<span className="w-12 tabular-nums">{own === null ? "As the rest" : `${Math.round(own * 100)}%`}</span>
			</label>
			<div className="flex flex-wrap gap-1" title="Only while this shows. Or pause on it and drag the subtitles. If you move it on the timeline later, set this again.">
				{children}
				{own !== null && (
					<button onClick={() => subtitles.set(item, null)} className={PLAIN_BUTTON}>
						Same as the rest
					</button>
				)}
			</div>
		</ToolGroup>
	);
}
