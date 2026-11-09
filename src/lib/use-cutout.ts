"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clock, type CutoutTier, slowSeconds, type Window } from "./cutout";
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
	local: { tier: LocalTier; phase: "cutting" | "sending"; part: number; left: number | null } | null; // being cut out on this computer now
	startedAt?: string; // when the running job began
	slowWindows: Window[]; // what Slow has already made for this video, kept even after Fast or Normal replaced it
	runs?: number; // how many times Slow has run on this video
};

// The running number people watch, so "my text is still in front" reads as waiting and not as broken (coach, 9 Nov).
export function waitLabel(c: Pick<CutoutState, "local" | "status" | "tier"> & { timeLeft: number | null }) {
	if (c.local?.phase === "sending") return "Less than a minute";
	if (c.local) return c.timeLeft === null ? "Getting ready…" : `About ${clock(c.timeLeft)} left`;
	if (c.status !== "processing") return null;
	if (c.tier !== "best") return "Almost done…";
	if (c.timeLeft === null) return "Starting…";
	return c.timeLeft > 0 ? `About ${clock(c.timeLeft)} left` : "Taking longer than usual…";
}

const POLL_MS = 10_000;
const SAVE_SECONDS = 25; // Fast and Normal: uploading and finishing after the last frame (measured 15–19 s to finish)
const FIRST_ESTIMATE_MS = 3000; // the first frames say little about the speed
const SHOW_EVERY_MS = 250;
const NO_BEST = { unlimited: false, limit: 0, used: 0 };

export function useCutout(key: string | null) {
	const [state, setState] = useState<CutoutState>({ on: false, status: "none", windows: [], files: {}, best: NO_BEST, support: { fast: false, balanced: false }, local: null, slowWindows: [] });
	const local = useRef<Record<string, string>>({}); // files just uploaded: shown from this computer at once
	const stop = useRef<AbortController | null>(null);

	const refresh = useCallback(async () => {
		if (!key) return;
		const res = await fetch(`/api/cutout?key=${encodeURIComponent(key)}`).catch(() => null);
		if (!res?.ok) return;
		const data = (await res.json()) as Omit<CutoutState, "on" | "support" | "local">;
		setState((s) => ({ ...s, previewUrl: undefined, version: undefined, tier: undefined, error: undefined, startedAt: undefined, ...data, files: { ...data.files, ...local.current } }));
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

	// Slow's countdown runs on the clock: the GPU tells us nothing until it is done.
	const [tick, setTick] = useState(0);
	const slowRunning = state.status === "processing" && state.tier === "best" && !state.local;
	useEffect(() => {
		if (!slowRunning) return;
		const timer = setInterval(() => setTick(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [slowRunning]);
	const slowLeft = slowRunning && state.startedAt && tick ? slowSeconds(state.windows) - Math.max(0, tick - Date.parse(state.startedAt)) / 1000 : null;
	const timeLeft = state.local ? state.local.left : slowLeft;

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
			setState((s) => ({ ...s, status: "processing", tier: "best", windows, startedAt: new Date().toISOString(), previewUrl: undefined, version: undefined, error: undefined }));
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
			setState((s) => ({ ...s, error: undefined, local: { tier, phase: "cutting", part: 0, left: null } }));
			// Timed from the first frame, so downloading the model doesn't count as slow frames.
			let first: { at: number; part: number } | null = null;
			let shown = 0;
			const progress = (part: number) => {
				const at = performance.now();
				first ??= { at, part };
				if (at - shown < SHOW_EVERY_MS) return;
				shown = at;
				const spent = at - first.at;
				const left = spent >= FIRST_ESTIMATE_MS && part > first.part ? (((1 - part) * spent) / (part - first.part)) / 1000 + SAVE_SECONDS : null;
				setState((s) => (s.local ? { ...s, local: { ...s.local, part, left } } : s));
			};
			try {
				const matte = await makeLocalMatte(tier, videoUrl, windows, progress, controller.signal);
				setState((s) => (s.local ? { ...s, local: { ...s.local, phase: "sending", part: 1, left: null } } : s));
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

	return { ...state, timeLeft, start, cancel, upload, refresh };
}
