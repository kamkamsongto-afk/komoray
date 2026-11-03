import { Captions, Lock, type LucideIcon, Palette, Scissors, TextCursorInput, WandSparkles, ZoomIn } from "lucide-react";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import { WaitlistForm } from "@/components/WaitlistForm";

const STEPS: [string, string][] = [
	["Upload your take", "Straight from your computer, or send it from your phone with a QR code."],
	["Get your first cut", "Silences and the takes you said again are gone, and your script is written, with subtitles."],
	["Polish and export", "Change a word in the script and the video follows. Then make the final video."],
];

// Only what the product really does today: no numbers until they are measured with real creators.
const FEATURES: [LucideIcon, string, string][] = [
	[Scissors, "Cuts that keep your rhythm", "Removes dead air and repeated takes. Pick how tight the pace feels, and keep any part with one drag."],
	[TextCursorInput, "Edit by editing words", "Delete a sentence in your script and it leaves the video: picture, sound and subtitles together."],
	[WandSparkles, "It learns your words", "Fix a name or a brand once. Your personal dictionary fixes it for you in every video after that."],
	[Captions, "Subtitles in your style", "Five looks, your own font and colors, and what you see in the preview is what you get in the video."],
	[ZoomIn, "A second camera feel", "Slow zooms or jump cuts, framed around your face. Choose where they happen."],
	[Palette, "Your brand on every video", "Save your look once with a Brand Kit: logo, colors, banners. Every new video starts with it."],
];

export default function Home() {
	return (
		<main className="font-sans mx-auto flex min-h-screen max-w-5xl flex-col gap-20 px-5 py-6 sm:px-8">
			<header className="flex items-center justify-between">
				<span className="text-lg font-bold tracking-tight">Komoray</span>
				<ThemeToggle />
			</header>

			<section className="flex flex-col items-center gap-6 text-center">
				<p className="rounded-full border border-foreground/15 px-4 py-1 text-xs tracking-widest text-foreground/60 uppercase">AI studio for talking-head creators · Private beta</p>
				<h1 className="max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-6xl">You shoot. Komoray makes you shine.</h1>
				<p className="max-w-2xl text-lg text-foreground/70 text-balance">Your raw take goes in. A clean cut with your script, your subtitles and your brand comes out, ready for you to fine-tune.</p>
				<WaitlistForm />
			</section>

			<section className="flex flex-col gap-6">
				<h2 className="text-center text-2xl font-semibold tracking-tight">Three steps from take to finished video</h2>
				<ol className="grid gap-4 sm:grid-cols-3">
					{STEPS.map(([title, text], i) => (
						<li key={title} className="flex flex-col gap-2 rounded-2xl border border-foreground/15 p-5">
							<span className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-sm font-semibold text-background">{i + 1}</span>
							<h3 className="font-semibold">{title}</h3>
							<p className="text-sm text-foreground/70">{text}</p>
						</li>
					))}
				</ol>
			</section>

			<section className="flex flex-col gap-6">
				<h2 className="text-center text-2xl font-semibold tracking-tight">Built for creators who already publish</h2>
				<ul className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
					{FEATURES.map(([Icon, title, text]) => (
						<li key={title} className="flex flex-col gap-1.5">
							<Icon className="h-5 w-5 text-blue-600" aria-hidden />
							<h3 className="font-semibold">{title}</h3>
							<p className="text-sm text-foreground/70">{text}</p>
						</li>
					))}
				</ul>
			</section>

			<section className="flex flex-col items-center gap-3 rounded-2xl bg-foreground/5 p-8 text-center">
				<Lock className="h-5 w-5 text-foreground/60" aria-hidden />
				<h2 className="text-xl font-semibold tracking-tight">Your videos stay yours</h2>
				<p className="max-w-xl text-sm text-foreground/70">We never sell your data, and we never use your videos to train AI models.</p>
			</section>

			<footer className="mt-auto flex flex-wrap justify-center gap-4 pb-2 text-sm text-foreground/50">
				<Link href="/privacy">Privacy</Link>
				<Link href="/terms">Terms</Link>
				<a href="mailto:hello@komoray.com">hello@komoray.com</a>
			</footer>
		</main>
	);
}
