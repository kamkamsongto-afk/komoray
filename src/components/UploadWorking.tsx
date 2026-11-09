"use client";

import { Check } from "lucide-react";
import { useEffect, useState } from "react";

type Stage = "upload" | "listen" | "open";

const STEPS: { id: Stage; name: string }[] = [
	{ id: "upload", name: "Upload" },
	{ id: "listen", name: "Listen" },
	{ id: "open", name: "AI studio" },
];
const TITLES: Record<Stage, string> = {
	upload: "Uploading your video",
	listen: "Komoray is listening to your video",
	open: "Opening your AI studio",
};

// Shown from the moment Start is pressed until the AI studio opens, so a long wait doesn't look like a frozen
// page (the coach, 9 Nov: people would leave or refresh). The bar shows a real percentage only for the upload:
// while listening nobody knows how far along it is, so it just moves, and the clock shows time passing.
export function UploadWorking({ stage, progress, fileName, onCancel }: { stage: Stage; progress: number; fileName: string; onCancel?: () => void }) {
	const [seconds, setSeconds] = useState(0);
	useEffect(() => {
		const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
		return () => clearInterval(timer);
	}, []);
	const at = STEPS.findIndex((s) => s.id === stage);

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-background p-6 text-foreground" role="status" aria-live="polite">
			<style>{"@keyframes komoray-working { from { transform: translateX(-100%); } to { transform: translateX(350%); } }"}</style>
			<div className="flex w-full max-w-lg flex-col items-center gap-7 text-center">
				<ol className="flex items-center gap-2 text-sm">
					{STEPS.map((step, i) => (
						<li key={step.id} className="flex items-center gap-2">
							{i > 0 && <span className={`h-px w-6 sm:w-10 ${i <= at ? "bg-blue-500" : "bg-foreground/20"}`} aria-hidden />}
							<span
								className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
									i < at ? "bg-blue-600 text-white" : i === at ? "animate-pulse bg-blue-600 text-white motion-reduce:animate-none" : "bg-foreground/10 text-foreground/50"
								}`}
							>
								{i < at ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
							</span>
							<span className={i === at ? "font-medium" : "text-foreground/50"}>{step.name}</span>
						</li>
					))}
				</ol>

				<div className="flex flex-col gap-2">
					<h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{TITLES[stage]}</h1>
					<p className="text-foreground/70">You don&apos;t need to do anything. Your AI studio opens by itself when it&apos;s ready.</p>
				</div>

				<div className="h-3 w-full overflow-hidden rounded-full bg-foreground/10">
					{stage === "upload" ? (
						<div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
					) : (
						<div className="h-full w-2/5 rounded-full bg-blue-600 motion-safe:animate-[komoray-working_1.5s_ease-in-out_infinite]" />
					)}
				</div>

				<div className="flex w-full flex-col gap-1 text-sm text-foreground/60">
					<p className="truncate">{fileName}</p>
					<p>
						{stage === "upload" && `${progress}% · `}
						Working for {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
						{stage !== "open" && " · Longer videos can take a few minutes"}
					</p>
					<p>{stage === "upload" ? "Please keep this tab open while it uploads." : "You can use other tabs while you wait."}</p>
				</div>

				{onCancel && (
					<button type="button" onClick={onCancel} className="min-h-11 rounded-lg px-4 text-sm text-foreground/60 underline underline-offset-2 hover:text-foreground">
						Cancel
					</button>
				)}
			</div>
		</div>
	);
}
