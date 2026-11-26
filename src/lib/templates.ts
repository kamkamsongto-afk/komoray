// Templates (coach 18 and 26 Nov): a video's look, saved from a finished video to put on another one. It keeps the
// subtitle style (with the shape, logo and zoom), Banners, Frame Me and Layout, with their times. Never the script, the
// cuts or Cutout. Pictures, clips, fonts and logos are My files, pointed at by id, so a template outlives its video.
// No server imports here: the server (api/templates) and the editor both use it.
import { type Banner, readBanners } from "./banners";
import { type FrameMe, readFrames } from "./frame-me";
import { readLayouts, type VideoLayout } from "./layout";
import { MY_REF, refId } from "./my-files";
import { readStyle, type SubtitleStyle } from "./subtitle-style";

export type TemplateLook = { style: SubtitleStyle; banners: Banner[]; frames: FrameMe[]; layouts: VideoLayout[] };
// seconds: how long the video it was saved from runs once cut, which says what sat at its end (fitLook).
export type Template = { id: string; name: string; at: string; updatedAt: string; seconds: number; look: TemplateLook };
// What the list shows. locked: past the plan's count (kept, to delete or rename, but not to use until upgrading).
export type TemplateCard = Pick<Template, "id" | "name" | "at" | "updatedAt"> & { shape: SubtitleStyle["format"]; banners: number; frames: number; layouts: number; locked: boolean };
// What couldn't come along: pictures and clips (kept in one video only, or deleted), own fonts, the logo picture.
export type LeftOut = { files: number; fonts: number; logo: boolean };

export const TEMPLATE = {
	maxName: 40,
	tail: 3, // an item ending this close to the end of the video belongs to the end
	head: 0.5, // starting this close to the start, and ending at the end: it runs through the whole video
	shortest: 0.5, // an item left with less than this on a shorter video is left out
};

export const cleanTemplateName = (name: unknown) => (typeof name === "string" ? name.replace(/[\n\r\t]/g, " ").trim().slice(0, TEMPLATE.maxName) : "");

// A look as sent by a browser or kept in R2, checked field by field. splits and spots belong to one video's words.
export function readLook(value: unknown): TemplateLook | null {
	if (!value || typeof value !== "object") return null;
	const v = value as { style?: unknown; banners?: unknown; frames?: unknown; layouts?: unknown };
	const style = readStyle(v.style);
	delete style.splits;
	delete style.spots;
	const banners = readBanners(v.banners ?? []);
	const frames = readFrames(v.frames ?? []);
	const layouts = readLayouts(v.layouts ?? []);
	return banners && frames && layouts ? { style, banners, frames, layouts } : null;
}

// The look with only what can be shown on any video of theirs. file: a My files picture or clip that is there (by its
// reference name); logo and font: a My files id that is there, the font also open on their plan. A banner without its
// picture goes; Frame Me and Layout stay, without it (blurred background, colour). A font that can't be used is Kanit.
export function usableLook(look: TemplateLook, has: { file: (name: string) => boolean; logo: (id: string) => boolean; font: (id: string) => boolean }): { look: TemplateLook; left: LeftOut } {
	const left: LeftOut = { files: 0, fonts: 0, logo: false };
	const fileThere = (name: string) => MY_REF.test(name) && !!refId(name) && has.file(name);
	const fontGone = (item: { font?: string; ownFont?: { file?: string } }) => {
		const gone = item.font === "own" && !!item.ownFont?.file && !has.font(item.ownFont.file);
		if (gone) left.fonts += 1;
		return gone;
	};
	const style = { ...look.style };
	if (fontGone(style)) {
		style.font = "kanit";
		delete style.ownFont;
	}
	if (style.logoImage && "file" in style.logoImage && !has.logo(style.logoImage.file)) {
		delete style.logoImage;
		left.logo = true;
	}
	const banners = look.banners.flatMap((b): Banner[] => {
		if (b.kind === "file") {
			if (b.file && fileThere(b.file)) return [b];
			left.files += 1;
			return [];
		}
		if (!fontGone(b)) return [b];
		const { ownFont, ...rest } = b;
		void ownFont;
		return [{ ...rest, font: "kanit" }];
	});
	const frames = look.frames.map((f): FrameMe => {
		if (!f.file || fileThere(f.file)) return f;
		left.files += 1;
		// Everything that belongs to the picture goes with it; the frame itself stays.
		const rest: FrameMe = { ...f, back: f.back === "file" ? "blur" : f.back };
		for (const key of ["file", "media", "volume", "muted", "clipFrom", "backMotion", "backAmount", "backSpeed", "backSize", "backX", "backY", "backRotate"] as const) delete (rest as Record<string, unknown>)[key];
		return rest;
	});
	const layouts = look.layouts.map((l): VideoLayout => {
		if (!l.file || fileThere(l.file)) return l;
		left.files += 1;
		const rest: VideoLayout = { ...l };
		for (const key of ["file", "media", "volume", "muted", "clipFrom", "fileZoom", "fileX", "fileY", "fileRotate", "fileMotion", "fileMotionZoom", "fileMotionSpeed"] as const) delete (rest as Record<string, unknown>)[key];
		return rest;
	});
	return { look: { style, banners, frames, layouts }, left };
}

const round = (n: number) => Math.round(n * 100) / 100;

// When an item shows on a video of `to` seconds, taken from one of `from` seconds (coach 26 Nov: what sits at the end
// sticks to the new end). Through the whole video: still the whole video. Ending near the end: the same length, as far
// from the new end. Anything else: the same time from the start, cut at the end. null: no room for it.
export function fitTimes(item: { start: number; end: number }, from: number, to: number): { start: number; end: number } | null {
	const after = Math.max(0, from - item.end);
	let { start, end } = item;
	if (after <= TEMPLATE.tail) {
		end = to - after;
		if (item.start > TEMPLATE.head) start = end - (item.end - item.start);
	}
	start = round(Math.max(0, start));
	end = round(Math.min(to, end));
	return end - start >= Math.min(TEMPLATE.shortest, item.end - item.start) - 0.001 && end > start ? { start, end } : null;
}

// The whole look on a video of `to` seconds. dropped: how many items had no room.
export function fitLook(look: TemplateLook, from: number, to: number): { look: TemplateLook; dropped: number } {
	let dropped = 0;
	const fit = <T extends { start: number; end: number }>(items: T[]) =>
		items.flatMap((item) => {
			const times = fitTimes(item, from, to);
			if (!times) dropped += 1;
			return times ? [{ ...item, ...times }] : [];
		});
	return { look: { style: look.style, banners: fit(look.banners), frames: fit(look.frames), layouts: fit(look.layouts) }, dropped };
}

// What to say about the things that didn't come along, or "".
export function leftOutText(left: LeftOut, dropped = 0) {
	return [
		dropped ? `${dropped} item${dropped > 1 ? "s" : ""} didn't fit this shorter video.` : "",
		left.files ? `${left.files} picture${left.files > 1 ? "s or clips aren't" : " or clip isn't"} included: not in My files (deleted, or uploaded to one video before My files).` : "",
		left.fonts ? "A font you can't use here is now the standard font." : "",
		left.logo ? "The logo picture is no longer in My files, so it was left out." : "",
	]
		.filter(Boolean)
		.join(" ");
}
