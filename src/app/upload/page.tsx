"use client";

import { useState } from "react";

type Status = "idle" | "uploading" | "done" | "error";
type Cut = { start: number; end: number };
type Analysis = { editKey: string; duration: number; cuts: Cut[]; words: { text: string }[] };

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

	async function handleFile(file: File) {
		setStatus("uploading");
		setProgress(0);
		setMessage(file.name);
		setKey(null);
		setAnalysis(null);
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
		try {
			const res = await fetch("/api/analyze", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ key, language }),
			});
			const data = (await res.json()) as Analysis & { error?: string };
			if (!res.ok) throw new Error(data.error ?? "Analysis failed");
			setAnalysis(data);
		} catch (err) {
			setAnalysisError(err instanceof Error ? err.message : "Analysis failed");
		} finally {
			setAnalyzing(false);
		}
	}

	const silentSeconds = analysis ? analysis.cuts.reduce((sum, c) => sum + (c.end - c.start), 0) : 0;

	return (
		<main className="font-sans mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 p-8">
			<h1 className="text-3xl font-bold tracking-tight">Upload a video</h1>
			<p className="text-foreground/70">MP4 or MOV, up to 500 MB.</p>

			<label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-foreground/20 p-10 text-center hover:border-foreground/40">
				<span className="text-lg font-medium">Choose a video</span>
				<span className="text-sm text-foreground/60">Click here to pick a file</span>
				<input
					type="file"
					accept="video/mp4,video/quicktime"
					className="hidden"
					disabled={status === "uploading" || analyzing}
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
				</div>
			)}
		</main>
	);
}
