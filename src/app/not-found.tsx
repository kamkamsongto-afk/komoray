import type { Metadata } from "next";
import Link from "next/link";
import { HomeLogo } from "@/components/HomeLogo";

export const metadata: Metadata = { title: "Page not found · Komoray" };

// An address that leads nowhere: say so, and give a way on.
export default function NotFound() {
	return (
		<main className="font-sans mx-auto flex min-h-[80vh] max-w-xl flex-col items-center justify-center gap-5 p-6 text-center">
			<HomeLogo href="/" />
			<h1 className="text-3xl font-bold tracking-tight">Page not found</h1>
			<p className="text-foreground/70">The link may be old, or the page has moved.</p>
			<div className="flex flex-wrap justify-center gap-3">
				<Link href="/" className="inline-flex min-h-11 items-center rounded-lg bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-500">
					Go to the home page
				</Link>
				<Link href="/projects" className="inline-flex min-h-11 items-center rounded-lg border border-foreground/20 px-5 text-sm font-medium hover:bg-foreground/5">
					My projects
				</Link>
			</div>
		</main>
	);
}
