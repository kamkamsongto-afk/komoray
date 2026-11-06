"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AccountBar, SignInCard, useUser } from "@/components/Account";
import { BetaWelcome } from "@/components/BetaWelcome";
import { LanguagePicker } from "@/components/LanguagePicker";
import { PhoneUpload } from "@/components/PhoneUpload";
import { UploadOptions } from "@/components/UploadOptions";
import { WaitingForInvite } from "@/components/WaitingForInvite";
import type { AccessStatus } from "@/lib/access";
import { browserLanguage, isLanguage } from "@/lib/languages";
import { putWithProgress } from "@/lib/put-file";
import { reportError } from "@/lib/report";
import { DEFAULT_OPTIONS, type UploadOptions as Options } from "@/lib/upload-options";

type Status = "idle" | "uploading" | "done" | "error";
type Access = AccessStatus & { email: string };

const ANALYZE_POLL_MS = 3000;
const ANALYZE_GIVE_UP_MS = 30 * 60 * 1000;
const LANGUAGE_KEY = "komoray-language"; // the spoken language picked last time (this browser only)

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The file's length in whole minutes, as the browser reads it. null = this browser can't tell.
function minutesIn(file: File) {
	return new Promise<number | null>((resolve) => {
		const video = document.createElement("video");
		const url = URL.createObjectURL(file);
		const finish = (minutes: number | null) => {
			URL.revokeObjectURL(url);
			resolve(minutes);
		};
		video.preload = "metadata";
		video.onloadedmetadata = () => finish(Number.isFinite(video.duration) ? Math.ceil(video.duration / 60) : null);
		video.onerror = () => finish(null);
		video.src = url;
	});
}

function tooLongFor(minutes: number | null, access: Access) {
	if (minutes === null) return null;
	if (minutes > access.perVideo) return `This video is ${minutes} minutes long. During the beta, each video can be up to ${access.perVideo} minutes.`;
	if (minutes > access.left) return `This video needs ${minutes} minutes and you have ${access.left} left this month. Your minutes renew on ${access.resets}.`;
	return null;
}

export default function UploadPage() {
	const user = useUser();
	const [status, setStatus] = useState<Status>("idle");
	const [progress, setProgress] = useState(0);
	const [message, setMessage] = useState("");
	const [key, setKey] = useState<string | null>(null);

	const [language, setLanguageState] = useState("en");
	// Deepgram can't tell Thai by itself (tried: a Thai clip came back as English, empty), so the
	// language stays a choice: remembered from last time, else the browser's language.
	useEffect(() => {
		let saved: string | null = null;
		try {
			saved = localStorage.getItem(LANGUAGE_KEY);
		} catch {}
		setLanguageState(isLanguage(saved) ? saved : browserLanguage(navigator.language));
	}, []);
	const setLanguage = (value: string) => {
		setLanguageState(value);
		try {
			localStorage.setItem(LANGUAGE_KEY, value);
		} catch {}
	};
	// The default set with the star (api/prefs, the same on every device) wins over the last one picked here.
	const [defaultLanguage, setDefaultLanguageState] = useState<string | null>(null);
	useEffect(() => {
		if (!user) return;
		void (async () => {
			const res = await fetch("/api/prefs").catch(() => null);
			const data = res?.ok ? ((await res.json()) as { language?: string | null }) : null;
			if (!data?.language) return;
			setDefaultLanguageState(data.language);
			setLanguageState(data.language);
		})();
	}, [user]);
	const setDefaultLanguage = (code: string | null) => {
		setDefaultLanguageState(code);
		if (code) setLanguage(code);
		void fetch("/api/prefs", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ language: code }) }).catch(() => {});
	};

	// What to do with the video (components/UploadOptions.tsx). The window opens when a video arrives.
	const [options, setOptions] = useState<Options>(DEFAULT_OPTIONS);
	const [showOptions, setShowOptions] = useState(false);
	const [queued, setQueued] = useState(false); // Start was pressed before the upload finished
	const queuedRef = useRef(false);
	// Read when Find silences starts, which can be after the upload that was running when Start was pressed.
	const choice = useRef({ language, options });
	useEffect(() => {
		choice.current = { language, options };
	});
	const queue = (on: boolean) => {
		queuedRef.current = on;
		setQueued(on);
	};
	const [analyzing, setAnalyzing] = useState(false);
	const [analysisError, setAnalysisError] = useState("");
	const [dragging, setDragging] = useState(false);
	const [again, setAgain] = useState(false); // from the editor: listen to this video again, in another language
	const [access, setAccess] = useState<Access | null>(null);

	const loadAccess = useCallback(async () => {
		const res = await fetch("/api/access").catch(() => null);
		if (res?.ok) setAccess((await res.json()) as Access);
	}, []);
	useEffect(() => {
		if (user) void loadAccess();
	}, [user, loadAccess]);

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
			const listenAgain = new URLSearchParams(window.location.search).has("again");
			if (data.status === "done" && !listenAgain) return openEditor(saved);
			setAgain(listenAgain && data.status === "done");
			setKey(saved);
			setStatus("done");
			setProgress(100);
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
		queue(false);

		// Say so now instead of after a long upload. The server checks again before anything is paid for.
		const tooLong = access && !access.unlimited ? tooLongFor(await minutesIn(file), access) : null;
		if (tooLong) {
			setStatus("error");
			setMessage(tooLong);
			return;
		}
		setShowOptions(true);

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
			if (queuedRef.current) {
				queue(false);
				setShowOptions(false);
				void findSilences(data.key);
			}
		} catch (err) {
			const error = err instanceof Error ? err.message : "Something went wrong";
			queue(false);
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
		setShowOptions(true);
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
					// Listen again keeps the choices made for this video the first time (the server has them).
					body: JSON.stringify({ key: videoKey, language: choice.current.language, ...(!again && { options: choice.current.options }) }),
				});
				const started = (await res.json()) as { error?: string };
				if (!res.ok) throw new Error(started.error ?? "Analysis failed");
				void loadAccess();
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

	if (access && !access.allowed) return <WaitingForInvite user={user} />;

	return (
		<main className="font-sans mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 p-4 sm:p-8">
			<AccountBar user={user} />
			<h1 className="text-3xl font-bold tracking-tight">Upload a video</h1>
			<p className="text-foreground/70">
				MP4 or MOV, up to 500 MB{access && !access.unlimited && ` and ${access.perVideo} minutes`}.
				{access && !access.unlimited && (
					<span className="mt-1 block font-medium text-foreground">
						{access.left} of {access.limit} minutes left this month
						<span className="font-normal text-foreground/60"> · renews {access.resets}</span>
					</span>
				)}
			</p>
			{access && !access.unlimited && !showOptions && <BetaWelcome access={access} />}
			{showOptions && status !== "idle" && (
				<UploadOptions
					options={options}
					onOptionsChange={setOptions}
					language={language}
					onLanguageChange={setLanguage}
					defaultLanguage={defaultLanguage}
					onSetDefaultLanguage={setDefaultLanguage}
					upload={{ status: status === "done" ? "done" : status === "error" ? "error" : "uploading", progress, queued }}
					onStart={() => {
						if (status === "done" && key) {
							setShowOptions(false);
							void findSilences(key);
						} else queue(true);
					}}
					onClose={() => {
						queue(false);
						setShowOptions(false);
					}}
				/>
			)}

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
				<span className="pointer-events-none text-lg font-medium">{dragging ? "Release to upload" : "Drop your video here"}</span>
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
						{status === "done" && `Uploaded! Saved as ${message}`}
						{status === "error" && message}
					</p>
				</div>
			)}

			{key && (
				<div className="flex flex-col gap-4 rounded-2xl border border-foreground/15 p-6">
					<div className="flex flex-wrap items-center gap-3">
						<span className="text-sm text-foreground/70">Spoken language</span>
						<LanguagePicker value={language} onChange={setLanguage} defaultCode={defaultLanguage} onSetDefault={setDefaultLanguage} disabled={analyzing} />
						<button
							onClick={() => void findSilences()}
							disabled={analyzing}
							className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
						>
							{analyzing ? "Listening…" : again ? "Listen again" : "Find silences"}
						</button>
					</div>

					{!again && !analyzing && (
						<button type="button" onClick={() => setShowOptions(true)} className="w-fit text-sm text-foreground/60 underline underline-offset-2 hover:text-foreground">
							Choose what Komoray does
						</button>
					)}

					{again && !analyzing && <p className="text-sm text-foreground/70">This writes the script again and starts over: your fixes, cuts and subtitle settings on this video will be replaced.</p>}

					{analyzing && (
						<p className="text-sm text-foreground/70">
							Listening to your video… longer videos can take a few minutes. The editor opens by itself when it&apos;s done.
						</p>
					)}

					{analysisError && <p className="text-sm text-red-500">{analysisError}</p>}

				</div>
			)}
		</main>
	);
}
