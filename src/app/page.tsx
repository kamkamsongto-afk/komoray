import Image from "next/image";
import Link from "next/link";
import { HelloWord, LooksCard, PaceCard, ScriptDemo, ShapeCard, WordsDemo } from "@/components/LandingDemos";
import { WaitlistForm } from "@/components/WaitlistForm";
import "./landing.css";

const SUBTITLES = ["Your raw take goes in.", "The silences leave.", "Your script stays.", "You make the final call."];
const ROOMS = ["home", "city", "mountain", "kitchen", "country"];
const STEPS: [string, string, string][] = [
	["01", "Shoot", "Upload from your computer, or send it from your phone with a QR code."],
	["02", "Review", "Silences and repeated takes are marked. Your script and subtitles are ready. Undo anything."],
	["03", "Make video", "Preview it, press Make video, and download the file. You make the final call."],
];

function Photo({ name, priority }: { name: string; priority?: boolean }) {
	return <Image src={`/landing/${name}.webp`} alt="" width={448} height={896} unoptimized priority={priority} />;
}

// Only what the product really does today: no numbers until they are measured with real creators.
export default function Home() {
	return (
		<main className="k-root">
			<div className="k-top" id="top">
				<nav className="k-nav" aria-label="Main">
					<a className="k-logo" href="#top">
						Komoray
					</a>
					<div className="k-navlinks">
						<a href="#script">Script</a>
						<a href="#words">My words</a>
						<a href="#studio">Studio</a>
						<a className="k-pill" href="#access">
							Get early access
						</a>
					</div>
				</nav>
				<section className="k-hero">
					<div className="k-scene" aria-hidden>
						<div className="k-rays" />
						<div className="k-bloom" />
						<div className="k-shade" />
						<div className="k-stage">
							<div className="k-phone k-float k-float-a">
								<Photo name="city" priority />
							</div>
							<div className="k-phone k-float k-float-b">
								<Photo name="home" priority />
								<div className="k-subs">
									{SUBTITLES.map((line) => (
										<div key={line} className="k-subline">
											<span>{line}</span>
										</div>
									))}
								</div>
							</div>
							<div className="k-phone k-float k-float-c">
								<Photo name="country" priority />
							</div>
						</div>
					</div>
					<div className="k-mono k-note">Illustrative images, not customers</div>
					<div className="k-herotext">
						<h1 className="k-herohead">You shoot. Komoray makes you shine.</h1>
						<p className="k-herolead">The AI studio for people who talk to camera. Your raw take goes in. A clean first cut, script and subtitles come out, ready for your final call.</p>
						<a className="k-herocta" href="#access">
							Get early access
							<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
								<path d="M5 2l5 5-5 5" />
							</svg>
						</a>
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

			<section className="k-sec">
				<div className="k-wrap">
					<p className="k-mono k-eyebrow">Wherever you film</p>
					<h2 className="k-h2">
						Your face. Your room.
						<br />
						Your voice.
					</h2>
					<div className="k-rooms">
						{ROOMS.map((name) => (
							<div key={name} className="k-room">
								<Photo name={name} />
							</div>
						))}
					</div>
					<p className="k-mono k-small">Illustrative images, not customers.</p>
				</div>
			</section>

			<section className="k-sec" id="words" style={{ paddingTop: 0 }}>
				<div className="k-wrap k-words">
					<div>
						<p className="k-mono k-eyebrow">My words</p>
						<h2 className="k-h2">Fix it once.</h2>
						<p className="k-lead2">Names, brands, the words only you use. Correct one, and Komoray remembers it for your next video. Your words stay yours.</p>
					</div>
					<WordsDemo />
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
									<Photo name="kitchen" />
								</div>
							</div>
							<h3>A second camera feel</h3>
							<p>Slow zooms or jump cuts, framed around your face.</p>
						</article>
						<article className="k-card">
							<div className="k-vis">
								<div className="k-frame">
									<Photo name="city" />
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
							<h3>Subtitles in 33 languages</h3>
							<p>Translate your subtitles and download them as .srt.</p>
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
						<p className="k-promise">Private beta. Your videos stay yours. We never sell your data, and we never use your videos to train AI models.</p>
						<WaitlistForm />
					</div>
					<footer className="k-foot">
						<div>
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
