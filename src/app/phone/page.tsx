"use client";

import { useEffect, useState } from "react";
import { putWithProgress } from "@/lib/put-file";
import { reportError } from "@/lib/report";

type Status = "idle" | "uploading" | "done" | "error";

// Opened on a phone from the QR code on the computer's upload page. No sign-in here: the link
// itself allows one video, for 15 minutes, and the computer then opens it (see /api/phone).
export default function PhonePage() {
	const [token, setToken] = useState<string | null>(null);
	const [status, setStatus] = useState<Status>("idle");
	const [progress, setProgress] = useState(0);
	const [message, setMessage] = useState("");

	useEffect(() => setToken(new URLSearchParams(window.location.search).get("t")), []);

	const send = (body: object) =>
		fetch("/api/phone", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: token, ...body }) }).then(
			async (res) => {
				const data = (await res.json().catch(() => ({}))) as { uploadUrl?: string; error?: string };
				if (!res.ok) throw new Error(data.error ?? "Something went wrong");
				return data;
			},
		);

	async function handleFile(file: File) {
		setStatus("uploading");
		setProgress(0);
		setMessage(file.name);
		try {
			const { uploadUrl } = await send({ action: "upload", filename: file.name, contentType: file.type, size: file.size });
			await putWithProgress(uploadUrl!, file, setProgress);
			await send({ action: "uploaded" });
			setStatus("done");
		} catch (err) {
			const error = err instanceof Error ? err.message : "Something went wrong";
			setStatus("error");
			setMessage(error);
			reportError("phone upload", error, { filename: file.name, size: file.size });
		}
	}

	return (
		<main className="font-sans mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
			<h1 className="text-2xl font-bold tracking-tight">Send a video to Komoray</h1>
			{!token ? (
				<p className="text-foreground/70">Scan the QR code on your computer&apos;s upload page to send a video from this phone.</p>
			) : status === "done" ? (
				<div className="flex flex-col gap-2 rounded-2xl border border-green-600/40 bg-green-600/5 p-6">
					<p className="text-lg font-medium">✅ Sent!</p>
					<p className="text-foreground/70">Your video is on your computer now. You can put your phone away.</p>
				</div>
			) : (
				<>
					<p className="text-foreground/70">Pick a video from your phone. MP4 or MOV, up to 500 MB. It goes straight to your computer.</p>
					<label
						className={`flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-foreground/20 p-10 text-center ${
							status === "uploading" ? "opacity-50" : "cursor-pointer active:bg-foreground/5"
						}`}
					>
						<span className="text-lg font-medium">🎬 Choose a video</span>
						<input
							type="file"
							accept="video/mp4,video/quicktime"
							className="hidden"
							disabled={status === "uploading"}
							onChange={(e) => {
								const file = e.target.files?.[0];
								if (file) void handleFile(file);
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
								{status === "uploading" && `Sending ${message}… ${progress}% · keep this page open`}
								{status === "error" && `❌ ${message}`}
							</p>
						</div>
					)}
				</>
			)}
		</main>
	);
}
