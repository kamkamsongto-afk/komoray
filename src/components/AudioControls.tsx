"use client";

import { AudioLines } from "lucide-react";
import { LIMITS, type SubtitleStyle } from "@/lib/subtitle-style";

// One switch and one bar, on purpose: left is the sound as recorded, right is the fully optimized sound
// (the coach, 9 Nov: quick and simple, no panel full of audio settings). What it does: polish_sound in render.py.
export function AudioControls({ style, onChange }: { style: SubtitleStyle; onChange: (style: SubtitleStyle) => void }) {
	const { audio, audioAmount } = style;
	return (
		<div className="flex items-center gap-3 rounded-lg border border-foreground/10 px-3 py-1.5">
			<button
				type="button"
				role="switch"
				aria-checked={audio}
				onClick={() => onChange({ ...style, audio: !audio })}
				title={audio ? "Audio optimization is on. Click to keep the sound as recorded" : "Audio optimization is off. Click to turn it on"}
				className="flex shrink-0 items-center gap-2 text-xs font-medium"
			>
				<AudioLines className={`h-4 w-4 ${audio ? "text-blue-500" : "text-foreground/40"}`} aria-hidden />
				<span className="hidden sm:inline">Audio</span>
				<span className={`relative h-4 w-7 rounded-full transition-colors ${audio ? "bg-blue-600" : "bg-foreground/25"}`}>
					<span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${audio ? "left-3.5" : "left-0.5"}`} />
				</span>
			</button>
			<div className={`flex min-w-0 flex-1 items-center gap-2 text-[11px] ${audio ? "text-foreground/70" : "text-foreground/30"}`}>
				<span className="shrink-0">Original</span>
				<input
					type="range"
					min={LIMITS.audioAmount.min}
					max={LIMITS.audioAmount.max}
					step={LIMITS.audioAmount.step}
					value={audioAmount}
					disabled={!audio}
					onChange={(e) => onChange({ ...style, audioAmount: Number(e.target.value) })}
					aria-label="How much to optimize the sound: left is as recorded, right is the clearest"
					className="h-4 min-w-0 flex-1 accent-blue-600 disabled:cursor-not-allowed"
				/>
				<span className="shrink-0">Optimized</span>
			</div>
		</div>
	);
}
