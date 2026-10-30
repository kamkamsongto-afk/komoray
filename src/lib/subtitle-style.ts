// How the subtitles look. Saved in edit.json as "style" and sent to Modal, which reads the same
// names (DEFAULT_STYLE in modal_app/render.py). Sizes are px on the 1080x1920 frame.
export type SubtitleStyle = { size: number; outline: number; position: number };

export const DEFAULT_STYLE: SubtitleStyle = { size: 100, outline: 10, position: 0.31 };

export const LIMITS = {
	size: { min: 50, max: 180, step: 2 },
	outline: { min: 0, max: 20, step: 1 },
	position: { min: 0.03, max: 0.85, step: 0.01 }, // 0 = bottom edge, 1 = top edge
} as const;

const clamp = (n: number, { min, max }: { min: number; max: number }) => Math.min(max, Math.max(min, n));

// Anything that isn't a sensible style falls back to the defaults, field by field.
export function readStyle(value: unknown): SubtitleStyle {
	const v = (value ?? {}) as Partial<Record<keyof SubtitleStyle, unknown>>;
	const pick = (k: keyof SubtitleStyle) => (typeof v[k] === "number" && Number.isFinite(v[k]) ? clamp(v[k] as number, LIMITS[k]) : DEFAULT_STYLE[k]);
	return { size: Math.round(pick("size")), outline: Math.round(pick("outline")), position: Math.round(pick("position") * 1000) / 1000 };
}
