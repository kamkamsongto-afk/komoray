"use client";

import type { User } from "@supabase/supabase-js";
import { useState } from "react";
import { AccountBar } from "@/components/Account";

// What someone signed in without an invite sees instead of the upload page.
export function WaitingForInvite({ user }: { user: User }) {
	const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

	async function ask() {
		setState("sending");
		const res = await fetch("/api/waitlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: user.email, website: "" }) }).catch(() => null);
		setState(res?.ok ? "done" : "error");
	}

	return (
		<main className="font-sans mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 p-4 sm:p-8">
			<AccountBar user={user} />
			<h1 className="text-3xl font-bold tracking-tight">You&apos;re almost in</h1>
			<p className="text-foreground/70">
				Komoray is invite-only while we test it with a small group of creators. We&apos;ll email <span className="font-medium text-foreground">{user.email}</span> when your spot opens.
			</p>
			{state === "done" ? (
				<p className="rounded-xl border border-foreground/15 px-5 py-3 font-medium">You&apos;re on the list.</p>
			) : (
				<button onClick={() => void ask()} disabled={state === "sending"} className="w-fit rounded-lg bg-foreground px-5 py-2.5 font-medium text-background disabled:opacity-60">
					{state === "sending" ? "Joining…" : "Ask for an invite"}
				</button>
			)}
			{state === "error" && <p className="text-sm text-red-600">That didn&apos;t go through. Please try again.</p>}
			<p className="text-sm text-foreground/60">Already invited with another email? Sign out and use that Google account.</p>
		</main>
	);
}
