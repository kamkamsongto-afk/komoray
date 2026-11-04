"use client";

import { useState } from "react";

// The home page's sign-up for early access (/api/waitlist).
export function WaitlistForm() {
	const [email, setEmail] = useState("");
	const [website, setWebsite] = useState(""); // never seen by people: only bots fill it in
	const [state, setState] = useState<"idle" | "sending" | "done">("idle");
	const [error, setError] = useState("");

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		setState("sending");
		setError("");
		const res = await fetch("/api/waitlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, website }) }).catch(() => null);
		const data = (await res?.json().catch(() => ({}))) as { error?: string };
		if (res?.ok) return setState("done");
		setState("idle");
		setError(data?.error ?? "That didn't go through. Please try again.");
	}

	if (state === "done") return <p className="k-done">You&apos;re on the list. We&apos;ll email you when your spot opens.</p>;
	return (
		<form onSubmit={submit} className="k-form">
			<div className="k-formrow">
				<input
					type="email"
					required
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					placeholder="you@yourchannel.com"
					aria-label="Your email"
					autoComplete="email"
					className="k-input"
				/>
				<input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden value={website} onChange={(e) => setWebsite(e.target.value)} className="absolute -left-[9999px] h-0 w-0 opacity-0" />
				<button type="submit" disabled={state === "sending"} className="k-cta">
					{state === "sending" ? "Joining…" : "Get early access"}
				</button>
			</div>
			{error && <p className="k-formerror">{error}</p>}
			<p className="k-formnote">
				We only use your email to invite you. See our <a href="/privacy">Privacy Policy</a>.
			</p>
		</form>
	);
}
