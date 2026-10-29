import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Terms of Service · Komoray" };

const CONTACT = "hello@komoray.com";

export default function TermsPage() {
	return (
		<LegalPage title="Terms of Service" updated="October 30, 2026">
			<p>By using Komoray, you agree to these terms. They are short on purpose.</p>

			<h2>Beta</h2>
			<p>
				Komoray is in beta. It is free for now, it may change, and it may sometimes break. Always keep your own copy of your
				original videos. During the beta, videos are deleted after 14 days.
			</p>

			<h2>Your content</h2>
			<ul>
				<li>You own the videos you upload and the videos we make from them.</li>
				<li>You give us permission to store and process your videos only to provide Komoray to you.</li>
				<li>You must have the right to upload everything you upload.</li>
			</ul>

			<h2>Fair use</h2>
			<p>Please don&apos;t upload illegal content, content you don&apos;t have rights to, or anything meant to harm others, and don&apos;t try to break or overload the service. We may suspend accounts that do.</p>

			<h2>No guarantees</h2>
			<p>
				We work hard to make Komoray good, but it is provided &quot;as is&quot;. Automatic cuts and subtitles can contain
				mistakes, so please check your video before you publish it. As far as the law allows, we are not liable for lost
				content or indirect losses.
			</p>

			<h2>Privacy</h2>
			<p>
				How we handle your data is explained in our <Link href="/privacy">Privacy Policy</Link>.
			</p>

			<h2>Changes</h2>
			<p>We may update these terms. If we make important changes, we will tell you before they apply.</p>

			<h2>Contact</h2>
			<p>
				Questions? Email <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
			</p>
		</LegalPage>
	);
}
