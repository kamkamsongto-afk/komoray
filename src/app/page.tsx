import Link from "next/link";

export default function Home() {
	return (
		<main className="font-sans relative flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
			<h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
				Komoray <span className="font-normal text-foreground/70">— AI Studio for Talking Heads</span>
			</h1>
			<p className="mt-4 rounded-full border border-foreground/15 px-5 py-2 text-sm uppercase tracking-widest text-foreground/60">
				Coming soon
			</p>
			<footer className="absolute bottom-6 flex gap-4 text-sm text-foreground/50">
				<Link href="/privacy">Privacy</Link>
				<Link href="/terms">Terms</Link>
			</footer>
		</main>
	);
}
