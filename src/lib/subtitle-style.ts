// How the subtitles look. Saved in edit.json as "style" and sent to Modal, which reads the same
// names (DEFAULT_STYLE, FONTS and LOOKS in modal_app/render.py). Sizes are px on the 1080x1920 frame.
export type Look = "clean" | "box" | "highlight" | "big" | "two";
export type FontId = "kanit" | "prompt" | "mitr" | "sarabun" | "chakra" | "poppins" | "anton" | "bebas" | "itim" | "sriracha" | "pattaya" | "chonburi" | "charm" | "mali" | "baijam" | "k2d" | "krub" | "kodchasan" | "trirong" | "maitree" | "bangers" | "pacifico" | "lobster" | "abril" | "alfaslab" | "righteous" | "archivo" | "titan";
import type { OwnFont } from "./font-info";
import { type Motion, MOTIONS } from "./motion";

export type LogoCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export const LOGO_CORNERS: Record<LogoCorner, string> = { "top-left": "Top left", "top-right": "Top right", "bottom-left": "Bottom left", "bottom-right": "Bottom right" };
export type Zoom = "off" | "in" | "out" | "smooth" | "cuts"; // Auto zoom (lib/zoom.ts): closer or further across the whole video, a slow glide in and out, or a jump at every other cut
// The final video's shape. Same as FORMATS in render.py.
export type Format = "9:16" | "1:1" | "16:9";
// position: where subtitles go when this shape is picked (wide videos keep them near the bottom).
// for: shown when the mouse is over the shape's picture (web only).
export const FORMATS: Record<Format, { for: string; width: number; height: number; position: number }> = {
	"9:16": { for: "TikTok, Reels, Shorts", width: 1080, height: 1920, position: 0.31 },
	"1:1": { for: "Instagram posts", width: 1080, height: 1080, position: 0.2 },
	"16:9": { for: "YouTube", width: 1920, height: 1080, position: 0.12 },
};
export const outputSize = (style: { format?: Format }) => FORMATS[style.format ?? "9:16"] ?? FORMATS["9:16"];
// color: the brand colour (the Highlight look's word). logo: the channel name shown in a corner ("" = none).
// logoImage: the user's logo picture (lib/logo.ts) shown in that corner instead of the name, logoSize px
// wide, logoOpacity 0..1.
export type SubtitleStyle = {
	size: number;
	outline: number;
	position: number;
	look: Look;
	font: FontId | "own"; // "own": the font the user uploaded (ownFont)
	ownFont?: OwnFont;
	textColor: string; // the letters
	outlineColor: string; // the border around the letters
	boxColor: string; // the Box look's box
	boxRadius: number; // how round its corners are, px
	boxOpacity: number; // how solid it is, 0.05..1
	letterSpacing: number; // px between letters
	lineSpacing: number; // px added between the rows of the Two lines look
	color: string;
	logo: string;
	logoAt: LogoCorner;
	logoImage?: { version: number };
	logoSize: number;
	logoOpacity: number;
	zoom: Zoom;
	zoomAmount: number; // how close it gets: 1.12 = 12% bigger
	zoomPeriod: number; // Smooth: seconds to glide in and back out
	format: Format;
	motion: Motion; // lines pop in, words bounce (lib/motion.ts)
	subtitles: boolean; // false: no subtitles on the video (banners and the logo stay)
	audio: boolean; // Audio optimization on or off (false: the sound stays as recorded)
	audioAmount: number; // 0 = as recorded .. 1 = fully optimized
	// This video only, never in the Brand Kit. Seconds of the original video, so they survive new cuts.
	splits?: number[]; // where Split divided the sound and the words into pieces
	spots?: SubtitleSpot[]; // pieces whose subtitles were moved on their own
};

export type SubtitleSpot = { start: number; end: number; position: number };
const MAX_SPLITS = 200;
function readSplits(value: unknown) {
	if (!Array.isArray(value)) return [];
	const times = value.filter((t): t is number => typeof t === "number" && Number.isFinite(t) && t >= 0).map((t) => Math.round(t * 1000) / 1000);
	return [...new Set(times)].sort((a, b) => a - b).slice(0, MAX_SPLITS);
}
function readSpots(value: unknown): SubtitleSpot[] {
	if (!Array.isArray(value)) return [];
	const spots: SubtitleSpot[] = [];
	for (const s of value.slice(0, MAX_SPLITS) as Partial<SubtitleSpot>[]) {
		const { start, end, position } = s ?? {};
		if (typeof start !== "number" || typeof end !== "number" || typeof position !== "number" || !Number.isFinite(start + end + position) || start < 0 || end <= start) continue;
		spots.push({ start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000, position: Math.round(Math.min(LIMITS.position.max, Math.max(LIMITS.position.min, position)) * 1000) / 1000 });
	}
	return spots;
}

export const DEFAULT_STYLE: SubtitleStyle = {
	size: 100,
	outline: 10,
	position: 0.31,
	look: "clean",
	font: "kanit",
	textColor: "#FFFFFF",
	outlineColor: "#000000",
	boxColor: "#000000",
	boxRadius: 0,
	boxOpacity: 0.75,
	letterSpacing: 0,
	lineSpacing: 0,
	color: "#FFE600",
	logo: "",
	logoAt: "top-left",
	logoSize: 180,
	logoOpacity: 1,
	zoom: "in",
	zoomAmount: 1.12,
	zoomPeriod: 12,
	format: "9:16",
	motion: "none",
	subtitles: true,
	audio: true,
	audioAmount: 1,
};

export const MAX_LOGO_LENGTH = 30;
// Brand colours to pick from in one click (any other colour works too).
// Four quick colours in every menu, then the rectangle for any other (coach, 10 Nov).
export const COLORS = ["#FFE600", "#22D3EE", "#4ADE80", "#FB7185"];
export const TEXT_COLORS = ["#FFFFFF", "#111111", "#FFE600", "#22D3EE"];
export const EDGE_COLORS = ["#000000", "#FFFFFF", "#FFE600", "#22D3EE"]; // the outline and the Box look's box

export const LIMITS = {
	size: { min: 50, max: 180, step: 2 },
	outline: { min: 0, max: 20, step: 1 },
	position: { min: 0.03, max: 0.85, step: 0.01 }, // 0 = bottom edge, 1 = top edge
	logoSize: { min: 60, max: 480, step: 10 },
	logoOpacity: { min: 0.2, max: 1, step: 0.05 },
	zoomAmount: { min: 1.04, max: 1.3, step: 0.01 },
	zoomPeriod: { min: 6, max: 24, step: 1 },
	letterSpacing: { min: 0, max: 30, step: 1 },
	lineSpacing: { min: -40, max: 80, step: 2 }, // below 0: the two rows closer than usual
	boxRadius: { min: 0, max: 60, step: 2 },
	boxOpacity: { min: 0.05, max: 1, step: 0.05 },
	audioAmount: { min: 0, max: 1, step: 0.05 },
} as const;

// The Smooth zoom speeds to pick from: seconds to glide in and back out.
export const ZOOM_SPEEDS = [
	{ name: "Slow", period: 18 },
	{ name: "Normal", period: 12 },
	{ name: "Fast", period: 7 },
];

// The five looks. Picking one also sets its size and height on screen (the user can change them after).
export const LOOKS: Record<Look, { name: string; hint: string; size: number; position: number }> = {
	clean: { name: "Clean", hint: "A few words at a time, in the lower part of the video", size: 100, position: 0.31 },
	box: { name: "Box", hint: "Letters on a colored box, easy to read on any picture", size: 90, position: 0.31 },
	highlight: { name: "Highlight", hint: "The word being said changes colour", size: 100, position: 0.31 },
	big: { name: "Big", hint: "Extra large, one or two words at a time, in the middle of the video", size: 170, position: 0.45 },
	two: { name: "Two lines", hint: "More words at once, in two rows", size: 90, position: 0.22 },
};

// Fonts drawn the same in the preview (next/font in PlayerFrame) and the final video (Modal).
// thai: has Thai letters. English-only fonts can't be picked for a Thai video.
// height: the font's full height (usWinAscent + usWinDescent) in ems. The final video's subtitle
// renderer (libass) makes that whole height the font size, browsers make 1 em the font size, so the
// preview draws letters at size / height to match (read from the font files with fontTools).
export const FONTS: Record<FontId, { name: string; thai: boolean; height: number }> = {
	kanit: { name: "Kanit", thai: true, height: 1.58 },
	prompt: { name: "Prompt", thai: true, height: 1.512 },
	mitr: { name: "Mitr", thai: true, height: 1.57 },
	sarabun: { name: "Sarabun", thai: true, height: 1.853 },
	chakra: { name: "Chakra Petch", thai: true, height: 1.814 },
	poppins: { name: "Poppins", thai: false, height: 1.762 },
	anton: { name: "Anton", thai: false, height: 1.733 },
	bebas: { name: "Bebas Neue", thai: false, height: 1.3 },
	itim: { name: "Itim", thai: true, height: 1.2 },
	sriracha: { name: "Sriracha", thai: true, height: 1.77 },
	pattaya: { name: "Pattaya", thai: true, height: 1.388 },
	chonburi: { name: "Chonburi", thai: true, height: 1.2 },
	charm: { name: "Charm", thai: true, height: 2.353 },
	mali: { name: "Mali", thai: true, height: 2.122 },
	baijam: { name: "Bai Jamjuree", thai: true, height: 1.786 },
	k2d: { name: "K2D", thai: true, height: 1.916 },
	krub: { name: "Krub", thai: true, height: 1.739 },
	kodchasan: { name: "Kodchasan", thai: true, height: 1.788 },
	trirong: { name: "Trirong", thai: true, height: 1.734 },
	maitree: { name: "Maitree", thai: true, height: 1.65 },
	bangers: { name: "Bangers", thai: false, height: 1.757 },
	pacifico: { name: "Pacifico", thai: false, height: 1.935 },
	lobster: { name: "Lobster", thai: false, height: 1.49 },
	abril: { name: "Abril Fatface", thai: false, height: 1.349 },
	alfaslab: { name: "Alfa Slab One", thai: false, height: 1.565 },
	righteous: { name: "Righteous", thai: false, height: 1.242 },
	archivo: { name: "Archivo Black", thai: false, height: 1.347 },
	titan: { name: "Titan One", thai: false, height: 1.145 },
};

// None of FONTS has Russian-style letters, so text with them is drawn in this one instead of a system
// font picked by chance (too big, words nearly touching). Its letters are drawn as big as Kanit's, so
// it counts as Kanit's height here; render.py shrinks it to match (CYRILLIC_SCALE).
export const CYRILLIC_FONT = { name: "Fira Sans", height: FONTS.kanit.height };
export const hasCyrillic = (text: string) => /[Ѐ-ԯ]/.test(text);

const clamp = (n: number, { min, max }: { min: number; max: number }) => Math.min(max, Math.max(min, n));

// One of our fonts, or the user's own with its name and height; anything else is Kanit.
export function readFont(font: unknown, own: unknown): Pick<SubtitleStyle, "font" | "ownFont"> {
	if (typeof font === "string" && font in FONTS) return { font: font as FontId };
	const o = (own ?? {}) as Partial<OwnFont>;
	if (font === "own" && typeof o.family === "string" && o.family.trim() && Number(o.height) > 0.5 && Number(o.height) < 4) {
		return { font: "own", ownFont: { family: o.family.replace(/[\\{},\n\r]/g, "").trim().slice(0, 60), height: Number(o.height), version: Number(o.version) || 0 } };
	}
	return { font: DEFAULT_STYLE.font };
}

// The height (see FONTS) and whether it has Thai letters, for any font a style can name.
export function fontMetrics(style: Pick<SubtitleStyle, "font" | "ownFont">) {
	if (style.font === "own") return { height: style.ownFont?.height ?? FONTS.kanit.height, thai: true };
	return FONTS[style.font] ?? FONTS.kanit;
}

// Anything that isn't a sensible style falls back to the defaults, field by field.
export function readStyle(value: unknown): SubtitleStyle {
	const v = (value ?? {}) as Partial<Record<keyof SubtitleStyle, unknown>>;
	const pick = (k: keyof typeof LIMITS) => (typeof v[k] === "number" && Number.isFinite(v[k]) ? clamp(v[k] as number, LIMITS[k]) : DEFAULT_STYLE[k]);
	const splits = readSplits(v.splits);
	const spots = readSpots(v.spots);
	return {
		...(splits.length && { splits }),
		...(spots.length && { spots }),
		size: Math.round(pick("size")),
		logoSize: Math.round(pick("logoSize")),
		logoOpacity: Math.round(pick("logoOpacity") * 100) / 100,
		...(typeof (v.logoImage as { version?: unknown })?.version === "number" && { logoImage: { version: (v.logoImage as { version: number }).version } }),
		outline: Math.round(pick("outline")),
		position: Math.round(pick("position") * 1000) / 1000,
		look: typeof v.look === "string" && v.look in LOOKS ? (v.look as Look) : DEFAULT_STYLE.look,
		...readFont(v.font, v.ownFont),
		color: typeof v.color === "string" && /^#[0-9a-f]{6}$/i.test(v.color) ? v.color.toUpperCase() : DEFAULT_STYLE.color,
		textColor: typeof v.textColor === "string" && /^#[0-9a-f]{6}$/i.test(v.textColor) ? v.textColor.toUpperCase() : DEFAULT_STYLE.textColor,
		outlineColor: typeof v.outlineColor === "string" && /^#[0-9a-f]{6}$/i.test(v.outlineColor) ? v.outlineColor.toUpperCase() : DEFAULT_STYLE.outlineColor,
		boxColor: typeof v.boxColor === "string" && /^#[0-9a-f]{6}$/i.test(v.boxColor) ? v.boxColor.toUpperCase() : DEFAULT_STYLE.boxColor,
		letterSpacing: Math.round(pick("letterSpacing")),
		lineSpacing: Math.round(pick("lineSpacing")),
		boxRadius: Math.round(pick("boxRadius")),
		boxOpacity: Math.round(pick("boxOpacity") * 100) / 100,
		// Letters, numbers and simple marks only: it is drawn into the video as subtitle text.
		logo: typeof v.logo === "string" ? v.logo.replace(/[\\{}\n\r]/g, "").trim().slice(0, MAX_LOGO_LENGTH) : DEFAULT_STYLE.logo,
		logoAt: typeof v.logoAt === "string" && v.logoAt in LOGO_CORNERS ? (v.logoAt as LogoCorner) : "top-left",
		zoom: v.zoom === "off" || v.zoom === "in" || v.zoom === "out" || v.zoom === "cuts" || v.zoom === "smooth" ? v.zoom : DEFAULT_STYLE.zoom,
		zoomAmount: Math.round(pick("zoomAmount") * 100) / 100,
		zoomPeriod: Math.round(pick("zoomPeriod")),
		format: typeof v.format === "string" && v.format in FORMATS ? (v.format as Format) : DEFAULT_STYLE.format,
		motion: typeof v.motion === "string" && v.motion in MOTIONS ? (v.motion as Motion) : DEFAULT_STYLE.motion,
		subtitles: v.subtitles !== false,
		audio: v.audio !== false,
		audioAmount: Math.round(pick("audioAmount") * 100) / 100,
	};
}
