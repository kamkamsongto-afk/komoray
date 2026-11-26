import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { AfterVideo, HeroDrop, LoopVideo } from "@/components/HomeMedia";
import { CutoutCard, FrameCard, HelloWord, LayoutCard, LooksCard, PaceCard, ScriptDemo, ShapeCard, WordsDemo } from "@/components/LandingDemos";
import { WaitlistForm } from "@/components/WaitlistForm";
import { SITE_DESCRIPTION, SITE_TITLE, shareCard } from "@/lib/page-meta";
import "./landing.css";

const STEPS: [string, string, string][] = [
	["01", "Shoot", "Upload from your computer, or send it from your phone with a QR code."],
	["02", "Review", "Silences and repeated takes are marked. Your script and subtitles are ready. Undo anything."],
	["03", "Make video", "Preview it, press Make video, and download the file. You make the final call."],
];

// The home page's own address, so its copies (www, the workers.dev one) count as one page.
export const metadata: Metadata = { alternates: { canonical: "/" }, ...shareCard(SITE_TITLE, SITE_DESCRIPTION, "/") };

// Only what the product really does today: no numbers until they are measured with real creators.
// Every picture and clip here was filmed by the coach (20 Nov, for Paddle's review: no AI-made pictures).
export default function Home() {
	return (
		<main className="k-root">
			<div className="k-top" id="top">
				<nav className="k-nav" aria-label="Main">
					<a className="k-logo" href="#top">
						<Image src="/logo.svg" alt="Komoray" width={322} height={70} unoptimized priority />
					</a>
					<div className="k-navlinks">
						<a href="#script">Script</a>
						<a href="#words">My words</a>
						<a href="#effects">Effects</a>
						<a href="#studio">Studio</a>
						<Link href="/pricing">Pricing</Link>
						<a className="k-pill" href="#access">
							Get early access
						</a>
					</div>
				</nav>
				{/* Left: drop a video to try it. Right: the coach's raw take, and the same take cut with Komoray (20 Nov). */}
				<section className="k-hero">
					<div className="k-herotext">
						<h1 className="k-herohead">You shoot. Komoray makes you shine.</h1>
						<p className="k-herolead">The AI studio for people who talk to camera. Your raw take goes in. A clean first cut, script and subtitles come out, ready for your final call.</p>
						<HeroDrop />
						<Link className="k-herolink" href="/pricing">
							See pricing
						</Link>
					</div>
					<div className="k-heroclips">
						<figure className="k-clip k-clip-before">
							<div className="k-clipbox">
								<LoopVideo name="before" />
							</div>
							<figcaption className="k-mono">Before · raw take</figcaption>
						</figure>
						<figure className="k-clip k-clip-after">
							<div className="k-clipbox">
								<AfterVideo />
							</div>
							<figcaption className="k-mono">After · cut with Komoray</figcaption>
						</figure>
					</div>
				</section>
			</div>

			<section className="k-sec k-light" id="script">
				<div className="k-wrap">
					<p className="k-mono k-eyebrow">Try it. Tap any word.</p>
					<h2 className="k-h2">
						Change the words.
						<br />
						The video follows.
					</h2>
					<ScriptDemo />
				</div>
			</section>

			{/* "Your face. Your room. Your voice." is hidden (coach 20 Nov): its pictures were AI-made. */}
			<section className="k-sec" id="words">
				<div className="k-wrap k-words">
					<div>
						<p className="k-mono k-eyebrow">My words</p>
						<h2 className="k-h2">Fix it once.</h2>
						<p className="k-lead2">Names, brands, the words only you use. Correct one, and Komoray remembers it for your next video. Your words stay yours.</p>
					</div>
					<WordsDemo />
				</div>
			</section>

			<section className="k-sec" id="effects" style={{ paddingTop: 0 }}>
				<div className="k-wrap">
					<p className="k-mono k-eyebrow">New in the studio</p>
					<h2 className="k-h2">
						Step out of
						<br />
						the <span className="k-lime">rectangle.</span>
					</h2>
					<div className="k-grid">
						<FrameCard />
						<CutoutCard />
						<LayoutCard />
					</div>
				</div>
			</section>

			<section className="k-sec" id="studio" style={{ paddingTop: 0 }}>
				<div className="k-wrap">
					<p className="k-mono k-eyebrow">The studio</p>
					<h2 className="k-h2">
						Made for people
						<br />
						who talk to camera.
					</h2>
					<div className="k-grid">
						<LooksCard />
						<PaceCard />
						<ShapeCard />
						<article className="k-card">
							<div className="k-vis k-zoom">
								<div className="k-frame">
									<LoopVideo name="zoom" />
								</div>
							</div>
							<h3>A second camera feel</h3>
							<p>Slow zooms or jump cuts, framed around your face.</p>
						</article>
						<article className="k-card">
							<div className="k-vis">
								<div className="k-frame">
									<LoopVideo name="banner" />
									<div className="k-bannerpop">Link in bio</div>
								</div>
							</div>
							<h3>Banners with motion</h3>
							<p>Price, call to action or follow, in your brand.</p>
						</article>
						<article className="k-card">
							<div className="k-vis">
								<HelloWord />
							</div>
							{/* Translation is hidden (coach 18 Nov), so only what comes from the voice: LANGUAGES in lib/languages.ts. */}
							<h3>Subtitles from your own voice</h3>
							<p>Made from what you say, in 16 languages. Download them as .srt too.</p>
						</article>
					</div>
				</div>
			</section>

			<section className="k-sec k-light">
				<div className="k-wrap">
					<h2 className="k-h2">
						From raw take
						<br />
						to your final call.
					</h2>
					<div className="k-steps">
						{STEPS.map(([number, title, text]) => (
							<div key={title} className="k-step">
								<div className="k-mono">{number}</div>
								<h3>{title}</h3>
								<p>{text}</p>
							</div>
						))}
					</div>
				</div>
			</section>

			<section className="k-final" id="access">
				<div className="k-wrap">
					<h2 className="k-h1">
						Your next take
						<br />
						is <span className="k-lime">waiting.</span>
					</h2>
					<div className="k-finalform">
						{/* Still invite only until PLANS_LIVE (lib/plans.ts), but it reads as a product about to sell, for Paddle's check (coach 19 Nov). */}
						<p className="k-promise">In beta now. Open to everyone on December 25. Your videos stay yours. We never sell your data, and we never use your videos to train AI models.</p>
						<WaitlistForm />
					</div>
					<footer className="k-foot">
						<div>
							<Link href="/pricing">Pricing</Link>
							<Link href="/refund">Refund Policy</Link>
							<Link href="/privacy">Privacy</Link>
							<Link href="/terms">Terms</Link>
							<a href="mailto:hello@komoray.com">hello@komoray.com</a>
						</div>
						<div style={{ display: "flex", alignItems: "center" }}>Built in public from Thailand</div>
					</footer>
				</div>
			</section>
		</main>
	);
}
