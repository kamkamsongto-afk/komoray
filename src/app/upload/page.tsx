"use client";

import { useEffect, useRef, useState } from "react";

type Status = "idle" | "uploading" | "done" | "error";
type Cut = { start: number; end: number };
type Analysis = { editKey: string; duration: number; cuts: Cut[]; words: { text: string }[] };
type RenderState = {
	status: "none" | "processing" | "done" | "failed";
	videoUrl?: string;
	downloadUrl?: string;
	error?: string;
};

const POLL_MS = 5000;
const ANALYZE_POLL_MS = 3000;
const ANALYZE_GIVE_UP_MS = 30 * 60 * 1000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const PAGE_TITLE = "Komoray — AI Studio for Talking Heads";

const NOTIFY_PREF = "komoray.desktopNotify"; // remembers the checkbox in this browser

// Two soft rising tones, made in the browser so there is no sound file to load.
function ding(audio: AudioContext | null) {
	if (!audio) return;
	[880, 1320].forEach((freq, i) => {
		const osc = audio.createOscillator();
		const gain = audio.createGain();
		const at = audio.currentTime + i * 0.18;
		osc.frequency.value = freq;
		gain.gain.setValueAtTime(0.0001, at);
		gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
		gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
		osc.connect(gain).connect(audio.destination);
		osc.start(at);
		osc.stop(at + 0.4);
	});
}

// Let people work in another tab while the video renders: play a sound, flag the browser tab,
// and pop up a desktop notification only if they ticked the box.
function announce(state: RenderState, audio: AudioContext | null, desktop: boolean) {
	const text = state.status === "done" ? "✅ Your video is ready!" : "❌ Your video could not be made";
	ding(audio);
	if (document.hidden) document.title = `${state.status === "done" ? "✅ Ready" : "❌ Failed"} · Komoray`;
	if (desktop && "Notification" in window && Notification.permission === "granted") {
		const note = new Notification("Komoray", { body: text, icon: "/favicon.svg" });
		note.onclick = () => window.focus();
	}
}

function readNotifyPref() {
	try {
		return localStorage.getItem(NOTIFY_PREF) === "1";
	} catch {
		return false;
	}
}

function saveNotifyPref(on: boolean) {
	try {
		localStorage.setItem(NOTIFY_PREF, on ? "1" : "0");
	} catch {
		// private window etc. — the checkbox just won't be remembered
	}
}

// fetch() can't report upload progress yet, so we use XMLHttpRequest for the PUT to R2.
function putWithProgress(url: string, file: File, onProgress: (percent: number) => void) {
	return new Promise<void>((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open("PUT", url);
		xhr.setRequestHeader("Content-Type", file.type);
		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
		};
		xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
		xhr.onerror = () => reject(new Error("Network error while uploading"));
		xhr.send(file);
	});
}

const fmt = (s: number) => s.toFixed(2);

export default function UploadPage() {
	const [status, setStatus] = useState<Status>("idle");
	const [progress, setProgress] = useState(0);
	const [message, setMessage] = useState("");
	const [key, setKey] = useState<string | null>(null);

	const [language, setLanguage] = useState("en");
	const [analyzing, setAnalyzing] = useState(false);
	const [analysis, setAnalysis] = useState<Analysis | null>(null);
	const [analysisError, setAnalysisError] = useState("");
	const [render, setRender] = useState<RenderState>({ status: "none" });
	const [dragging, setDragging] = useState(false);
	const [desktopNotify, setDesktopNotify] = useState(false);
	const [notifyBlocked, setNotifyBlocked] = useState(false);
	// Browsers only allow sound after a click, so the Make video click creates this.
	const audioRef = useRef<AudioContext | null>(null);

	useEffect(() => {
		const granted = "Notification" in window && Notification.permission === "granted";
		setDesktopNotify(granted && readNotifyPref());
	}, []);

	async function toggleDesktopNotify(on: boolean) {
		setNotifyBlocked(false);
		if (on && "Notification" in window) {
			const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
			if (permission !== "granted") {
				setNotifyBlocked(true);
				on = false;
			}
		}
		setDesktopNotify(on);
		saveNotifyPref(on);
	}

	// A file dropped outside the drop zone would make the browser open it and leave the page.
	useEffect(() => {
		const stop = (e: DragEvent) => e.preventDefault();
		window.addEventListener("dragover", stop);
		window.addEventListener("drop", stop);
		return () => {
			window.removeEventListener("dragover", stop);
			window.removeEventListener("drop", stop);
		};
	}, []);

	// While Modal is working, ask the server every few seconds whether the video is ready.
	useEffect(() => {
		if (!key || render.status !== "processing") return;
		const timer = setInterval(async () => {
			const res = await fetch(`/api/render?key=${encodeURIComponent(key)}`);
			const data = (await res.json()) as RenderState;
			if (data.status === "done" || data.status === "failed") {
				setRender(data);
				announce(data, audioRef.current, desktopNotify);
			}
		}, POLL_MS);
		return () => clearInterval(timer);
	}, [key, render.status, desktopNotify]);

	// Put the normal tab title back when the user returns to this tab.
	useEffect(() => {
		const restore = () => {
			if (!document.hidden) document.title = PAGE_TITLE;
		};
		document.addEventListener("visibilitychange", restore);
		return () => document.removeEventListener("visibilitychange", restore);
	}, []);

	async function handleFile(file: File) {
		setStatus("uploading");
		setProgress(0);
		setMessage(file.name);
		setKey(null);
		setAnalysis(null);
		setAnalysisError("");
		setRender({ status: "none" });

		try {
			// 1) Ask our server for a short-lived upload link.
			const res = await fetch("/api/upload-url", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size }),
			});
			const data = (await res.json()) as { uploadUrl?: string; key?: string; error?: string };
			if (!res.ok || !data.uploadUrl || !data.key) throw new Error(data.error ?? "Could not start upload");

			// 2) Send the file straight to R2 with that link.
			await putWithProgress(data.uploadUrl, file, setProgress);

			setStatus("done");
			setMessage(data.key);
			setKey(data.key);
		} catch (err) {
			setStatus("error");
			setMessage(err instanceof Error ? err.message : "Something went wrong");
		}
	}

	async function findSilences() {
		if (!key) return;
		setAnalyzing(true);
		setAnalysis(null);
		setAnalysisError("");
		setRender({ status: "none" });
		try {
			const res = await fetch("/api/analyze", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ key, language }),
			});
			const started = (await res.json()) as { error?: string };
			if (!res.ok) throw new Error(started.error ?? "Analysis failed");

			// Long videos take Deepgram a few minutes, so keep asking until the cut list is saved.
			const giveUpAt = Date.now() + ANALYZE_GIVE_UP_MS;
			while (Date.now() < giveUpAt) {
				await wait(ANALYZE_POLL_MS);
				const poll = await fetch(`/api/analyze?key=${encodeURIComponent(key)}`);
				const data = (await poll.json()) as Analysis & { status?: string; error?: string };
				if (data.status === "done") {
					setAnalysis(data);
					return;
				}
				if (data.status === "failed") throw new Error(data.error ?? "Analysis failed");
			}
			throw new Error("This is taking too long. Please try again.");
		} catch (err) {
			setAnalysisError(err instanceof Error ? err.message : "Analysis failed");
		} finally {
			setAnalyzing(false);
		}
	}

	async function makeVideo() {
		if (!key) return;
		if (!audioRef.current && "AudioContext" in window) audioRef.current = new AudioContext();
		void audioRef.current?.resume();
		setRender({ status: "processing" });
		try {
			const res = await fetch("/api/render", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ key }),
			});
			const data = (await res.json()) as { error?: string };
			if (!res.ok) throw new Error(data.error ?? "Could not start the render");
		} catch (err) {
			setRender({ status: "failed", error: err instanceof Error ? err.message : "Could not start the render" });
		}
	}

	const silentSeconds = analysis ? analysis.cuts.reduce((sum, c) => sum + (c.end - c.start), 0) : 0;
	const busy = status === "uploading" || analyzing;

	return (
		<main className="font-sans mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 p-8">
			<h1 className="text-3xl font-bold tracking-tight">Upload a video</h1>
			<p className="text-foreground/70">MP4 or MOV, up to 500 MB.</p>

			<label
				onDragOver={(e) => {
					e.preventDefault();
					if (!busy) setDragging(true);
				}}
				onDragLeave={() => setDragging(false)}
				onDrop={(e) => {
					e.preventDefault();
					setDragging(false);
					const file = e.dataTransfer.files[0];
					if (file && !busy) handleFile(file);
				}}
				className={`flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${
					dragging ? "border-blue-600 bg-blue-600/10" : "border-foreground/20 hover:border-foreground/40"
				}`}
			>
				{/* pointer-events-none: hovering the text must not count as leaving the drop zone */}
				<span className="pointer-events-none text-lg font-medium">{dragging ? "Release to upload ⬇️" : "Drop your video here 🎬"}</span>
				<span className="pointer-events-none text-sm text-foreground/60">or click to choose a file</span>
				<input
					type="file"
					accept="video/mp4,video/quicktime"
					className="hidden"
					disabled={busy}
					onChange={(e) => {
						const file = e.target.files?.[0];
						if (file) handleFile(file);
						e.target.value = "";
					}}
				/>
			</label>

			{status !== "idle" && (
				<div className="flex flex-col gap-2">
					<div className="h-3 w-full overflow-hidden rounded-full bg-foreground/10">
						<div
							className={`h-full transition-all ${status === "error" ? "bg-red-500" : "bg-blue-600"}`}
							style={{ width: `${status === "error" ? 100 : progress}%` }}
						/>
					</div>
					<p className="text-sm break-all text-foreground/70">
						{status === "uploading" && `Uploading ${message}… ${progress}%`}
						{status === "done" && `✅ Uploaded! Saved as ${message}`}
						{status === "error" && `❌ ${message}`}
					</p>
				</div>
			)}

			{key && (
				<div className="flex flex-col gap-4 rounded-2xl border border-foreground/15 p-6">
					<div className="flex flex-wrap items-center gap-3">
						<select
							value={language}
							onChange={(e) => setLanguage(e.target.value)}
							disabled={analyzing}
							className="rounded-lg border border-foreground/20 bg-background px-3 py-2"
						>
							<option value="en">English</option>
							<option value="th">ไทย</option>
						</select>
						<button
							onClick={findSilences}
							disabled={analyzing}
							className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
						>
							{analyzing ? "Listening…" : "Find silences"}
						</button>
					</div>

					{analyzing && (
						<p className="text-sm text-foreground/70">
							👂 Listening to your video… longer videos can take a few minutes.
						</p>
					)}

					{analysisError && <p className="text-sm text-red-500">❌ {analysisError}</p>}

					{analysis && (
						<div className="flex flex-col gap-3 text-sm">
							<p>
								🗣️ {analysis.words.length} words · ⏱️ {fmt(analysis.duration)}s long · ✂️ {analysis.cuts.length} silences
								= {fmt(silentSeconds)}s to cut
							</p>
							<ul className="max-h-64 overflow-y-auto rounded-lg bg-foreground/5 p-3 font-mono">
								{analysis.cuts.map((c, i) => (
									<li key={i}>
										{fmt(c.start)}s → {fmt(c.end)}s ({fmt(c.end - c.start)}s)
									</li>
								))}
								{analysis.cuts.length === 0 && <li>No silences longer than 0.4s 🎉</li>}
							</ul>
							<p className="break-all text-foreground/60">Saved cut list: {analysis.editKey}</p>
						</div>
					)}

					{analysis && (
						<div className="flex flex-col gap-3 border-t border-foreground/10 pt-4">
							<button
								onClick={makeVideo}
								disabled={render.status === "processing"}
								className="self-start rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
							>
								{render.status === "done" || render.status === "failed" ? "Make video again" : "Make video"}
							</button>

							<label className="flex items-center gap-2 text-sm text-foreground/70">
								<input
									type="checkbox"
									checked={desktopNotify}
									onChange={(e) => void toggleDesktopNotify(e.target.checked)}
								/>
								🔔 Also notify me on my desktop
							</label>
							{notifyBlocked && (
								<p className="text-sm text-foreground/60">
									Your browser is blocking notifications. Click the icon left of the address bar → Notifications →
									Allow, then tick the box again.
								</p>
							)}

							{render.status === "processing" && (
								<div className="flex flex-col gap-2">
									<div className="h-3 w-full animate-pulse rounded-full bg-blue-600/60" />
									<p className="text-sm text-foreground/70">
										🎬 Making your video… usually 1–3 minutes. Feel free to switch tabs, you&apos;ll hear a ding when it&apos;s ready.
									</p>
								</div>
							)}

							{render.status === "failed" && <p className="text-sm text-red-500">❌ {render.error}</p>}

							{render.status === "done" && render.videoUrl && (
								<div className="flex flex-col gap-3">
									<p className="text-sm">✅ Your video is ready!</p>
									<video src={render.videoUrl} controls playsInline className="max-h-[70vh] w-full rounded-lg bg-black" />
									<a
										href={render.downloadUrl}
										className="self-start rounded-lg border border-foreground/20 px-4 py-2 font-medium hover:bg-foreground/5"
									>
										⬇️ Download video
									</a>
								</div>
							)}
						</div>
					)}
				</div>
			)}
		</main>
	);
}
