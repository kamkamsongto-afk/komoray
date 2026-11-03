"use client";

import { useState } from "react";

type Pay = "yes" | "maybe" | "no";

const PAY: [Pay, string][] = [
	["yes", "Yes"],
	["maybe", "Maybe"],
	["no", "Not yet"],
];

// Three quick questions and room for anything else. Any of them can be left out.
export function FeedbackForm({ videoKey }: { videoKey?: string }) {
	const [easy, setEasy] = useState<number | null>(null);
	const [result, setResult] = useState<number | null>(null);
	const [pay, setPay] = useState<Pay | null>(null);
	const [note, setNote] = useState("");
	const [state, setState] = useState<"idle" | "sending" | "done">("idle");
	const [error, setError] = useState("");

	async function send(e: React.FormEvent) {
		e.preventDefault();
		setState("sending");
		setError("");
		const res = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ easy, result, pay, note, key: videoKey }) }).catch(() => null);
		const data = (await res?.json().catch(() => ({}))) as { error?: string };
		if (res?.ok) return setState("done");
		setState("idle");
		setError(data?.error ?? "That didn't go through. Please try again.");
	}

	const scale = (label: string, low: string, high: string, value: number | null, set: (n: number) => void) => (
		<fieldset className="flex flex-col gap-1.5">
			<legend className="text-sm font-medium">{label}</legend>
			<div className="flex items-center gap-1.5">
				<span className="w-14 text-xs text-foreground/60">{low}</span>
				{[1, 2, 3, 4, 5].map((n) => (
					<button
						key={n}
						type="button"
						aria-pressed={value === n}
						onClick={() => set(n)}
						className={`h-9 w-9 rounded-lg border text-sm ${value === n ? "border-blue-600 bg-blue-600 text-white" : "border-foreground/20 hover:bg-foreground/5"}`}
					>
						{n}
					</button>
				))}
				<span className="w-14 text-right text-xs text-foreground/60">{high}</span>
			</div>
		</fieldset>
	);

	if (state === "done") return <p className="rounded-lg bg-foreground/5 p-3 text-sm font-medium">Thank you! We read every answer.</p>;
	return (
		<form onSubmit={send} className="flex flex-col gap-4">
			{scale("How easy was Komoray to use?", "Hard", "Easy", easy, setEasy)}
			{scale("How happy are you with the video?", "Unhappy", "Happy", result, setResult)}
			<fieldset className="flex flex-col gap-1.5">
				<legend className="text-sm font-medium">Would you pay for this?</legend>
				<div className="flex gap-1.5">
					{PAY.map(([value, name]) => (
						<button
							key={value}
							type="button"
							aria-pressed={pay === value}
							onClick={() => setPay(value)}
							className={`rounded-lg border px-3 py-1.5 text-sm ${pay === value ? "border-blue-600 bg-blue-600 text-white" : "border-foreground/20 hover:bg-foreground/5"}`}
						>
							{name}
						</button>
					))}
				</div>
			</fieldset>
			<label className="flex flex-col gap-1.5 text-sm font-medium">
				What got in your way, or what do you wish it did?
				<textarea value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} rows={3} className="rounded-lg border border-foreground/20 bg-background p-2 font-normal" />
			</label>
			{error && <p className="text-sm text-red-600">{error}</p>}
			<button type="submit" disabled={state === "sending"} className="self-start rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60">
				{state === "sending" ? "Sending…" : "Send feedback"}
			</button>
		</form>
	);
}
