"use client";

import Link from "next/link";
import { useEffect } from "react";
import { reportError } from "@/lib/report";

// What a page that crashed shows instead of Next.js's bare "This page couldn't load" (coach, 18 Nov: it made people
// fear their work was gone). Changes in the AI studio are saved within about a second, so it can say so.
// It also reports the error to logs/ (the admin page), with the video's key from the address, so it can be fixed:
// the built-in page reported nothing.
export function PageCrash({ error, retry }: { error: unknown; retry: () => void }) {
	useEffect(() => {
		const e = error instanceof Error ? error : new Error(String(error));
		const where = `${window.location.pathname} ${e.message}`;
		const stack = (e.stack ?? "").split("\n").slice(1, 6).join(" | ");
		const key = new URLSearchParams(window.location.search).get("key");
		reportError("page crash", `${where} :: ${stack}`, { key, filename: (error as { digest?: string })?.digest ?? "" });
		console.error(error);
	}, [error]);

	return (
		<main className="font-sans mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
			<h1 className="text-2xl font-bold tracking-tight">Something went wrong on this page</h1>
			<p className="text-foreground/75">Your video and your edits are safe: everything is saved as you work. Try again, or open your project from My projects.</p>
			<div className="flex flex-wrap gap-3">
				<button onClick={() => retry()} className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700">
					Try again
				</button>
				<button onClick={() => window.location.reload()} className="rounded-lg border border-foreground/20 px-4 py-2 font-medium hover:bg-foreground/5">
					Reload the page
				</button>
				<Link href="/projects" className="rounded-lg px-4 py-2 font-medium text-foreground/70 underline hover:text-foreground">
					My projects
				</Link>
			</div>
			<p className="text-xs text-foreground/50">We&apos;ve been told about this, so we can fix it.</p>
		</main>
	);
}
