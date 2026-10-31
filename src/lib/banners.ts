// Banners: a price tag, a call to action or "follow me", shown for a few seconds of the final video
// in the brand colour. Saved in edit.json as "banners"; drawn by PlayerFrame in the preview and by
// build_banners in modal_app/render.py for the final video (same sizes, places and fades).
export type BannerKind = "price" | "cta" | "follow";
export type BannerPlace = "top" | "middle" | "bottom";
// start / end: seconds of the final video. sub: the small second line (price tag only).
export type Banner = { id: string; kind: BannerKind; text: string; sub: string; start: number; end: number; place: BannerPlace };

export const BANNER_KINDS: Record<BannerKind, { name: string; text: string; sub: string }> = {
	price: { name: "Price", text: "$29", sub: "Today only" },
	cta: { name: "Call to action", text: "Link in bio", sub: "" },
	follow: { name: "Follow", text: "Follow for more", sub: "" },
};

// Sizes in px on the 1080x1920 frame; tops of the box for each place. Same as BANNER in render.py.
export const BANNER = { size: 72, subSize: 44, padding: 28, fade: 0.25, seconds: 3, maxText: 40, maxBanners: 20 };
export const BANNER_TOP: Record<BannerPlace, number> = { top: 260, middle: 860, bottom: 1300 };

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

// How visible a banner is at final-video second t: fades in and out over BANNER.fade.
export function bannerOpacity(b: Banner, t: number) {
	if (t < b.start || t >= b.end) return 0;
	return Math.min(1, (t - b.start) / BANNER.fade, (b.end - t) / BANNER.fade);
}

const round = (n: number) => Math.round(n * 100) / 100;

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
		});
	}
	return out;
}
