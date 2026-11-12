"use client";

import { Volume2, VolumeX } from "lucide-react";
import { CLIP_SOUND } from "@/lib/clip-sound";

// Sound on/off and how loud, for an uploaded clip (lib/clip-sound.ts). undefined = off.
export function ClipSound({ volume, onChange }: { volume: number | undefined; onChange: (volume: number | undefined) => void }) {
	const on = !!volume;
	return (
		<div className="flex items-center gap-2 text-xs">
			<button
				onClick={() => onChange(on ? undefined : CLIP_SOUND.on)}
				aria-pressed={on}
				className={`flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 ${on ? "border-blue-600 bg-blue-600/10" : "border-foreground/20"}`}
			>
				{on ? <Volume2 className="h-3.5 w-3.5" aria-hidden /> : <VolumeX className="h-3.5 w-3.5" aria-hidden />}
				{on ? "Sound on" : "Sound off"}
			</button>
			<input
				type="range"
				min={0}
				max={CLIP_SOUND.max}
				step={0.05}
				value={volume ?? 0}
				onChange={(e) => onChange(Number(e.target.value) || undefined)}
				aria-label="Clip volume"
				className="min-w-0 flex-1"
			/>
			<span className="w-9 shrink-0 text-right tabular-nums text-foreground/60">{Math.round((volume ?? 0) * 100)}%</span>
		</div>
	);
}
