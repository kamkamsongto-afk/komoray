"use client";

import { Download, Plus, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FeedbackForm } from "./FeedbackForm";

const FEEDBACK_SENT = "komoray.feedbackAsked"; // asks once in this browser; /feedback is always there

// The finished video: watch it, download it, then on to the next one or back to editing.
export function VideoReady({ videoUrl, downloadUrl, videoKey, onClose }: { videoUrl: string; downloadUrl?: string; videoKey: string; onClose: () => void }) {
	const closeRef = useRef<HTMLButtonElement>(null);
	const [askFeedback, setAskFeedback] = useState(false);

	useEffect(() => {
		closeRef.current?.focus();
		try {
			if (!localStorage.getItem(FEEDBACK_SENT)) {
				setAskFeedback(true);
				localStorage.setItem(FEEDBACK_SENT, "1");
			}
		} catch {
			// no storage: they can still find it at /feedback
		}
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose]);

	return (
		<div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={onClose}>
			<div role="dialog" aria-modal="true" aria-label="Your video is ready" onClick={(e) => e.stopPropagation()} className="my-auto flex w-full max-w-3xl flex-col gap-4 rounded-2xl bg-background p-5 shadow-2xl">
				<div className="flex items-center justify-between gap-3">
					<h2 className="text-xl font-semibold tracking-tight">Your video is ready</h2>
					<button ref={closeRef} onClick={onClose} aria-label="Close" title="Keep editing" className="rounded-lg p-1.5 text-foreground/50 hover:bg-foreground/5 hover:text-foreground">
						<X className="h-5 w-5" aria-hidden />
					</button>
				</div>
				<div className={`grid gap-5 ${askFeedback ? "sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]" : ""}`}>
					<div className="flex flex-col gap-3">
						<video src={videoUrl} controls playsInline preload="metadata" className="max-h-[60vh] w-full rounded-lg bg-black" />
						<div className="flex flex-wrap items-center gap-2">
							<a href={downloadUrl ?? videoUrl} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
								<Download className="h-4 w-4 shrink-0" aria-hidden />
								Download video
							</a>
							<Link href="/upload" className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/20 px-3 py-2 text-sm hover:bg-foreground/5">
								<Plus className="h-4 w-4 shrink-0" aria-hidden />
								New video
							</Link>
							<button onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-foreground/70 hover:bg-foreground/5 hover:text-foreground">
								Keep editing
							</button>
						</div>
						<p className="text-xs text-foreground/50">Changed something after this? Press Make video again. Download links last 1 hour: reopen this page for a fresh one.</p>
					</div>
					{askFeedback && <FeedbackForm videoKey={videoKey} />}
				</div>
			</div>
		</div>
	);
}
