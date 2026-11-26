"use client";

import { useEffect, useState } from "react";
import type { OwnFont } from "./font-info";
import { asOwnFont, type MyFile } from "./my-files";

// The own fonts a person can pick (subtitles and banners; SubtitleControls, BannerControls): those in My files (from
// 21 Nov), and the one font per account from before, if any. Picking one pins that very file in the style or banner.
// limit: how many the plan holds (coach 21 Nov: Starter 5, Pro 20, Free none). Fonts kept from a bigger plan stay
// in the projects that use them; for new picks only the first `limit` uploaded are open (the rest say Upgrade).
export { asOwnFont };

export type FontClash = { file: File; conflict: MyFile };

// Where a file is used, as words ("2 Brand Kits, 1 saved banner and 3 projects"), or null when nothing uses it.
export function describeUse(use?: { kits?: string[]; banners?: number; projects?: number }) {
	const parts = [use?.kits?.length ? `${use.kits.length} Brand Kit${use.kits.length > 1 ? "s" : ""}` : "", use?.banners ? `${use.banners} saved banner${use.banners > 1 ? "s" : ""}` : "", use?.projects ? `${use.projects} project${use.projects > 1 ? "s" : ""}` : ""].filter(Boolean);
	return parts.length ? parts.join(", ").replace(/, ([^,]*)$/, " and $1") : null;
}

// Told to the page when a font is deleted or uploaded here, so the preview follows at once (PlayerFrame): a deleted one
// stops being drawn, and the same file uploaded again (the same id) is drawn again.
export const FONT_CHANGED = "komoray:font-changed";
export type FontChange = { id: string; gone: boolean };
const tellFont = (change: FontChange) => window.dispatchEvent(new CustomEvent(FONT_CHANGED, { detail: change }));

export function useMyFonts() {
	const [fonts, setFonts] = useState<MyFile[]>([]);
	const [limit, setLimit] = useState<number | null>(null);
	const [older, setOlder] = useState<OwnFont | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [clash, setClash] = useState<FontClash | null>(null);
	useEffect(() => {
		fetch("/api/files?kind=font")
			.then((res) => (res.ok ? (res.json() as Promise<{ files: MyFile[]; limit: number | null }>) : { files: [], limit: 0 }))
			.then((data) => {
				setFonts(data.files);
				setLimit(data.limit);
			})
			.catch(() => {});
		fetch("/api/font")
			.then((res) => (res.ok ? (res.json() as Promise<{ font: OwnFont | null }>) : { font: null }))
			.then((data) => setOlder(data.font))
			.catch(() => {});
	}, []);

	// The first `limit` uploaded (the list is newest first).
	const open = new Set(limit === null ? fonts.map((f) => f.id) : [...fonts].reverse().slice(0, limit).map((f) => f.id));
	const usable = (f: MyFile) => open.has(f.id);

	// Upload, or ask first when another font has this name (Use that one / Keep both). The font, or null.
	async function upload(file: File, then?: "use" | "keep"): Promise<OwnFont | null> {
		setBusy(true);
		setError("");
		setClash(null);
		const query = new URLSearchParams({ kind: "font", name: file.name, ...(then && { then }) });
		const res = await fetch(`/api/files?${query}`, { method: "POST", body: file }).catch(() => null);
		const data = (await res?.json().catch(() => ({}))) as { file?: MyFile; conflict?: MyFile; error?: string };
		setBusy(false);
		if (res?.status === 409 && data.conflict) {
			setClash({ file, conflict: data.conflict });
			return null;
		}
		if (!res?.ok || !data.file) {
			setError(data?.error ?? "Could not upload the font");
			return null;
		}
		const added = data.file;
		tellFont({ id: added.id, gone: false });
		setFonts((list) => [added, ...list.filter((f) => f.id !== added.id)]);
		return asOwnFont(added);
	}

	// Where a font is used now (My files page's list), as words, or null: for the red line before it is deleted (coach 23 Nov).
	async function usage(id: string): Promise<string | null> {
		const res = await fetch("/api/files?all=1").catch(() => null);
		const data = (await res?.json().catch(() => ({}))) as { use?: Record<string, { kits?: string[]; banners?: number; projects?: number }> };
		return describeUse(data.use?.[id]);
	}

	// Delete one from My files, even when it is used (the creator was told first): everything that used it shows the standard font
	// from then on. null = gone; else why not.
	async function remove(id: string): Promise<string | null> {
		const res = await fetch(`/api/files?id=${encodeURIComponent(id)}&force=1`, { method: "DELETE" }).catch(() => null);
		if (res?.ok) {
			setFonts((list) => list.filter((f) => f.id !== id));
			tellFont({ id, gone: true });
			return null;
		}
		const data = (await res?.json().catch(() => ({}))) as { error?: string };
		return data?.error ?? "Could not delete the font";
	}

	return { fonts, older, limit, usable, busy, error, clash, upload, remove, usage, dismiss: () => setClash(null) };
}

// The value of an own font in a <select>: "own:<id>" for My files, "own" for the font from before.
export const ownValue = (font: OwnFont | undefined) => (font?.file ? `own:${font.file}` : "own");

// What a pick in a font list (FontSelect) means for an item that can have an own font (a banner, Cutout's words): its
// font and own font from then on, or null when nothing changes. current: the own font it has now.
export function fontChoice(value: string, current: OwnFont | undefined, myFonts: ReturnType<typeof useMyFonts>): { font: string | undefined; ownFont: OwnFont | undefined } | null {
	const mine = value.startsWith("own:") ? myFonts.fonts.find((f) => f.id === value.slice(4)) : undefined;
	if (!value) return { font: undefined, ownFont: undefined };
	if (mine) return { font: "own", ownFont: asOwnFont(mine) };
	if (value === "own" && myFonts.older) return { font: "own", ownFont: myFonts.older };
	if (value === ownValue(current)) return null; // the own font it already has
	return { font: value, ownFont: undefined };
}
