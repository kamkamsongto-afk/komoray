// Banners: a price tag, a call to action or "follow me", shown for a few seconds of the final video
// in the brand colour. Saved in edit.json as "banners"; drawn by PlayerFrame in the preview and by
// build_banners in modal_app/render.py for the final video (same sizes, places and fades).
import type { Format } from "./subtitle-style";

export type BannerKind = "price" | "cta" | "follow";
export type BannerPlace = "top" | "middle" | "bottom";
// start / end: seconds of the final video. sub: the small second line (price tag only).
// x / y: where its middle is once dragged on the preview (share of the video's width / height);
// without them it sits in its place (top, middle, bottom). scale: its size, 1 = normal.
export type Banner = {
	id: string;
	kind: BannerKind;
	text: string;
	sub: string;
	start: number;
	end: number;
	place: BannerPlace;
	x?: number;
	y?: number;
	scale?: number;
	color?: string; // its background; without it, the brand colour
	ink?: string; // its letters; without it, dark or white to suit the background
	radius?: number; // how round its corners are, px at normal size
	opacity?: number; // how solid its background is, 0.05..1
	anim?: BannerAnim;
};

// How a banner arrives. Same keyframes as BANNER_ANIMS in render.py, which writes them as ASS tags.
export type BannerAnim = "fade" | "pop" | "bounce" | "slideUp" | "slideSide" | "pulse";
export const BANNER_ANIMS: Record<BannerAnim, { name: string; keys?: [number, number][]; fadeIn: boolean; slide?: [number, number] }> = {
	fade: { name: "Fade in", fadeIn: true },
	pop: { name: "Pop", fadeIn: false, keys: [[0, 60], [140, 112], [260, 100]] },
	bounce: { name: "Bounce", fadeIn: false, keys: [[0, 30], [180, 118], [300, 92], [420, 104], [520, 100]] },
	slideUp: { name: "Slide up", fadeIn: true, slide: [0, 160] },
	slideSide: { name: "Slide in from the side", fadeIn: true, slide: [-300, 0] },
	pulse: { name: "Pulse", fadeIn: true },
};
const SLIDE_MS = 320;
const PULSE_MS = 450; // up to 108% and back, again and again
const scaleOn = (keys: [number, number][], ms: number) => {
	if (ms <= keys[0][0]) return keys[0][1];
	for (let i = 1; i < keys.length; i++) if (ms < keys[i][0]) return keys[i - 1][1] + ((keys[i][1] - keys[i - 1][1]) * (ms - keys[i - 1][0])) / (keys[i][0] - keys[i - 1][0]);
	return keys[keys.length - 1][1];
};

// Where the animation has a banner at final-video second t: how visible, how big (1 = its size), how far off (px).
export function bannerMotion(b: Banner, t: number) {
	if (t < b.start || t >= b.end) return { opacity: 0, scale: 1, x: 0, y: 0 };
	const anim = BANNER_ANIMS[b.anim ?? "fade"];
	const ms = (t - b.start) * 1000;
	const fadeIn = anim.fadeIn ? (t - b.start) / BANNER.fade : 1;
	const left = Math.max(0, 1 - ms / SLIDE_MS);
	const swing = (ms % PULSE_MS) / (PULSE_MS / 2);
	return {
		opacity: Math.min(1, fadeIn, (b.end - t) / BANNER.fade),
		scale: anim.keys ? scaleOn(anim.keys, ms) / 100 : b.anim === "pulse" ? 1 + 0.08 * (swing <= 1 ? swing : 2 - swing) : 1,
		x: (anim.slide?.[0] ?? 0) * left,
		y: (anim.slide?.[1] ?? 0) * left,
	};
}

export const BANNER_KINDS: Record<BannerKind, { name: string; text: string; sub: string }> = {
	price: { name: "Price", text: "$29", sub: "Today only" },
	cta: { name: "Call to action", text: "Link in bio", sub: "" },
	follow: { name: "Follow", text: "Follow for more", sub: "" },
};

// Sizes in px of the final video; where each place starts, as a share of its height, for each video
// shape, clear of the subtitles' usual place (bottom is under the subtitles on
// 9:16, over them on the wider shapes). Same as BANNER and BANNER_TOP in render.py.
export const BANNER = { size: 72, subSize: 44, padding: 28, fade: 0.25, seconds: 3, maxText: 40, maxBanners: 20 };
export const BANNER_SCALE = { min: 0.5, max: 2.5 };
export const BANNER_RADIUS = { min: 0, max: 60 };
export const BANNER_OPACITY = { min: 0.05, max: 1 };
export const BANNER_TOP: Record<Format, Record<BannerPlace, number>> = {
	"9:16": { top: 0.135, middle: 0.448, bottom: 0.78 },
	"1:1": { top: 0.08, middle: 0.35, bottom: 0.55 },
	"16:9": { top: 0.08, middle: 0.35, bottom: 0.62 },
};

// Emoji can't be drawn in the final video (its fonts have none), so they are left out everywhere.
export const cleanBannerText = (text: string) =>
	text
		.replace(/\p{Extended_Pictographic}|‍|️/gu, "")
		.replace(/[\\{}\n\r]/g, "")
		.trim()
		.slice(0, BANNER.maxText);

// Dark letters on a light brand colour, white letters on a dark one.
export function bannerInk(color: string) {
	const n = parseInt(color.slice(1), 16);
	const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
	return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#111111" : "#FFFFFF";
}

const HEX = /^#[0-9a-f]{6}$/i;
const round = (n: number) => Math.round(n * 100) / 100;
const share = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000 : null);
function readSpot(x: unknown, y: unknown) {
	const [sx, sy] = [share(x), share(y)];
	return sx === null || sy === null ? {} : { x: sx, y: sy };
}
function readScale(scale: unknown) {
	if (typeof scale !== "number" || !Number.isFinite(scale) || scale === 1) return {};
	return { scale: round(Math.min(BANNER_SCALE.max, Math.max(BANNER_SCALE.min, scale))) };
}

// Banners sent by the browser, checked. Null if it isn't a list.
export function readBanners(value: unknown): Banner[] | null {
	if (!Array.isArray(value)) return null;
	const out: Banner[] = [];
	for (const raw of value.slice(0, BANNER.maxBanners) as Partial<Record<keyof Banner, unknown>>[]) {
		const kind = raw?.kind;
		if (kind !== "price" && kind !== "cta" && kind !== "follow") continue;
		const start = Number(raw.start);
		const end = Number(raw.end);
		if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) continue;
		const text = cleanBannerText(String(raw.text ?? ""));
		if (!text) continue;
		out.push({
			id: String(raw.id ?? "").slice(0, 40) || crypto.randomUUID(),
			kind,
			text,
			sub: kind === "price" ? cleanBannerText(String(raw.sub ?? "")) : "",
			start: round(start),
			end: round(end),
			place: raw.place === "middle" || raw.place === "bottom" ? raw.place : "top",
			...readSpot(raw.x, raw.y),
			...readScale(raw.scale),
			...(typeof raw.color === "string" && HEX.test(raw.color) && { color: raw.color.toUpperCase() }),
			...(typeof raw.ink === "string" && HEX.test(raw.ink) && { ink: raw.ink.toUpperCase() }),
			...(typeof raw.radius === "number" && raw.radius > 0 && { radius: Math.round(Math.min(BANNER_RADIUS.max, raw.radius)) }),
			...(typeof raw.opacity === "number" && raw.opacity < 1 && { opacity: round(Math.max(BANNER_OPACITY.min, raw.opacity)) }),
			...(typeof raw.anim === "string" && raw.anim in BANNER_ANIMS && raw.anim !== "fade" && { anim: raw.anim as BannerAnim }),
		});
	}
	return out;
}
