"use client";

import { useEffect, useState } from "react";
import type { OwnFont } from "./font-info";
import type { MyFile } from "./my-files";

// The own fonts a person can pick (subtitles and banners; SubtitleControls, BannerControls): those in My files (from
// 21 Nov), and the one font per account from before, if any. Picking one pins that very file in the style or banner.
// limit: how many the plan holds (coach 21 Nov: Starter 5, Pro 20, Free none). Fonts kept from a bigger plan stay
// in the projects that use them; for new picks only the first `limit` uploaded are open (the rest say Upgrade).
export const asOwnFont = (f: MyFile): OwnFont => ({ family: f.family ?? f.name, height: f.height ?? 1.58, version: 0, file: f.id });

export type FontClash = { file: File; conflict: MyFile };

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
		setFonts((list) => [added, ...list.filter((f) => f.id !== added.id)]);
		return asOwnFont(added);
	}

	return { fonts, older, limit, usable, busy, error, clash, upload, dismiss: () => setClash(null) };
}

// The value of an own font in a <select>: "own:<id>" for My files, "own" for the font from before.
export const ownValue = (font: OwnFont | undefined) => (font?.file ? `own:${font.file}` : "own");
