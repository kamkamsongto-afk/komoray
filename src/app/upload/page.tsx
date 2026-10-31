"use client";

import { useCallback, useEffect, useState } from "react";
import { AccountBar, SignInCard, useUser } from "@/components/Account";
import { PhoneUpload } from "@/components/PhoneUpload";
import { putWithProgress } from "@/lib/put-file";
import { reportError } from "@/lib/report";

type Status = "idle" | "uploading" | "done" | "error";

const ANALYZE_POLL_MS = 3000;
const ANALYZE_GIVE_UP_MS = 30 * 60 * 1000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function UploadPage() {
	const user = useUser();
	const [status, setStatus] = useState<Status>("idle");
	const [progress, setProgress] = useState(0);
	const [message, setMessage] = useState("");
	const [key, setKey] = useState<string | null>(null);

	const [language, setLanguage] = useState("en");
	const [analyzing, setAnalyzing] = useState(false);
	const [analysisError, setAnalysisError] = useState("");
	const [dragging, setDragging] = useState(false);

	// Opened from My projects (/upload?key=…): pick up where that video left off.
	useEffect(() => {
		const saved = new URLSearchParams(window.location.search).get("key");
		if (!user || !saved) return;
		void (async () => {
			const res = await fetch(`/api/analyze?key=${encodeURIComponent(saved)}`);
			const data = (await res.json()) as { status?: string; error?: string };
			if (!res.ok) {
				setStatus("error");
				setMessage("This project was not found. Videos are deleted after 14 days during the beta.");
				return;
			}
			if (data.status === "done") return openEditor(saved);
			setKey(saved);
			setStatus("done");
			setMessage(saved.split("/").pop() ?? saved);
			if (data.status === "failed") setAnalysisError(data.error ?? "Analysis failed");
			if (data.status === "processing") void findSilences(saved, false);
		})();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [user]);

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

	// The script is ready: on to the full-screen editor.
	function openEditor(videoKey: string) {
		window.location.assign(`/edit?key=${encodeURIComponent(videoKey)}`);
	}

	async function handleFile(file: File) {
		setStatus("uploading");
		setProgress(0);
		setMessage(file.name);
		setKey(null);
		setAnalysisError("");

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
			setMessage(file.name);
			setKey(data.key);
			// Put the project in the address bar so a refresh (or a bookmark) comes back to it.
			window.history.replaceState(null, "", `/upload?key=${encodeURIComponent(data.key)}`);
		} catch (err) {
			const error = err instanceof Error ? err.message : "Something went wrong";
			setStatus("error");
			setMessage(error);
			reportError("upload", error, { filename: file.name, size: file.size });
		}
	}

	// A video sent from the phone (QR code) is ready: same as an upload made here.
	const phoneArrived = useCallback((videoKey: string, filename: string) => {
		setStatus("done");
		setProgress(100);
		setMessage(filename);
		setKey(videoKey);
		window.history.replaceState(null, "", `/upload?key=${encodeURIComponent(videoKey)}`);
	}, []);

	// start=false: it is already running (e.g. reopened from My projects), just wait for the result.
	async function findSilences(videoKey = key, start = true) {
		if (!videoKey) return;
		setAnalyzing(true);
		setAnalysisError("");
		try {
			if (start) {
				const res = await fetch("/api/analyze", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ key: videoKey, language }),
				});
				const started = (await res.json()) as { error?: string };
				if (!res.ok) throw new Error(started.error ?? "Analysis failed");
			}

			// Long videos take Deepgram a few minutes, so keep asking until the cut list is saved.
			const giveUpAt = Date.now() + ANALYZE_GIVE_UP_MS;
			while (Date.now() < giveUpAt) {
				await wait(ANALYZE_POLL_MS);
				const poll = await fetch(`/api/analyze?key=${encodeURIComponent(videoKey)}`);
				const data = (await poll.json()) as { status?: string; error?: string };
				if (data.status === "done") return openEditor(videoKey);
				if (data.status === "failed") throw new Error(data.error ?? "Analysis failed");
			}
			throw new Error("This is taking too long. Please try again.");
		} catch (err) {
			const error = err instanceof Error ? err.message : "Analysis failed";
			setAnalysisError(error);
			reportError("find silences", error, { key: videoKey });
		} finally {
			setAnalyzing(false);
		}
	}

	const busy = status === "uploading" || analyzing;

	if (user === undefined) return <main className="min-h-screen" />;
	if (user === null) {
		return (
			<main className="font-sans mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-4">
				<SignInCard title="Sign in to upload a video" />
			</main>
		);
	}

	return (
		<main className="font-sans mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 p-4 sm:p-8">
			<AccountBar user={user} />
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

			{!key && <PhoneUpload onArrived={phoneArrived} disabled={busy} />}

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
							onClick={() => void findSilences()}
							disabled={analyzing}
							className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
						>
							{analyzing ? "Listening…" : "Find silences"}
						</button>
					</div>

					{analyzing && (
						<p className="text-sm text-foreground/70">
							👂 Listening to your video… longer videos can take a few minutes. The editor opens by itself when it&apos;s done.
						</p>
					)}

					{analysisError && <p className="text-sm text-red-500">❌ {analysisError}</p>}

				</div>
			)}
		</main>
	);
}
