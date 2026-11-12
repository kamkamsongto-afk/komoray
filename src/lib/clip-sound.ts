// The sound of an uploaded clip (a Pic/Clip insert, a clip banner, a Frame Me clip background), under the speaker's own
// sound (coach, 12 Nov). volume: 0..1, 1 = as recorded; none = silent, which is how every clip was before, so videos
// saved before keep sounding the same. muted: Mute ticked, silent whatever the volume (it is kept for when Mute is untied).
// A new clip starts a little loud (CLIP_SOUND.start), so people hear that it plays (coach, 12 Nov).
// It fades in and out over CLIP_SOUND.fade at the clip's edges. Same as clip_sounds / mix_clip_sounds in render.py.
export const CLIP_SOUND = { max: 1, fade: 0.25, start: 0.2 };

export type ClipSoundSettings = { volume?: number; muted?: boolean };

// A new clip's sound: on, quietly. Nothing for a picture.
export const newClipSound = (media: string | undefined): ClipSoundSettings => (media === "video" ? { volume: CLIP_SOUND.start } : {});

// How loud it plays: none when muted.
export const soundOf = (c: ClipSoundSettings) => (c.muted ? undefined : c.volume);

export function readVolume(value: unknown): number | undefined {
	const n = Number(value);
	if (!Number.isFinite(n) || n <= 0) return undefined;
	return Math.round(Math.min(CLIP_SOUND.max, n) * 100) / 100;
}

// Volume and Mute as saved, for a clip (nothing for a picture).
export function readClipSound(raw: { volume?: unknown; muted?: unknown }, clip: boolean): ClipSoundSettings {
	if (!clip) return {};
	const volume = readVolume(raw.volume);
	return { ...(volume && { volume }), ...(raw.muted === true && { muted: true }) };
}

// How loud the clip is `at` seconds after it starts showing, for `length` seconds.
export function clipGain(volume: number | undefined, at: number, length: number) {
	if (!volume || at < 0 || at > length) return 0;
	return Math.max(0, Math.min(volume, (volume * at) / CLIP_SOUND.fade, (volume * (length - at)) / CLIP_SOUND.fade));
}
