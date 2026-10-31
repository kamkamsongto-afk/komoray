// How the subtitles look. Saved in edit.json as "style" and sent to Modal, which reads the same
// names (DEFAULT_STYLE, FONTS and LOOKS in modal_app/render.py). Sizes are px on the 1080x1920 frame.
export type Look = "clean" | "box" | "highlight" | "big" | "two";
export type FontId = "kanit" | "prompt" | "mitr" | "sarabun" | "chakra" | "poppins" | "anton" | "bebas";
export type LogoCorner = "top-left" | "top-right";
// color: the brand colour (the Highlight look's word). logo: the channel name shown in a corner ("" = none).
export type SubtitleStyle = {
	size: number;
	outline: number;
	position: number;
	look: Look;
	font: FontId;
	color: string;
	logo: string;
	logoAt: LogoCorner;
};

export const DEFAULT_STYLE: SubtitleStyle = {
	size: 100,
	outline: 10,
	position: 0.31,
	look: "clean",
	font: "kanit",
	color: "#FFE600",
	logo: "",
	logoAt: "top-left",
};

export const MAX_LOGO_LENGTH = 30;
// Brand colours to pick from in one click (any other colour works too).
export const COLORS = ["#FFE600", "#22D3EE", "#4ADE80", "#FB7185", "#F97316", "#A78BFA"];

export const LIMITS = {
	size: { min: 50, max: 180, step: 2 },
	outline: { min: 0, max: 20, step: 1 },
	position: { min: 0.03, max: 0.85, step: 0.01 }, // 0 = bottom edge, 1 = top edge
} as const;

// The five looks. Picking one also sets its size and height on screen (the user can change them after).
export const LOOKS: Record<Look, { name: string; hint: string; size: number; position: number }> = {
	clean: { name: "Clean", hint: "White letters, black outline", size: 100, position: 0.31 },
	box: { name: "Box", hint: "White letters on a dark box", size: 90, position: 0.31 },
	highlight: { name: "Highlight", hint: "The word being said turns yellow", size: 100, position: 0.31 },
	big: { name: "Big", hint: "A few big words in the middle", size: 150, position: 0.45 },
	two: { name: "Two lines", hint: "More words at once, in two rows", size: 90, position: 0.22 },
};

// Fonts drawn the same in the preview (next/font in PlayerFrame) and the final video (Modal).
// thai: has Thai letters. English-only fonts can't be picked for a Thai video.
export const FONTS: Record<FontId, { name: string; thai: boolean }> = {
	kanit: { name: "Kanit", thai: true },
	prompt: { name: "Prompt", thai: true },
	mitr: { name: "Mitr", thai: true },
	sarabun: { name: "Sarabun", thai: true },
	chakra: { name: "Chakra Petch", thai: true },
	poppins: { name: "Poppins", thai: false },
	anton: { name: "Anton", thai: false },
	bebas: { name: "Bebas Neue", thai: false },
};

const clamp = (n: number, { min, max }: { min: number; max: number }) => Math.min(max, Math.max(min, n));

// Anything that isn't a sensible style falls back to the defaults, field by field.
export function readStyle(value: unknown): SubtitleStyle {
	const v = (value ?? {}) as Partial<Record<keyof SubtitleStyle, unknown>>;
	const pick = (k: keyof typeof LIMITS) => (typeof v[k] === "number" && Number.isFinite(v[k]) ? clamp(v[k] as number, LIMITS[k]) : DEFAULT_STYLE[k]);
	return {
		size: Math.round(pick("size")),
		outline: Math.round(pick("outline")),
		position: Math.round(pick("position") * 1000) / 1000,
		look: typeof v.look === "string" && v.look in LOOKS ? (v.look as Look) : DEFAULT_STYLE.look,
		font: typeof v.font === "string" && v.font in FONTS ? (v.font as FontId) : DEFAULT_STYLE.font,
		color: typeof v.color === "string" && /^#[0-9a-f]{6}$/i.test(v.color) ? v.color.toUpperCase() : DEFAULT_STYLE.color,
		// Letters, numbers and simple marks only: it is drawn into the video as subtitle text.
		logo: typeof v.logo === "string" ? v.logo.replace(/[\\{}\n\r]/g, "").trim().slice(0, MAX_LOGO_LENGTH) : DEFAULT_STYLE.logo,
		logoAt: v.logoAt === "top-right" ? "top-right" : "top-left",
	};
}
