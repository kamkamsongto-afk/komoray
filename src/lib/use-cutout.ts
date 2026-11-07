"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Window } from "./cutout";

// The editor's side of Cutout (lib/cutout.ts, lib/behind.ts): is it on for this person, how far the
// speaker's cutout is, and the calls that start one or upload a picture or clip.
export type CutoutState = {
	on: boolean; // turned on for this person on /admin
	seconds: number; // how much of one video may be cut out
	status: "none" | "processing" | "done" | "failed";
	windows: Window[]; // what is (being) cut out, source seconds
	previewUrl?: string; // the stacked preview copy, once done
	files: Record<string, string>; // a link to each inserted picture or clip
	error?: string;
};

const POLL_MS = 10_000;

export function useCutout(key: string | null) {
	const [state, setState] = useState<CutoutState>({ on: false, seconds: 0, status: "none", windows: [], files: {} });
	const local = useRef<Record<string, string>>({}); // files just uploaded: shown from this computer at once

	const refresh = useCallback(async () => {
		if (!key) return;
		const res = await fetch(`/api/cutout?key=${encodeURIComponent(key)}`).catch(() => null);
		if (!res?.ok) return;
		const data = (await res.json()) as Omit<CutoutState, "on" | "seconds">;
		setState((s) => ({ ...s, ...data, files: { ...data.files, ...local.current } }));
	}, [key]);

	useEffect(() => {
		if (!key) return;
		void fetch("/api/access")
			.then((r) => (r.ok ? (r.json() as Promise<{ features?: { cutout?: { on: boolean; seconds: number } } }>) : null))
			.then((a) => {
				const cutout = a?.features?.cutout;
				if (cutout?.on) setState((s) => ({ ...s, on: true, seconds: cutout.seconds }));
			})
			.catch(() => {});
		void refresh();
	}, [key, refresh]);

	// While the GPU works, look again now and then.
	useEffect(() => {
		if (state.status !== "processing") return;
		const timer = setInterval(() => void refresh(), POLL_MS);
		return () => clearInterval(timer);
	}, [state.status, refresh]);

	const start = useCallback(
		async (windows: Window[]) => {
			if (!key) return;
			setState((s) => ({ ...s, status: "processing", error: undefined }));
			const res = await fetch("/api/cutout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, windows }) }).catch(() => null);
			const data = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
			if (!res?.ok) setState((s) => ({ ...s, status: "failed", error: data?.error ?? "Could not start the cutout. Please try again." }));
			else void refresh();
		},
		[key, refresh],
	);

	// Uploads a picture or clip next to the video. Its name in R2, or an error to show.
	const upload = useCallback(
		async (file: File): Promise<{ file: string; kind: "image" | "video" } | { error: string }> => {
			if (!key) return { error: "No video" };
			const res = await fetch("/api/cutout/insert", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ key, contentType: file.type, size: file.size }),
			}).catch(() => null);
			const data = (await res?.json().catch(() => ({}))) as { uploadUrl?: string; file?: string; kind?: "image" | "video"; error?: string } | undefined;
			if (!res?.ok || !data?.uploadUrl || !data.file || !data.kind) return { error: data?.error ?? "Could not upload. Please try again." };
			const put = await fetch(data.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file }).catch(() => null);
			if (!put?.ok) return { error: "The upload stopped. Please try again." };
			local.current[data.file] = URL.createObjectURL(file);
			setState((s) => ({ ...s, files: { ...s.files, ...local.current } }));
			return { file: data.file, kind: data.kind };
		},
		[key],
	);

	return { ...state, start, upload, refresh };
}
