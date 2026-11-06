// What the creator asks Komoray to do with a new video, picked in the window that opens when they drop it
// (components/UploadOptions.tsx). Sent with Find silences, kept in analyze.json, copied into edit.json by the
// callback, and used once when the editor first opens the video. Everything can still be changed in the editor.
//   silences   cut the pauses (off: no cuts; Pace in the editor finds them later)
//   badTakes   Claude reads the script and cuts what it thinks were bad takes (lib/bad-takes.ts)
//   zoom       Auto zoom on (the Brand Kit's kind, else "in") or off
//   subtitles  subtitles drawn on the video, or none
export type UploadOptions = { silences: boolean; badTakes: boolean; zoom: boolean; subtitles: boolean };

export const DEFAULT_OPTIONS: UploadOptions = { silences: true, badTakes: true, zoom: true, subtitles: true };

// Anything that isn't a yes or no takes the default, field by field.
export function readOptions(value: unknown): UploadOptions | null {
	if (!value || typeof value !== "object") return null;
	const v = value as Partial<Record<keyof UploadOptions, unknown>>;
	const pick = (k: keyof UploadOptions) => (typeof v[k] === "boolean" ? (v[k] as boolean) : DEFAULT_OPTIONS[k]);
	return { silences: pick("silences"), badTakes: pick("badTakes"), zoom: pick("zoom"), subtitles: pick("subtitles") };
}
