"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CutoutTier, Window } from "./cutout";
import { type LocalTier, localSupport, makeLocalMatte } from "./cutout-local";

// The editor's side of Cutout (lib/cutout.ts, lib/behind.ts): is it on for this person, how far the
// speaker's cutout is, and the calls that start one or upload a picture or clip.
export type CutoutState = {
	on: boolean; // turned on for this person on /admin
	status: "none" | "processing" | "done" | "failed";
	windows: Window[]; // what is (being) cut out, source seconds
	tier?: CutoutTier; // which quality that is
	previewUrl?: string; // the stacked preview copy, once done
	version?: string; // which cutout that is: its link changes on every look, this only with a new cutout
	files: Record<string, string>; // a link to each inserted picture or clip
	error?: string;
	best: { unlimited: boolean; limit: number; used: number }; // seconds of Best this month
	support: Record<LocalTier, boolean>; // what this computer can run itself
	local: { tier: LocalTier; phase: "cutting" | "sending"; part: number } | null; // being cut out on this computer now
};

const POLL_MS = 10_000;
const NO_BEST = { unlimited: false, limit: 0, used: 0 };

export function useCutout(key: string | null) {
	const [state, setState] = useState<CutoutState>({ on: false, status: "none", windows: [], files: {}, best: NO_BEST, support: { fast: false, balanced: false }, local: null });
	const local = useRef<Record<string, string>>({}); // files just uploaded: shown from this computer at once
	const stop = useRef<AbortController | null>(null);

	const refresh = useCallback(async () => {
		if (!key) return;
		const res = await fetch(`/api/cutout?key=${encodeURIComponent(key)}`).catch(() => null);
		if (!res?.ok) return;
		const data = (await res.json()) as Omit<CutoutState, "on" | "support" | "local">;
		setState((s) => ({ ...s, previewUrl: undefined, version: undefined, tier: undefined, error: undefined, ...data, files: { ...data.files, ...local.current } }));
	}, [key]);

	useEffect(() => {
		if (!key) return;
		void fetch("/api/access")
			.then((r) => (r.ok ? (r.json() as Promise<{ features?: { cutout?: { on: boolean } } }>) : null))
			.then((a) => {
				if (a?.features?.cutout?.on) setState((s) => ({ ...s, on: true }));
			})
			.catch(() => {});
		void localSupport()
			.then((support) => setState((s) => ({ ...s, support })))
			.catch(() => {});
		void refresh();
	}, [key, refresh]);

	// While the server works, look again now and then.
	useEffect(() => {
		if (state.status !== "processing" || state.local) return;
		const timer = setInterval(() => void refresh(), POLL_MS);
		return () => clearInterval(timer);
	}, [state.status, state.local, refresh]);

	// Fast and Balanced stop if the page closes, so ask first.
	const working = Boolean(state.local);
	useEffect(() => {
		if (!working) return;
		const warn = (e: BeforeUnloadEvent) => e.preventDefault();
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [working]);
	useEffect(() => () => stop.current?.abort(), []);

	const failed = useCallback((error: string) => setState((s) => ({ ...s, local: null, status: "failed", error })), []);

	const startBest = useCallback(
		async (windows: Window[]) => {
			if (!key) return;
			setState((s) => ({ ...s, status: "processing", tier: "best", previewUrl: undefined, version: undefined, error: undefined }));
			const res = await fetch("/api/cutout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, windows, tier: "best" }) }).catch(() => null);
			const data = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
			if (!res?.ok) failed(data?.error ?? "Could not start the cutout. Please try again.");
			else void refresh();
		},
		[key, refresh, failed],
	);

	const startLocal = useCallback(
		async (windows: Window[], tier: LocalTier, videoUrl: string) => {
			if (!key) return;
			const controller = new AbortController();
			stop.current = controller;
			setState((s) => ({ ...s, error: undefined, local: { tier, phase: "cutting", part: 0 } }));
			try {
				const matte = await makeLocalMatte(tier, videoUrl, windows, (part) => setState((s) => (s.local ? { ...s, local: { ...s.local, part } } : s)), controller.signal);
				setState((s) => (s.local ? { ...s, local: { ...s.local, phase: "sending", part: 1 } } : s));
				const asked = await fetch("/api/cutout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, windows, tier }) });
				const place = (await asked.json().catch(() => ({}))) as { uploadUrl?: string; error?: string };
				if (!asked.ok || !place.uploadUrl) return failed(place.error ?? "Could not save the cutout. Please try again.");
				const sent = await fetch(place.uploadUrl, { method: "PUT", headers: { "Content-Type": "video/h264" }, body: matte, signal: controller.signal });
				if (!sent.ok) return failed("The upload stopped. Please try again.");
				const done = await fetch("/api/cutout/finish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
				const data = (await done.json().catch(() => ({}))) as { error?: string };
				if (!done.ok) return failed(data.error ?? "Could not finish the cutout. Please try again.");
				setState((s) => ({ ...s, local: null, status: "processing", tier, previewUrl: undefined, version: undefined }));
				void refresh();
			} catch (error) {
				if (error instanceof DOMException && error.name === "AbortError") return setState((s) => ({ ...s, local: null }));
				failed(error instanceof Error && error.message ? error.message : "The cutout stopped. Please try again.");
			}
		},
		[key, refresh, failed],
	);

	const start = useCallback(
		(windows: Window[], tier: CutoutTier, videoUrl: string | null) => {
			if (tier === "best") return void startBest(windows);
			if (videoUrl) void startLocal(windows, tier, videoUrl);
		},
		[startBest, startLocal],
	);
	const cancel = useCallback(() => stop.current?.abort(), []);

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

	return { ...state, start, cancel, upload, refresh };
}
