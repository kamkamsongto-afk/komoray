// The sound of an uploaded clip (a Pic/Clip insert or a clip banner), under the speaker's own sound (coach, 12 Nov).
// volume: 0 = silent, which is how every clip was before, so videos saved before keep sounding the same; 1 = as recorded.
// It fades in and out over CLIP_SOUND.fade at the clip's edges. Same as clip_sounds / mix_clip_sounds in render.py.
export const CLIP_SOUND = { max: 1, fade: 0.25, on: 1 };

export function readVolume(value: unknown): number | undefined {
	const n = Number(value);
	if (!Number.isFinite(n) || n <= 0) return undefined;
	return Math.round(Math.min(CLIP_SOUND.max, n) * 100) / 100;
}

// How loud the clip is `at` seconds after it starts showing, for `length` seconds.
export function clipGain(volume: number | undefined, at: number, length: number) {
	if (!volume || at < 0 || at > length) return 0;
	return Math.max(0, Math.min(volume, (volume * at) / CLIP_SOUND.fade, (volume * (length - at)) / CLIP_SOUND.fade));
}
