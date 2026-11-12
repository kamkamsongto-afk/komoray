"use client";

import { CLIP_SOUND, type ClipSoundSettings } from "@/lib/clip-sound";

// Mute and how loud, for an uploaded clip (lib/clip-sound.ts). The same in Pic/Clip, Banners and Frame Me (coach, 12 Nov).
// Mute keeps the volume, so untying it brings back the same level.
export function ClipSound({ sound, onChange }: { sound: ClipSoundSettings; onChange: (patch: ClipSoundSettings) => void }) {
	const muted = !!sound.muted;
	const volume = sound.volume ?? 0;
	return (
		<div className="flex min-w-0 flex-1 items-center gap-2 text-xs">
			<label className="flex shrink-0 cursor-pointer items-center gap-1">
				<input
					type="checkbox"
					checked={muted}
					// Untied on a clip that was silent before: back to a quiet level, or nothing would be heard.
					onChange={(e) => onChange(e.target.checked ? { muted: true } : { muted: undefined, volume: volume || CLIP_SOUND.start })}
					className="accent-blue-600"
				/>
				Mute
			</label>
			<input
				type="range"
				min={0}
				max={CLIP_SOUND.max}
				step={0.05}
				value={volume}
				disabled={muted}
				onChange={(e) => onChange({ volume: Number(e.target.value) || undefined })}
				aria-label="Clip volume"
				className="min-w-0 flex-1 accent-blue-600 disabled:opacity-40"
			/>
			<span className="w-9 shrink-0 text-right tabular-nums text-foreground/60">{muted ? "Off" : `${Math.round(volume * 100)}%`}</span>
		</div>
	);
}
