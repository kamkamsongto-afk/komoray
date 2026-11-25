import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Terms of Service · Komoray" };

const CONTACT = "hello@komoray.com";
// Who runs Komoray, as Paddle's seller check needs to see it: the name the Paddle account is in (coach, 18 Nov).
const OPERATOR = "Kampon Ulanwiriyo, Thailand";

// Paid plans (coach 18 Nov; the money promises in the decided pricing doc). Approved by the coach on staging, 18 Nov,
// with the 14-day refund as written (a lawyer may read it later: pricing doc, promise 7).
export default function TermsPage() {
	return (
		<LegalPage title="Terms of Service" updated="November 18, 2026">
			<p>
				By using Komoray, you agree to these terms. They are short on purpose. Komoray is run by {OPERATOR}{" "}
				(&ldquo;we&rdquo;).
			</p>

			<h2>Your content</h2>
			<ul>
				<li>You own the videos you upload and the videos we make from them.</li>
				<li>You give us permission to store and process your videos only to provide Komoray to you.</li>
				<li>You must have the right to upload everything you upload.</li>
			</ul>

			<h2>Plans</h2>
			<ul>
				<li>
					Komoray has a Free plan and paid plans. What each plan includes and costs is on our <Link href="/pricing">Pricing page</Link>.
				</li>
				<li>Videos made on the Free plan carry a small Komoray watermark.</li>
				<li>
					Each plan comes with minutes each month. Minutes are counted from the length of the videos you upload. Making a video
					again, editing it and downloading it use no minutes. If a job fails, its minutes come back automatically.
				</li>
				<li>Unused minutes don&apos;t carry over to the next month. We never charge you more automatically when you run out.</li>
				<li>
					Plans are for your own videos, by a person using Komoray themselves. If use looks automated, shared between many people
					or resold, we may limit it, and we will tell you first.
				</li>
			</ul>

			{/* The refund and cancel lines are repeated on app/refund/page.tsx: change both together. */}
			<h2>Payments</h2>
			<p>
				Our order process is conducted by our online reseller Paddle.com. Paddle.com is the Merchant of Record for all our
				orders. Paddle provides all customer service inquiries and handles returns.
			</p>
			<ul>
				<li>Prices are in US dollars. Sales tax or VAT for your country is added at checkout.</li>
				<li>
					Paid plans are billed in advance, monthly or yearly, and renew automatically until you cancel. For yearly plans, we email
					you 7 days before the renewal.
				</li>
				<li>
					You can cancel at any time, in one click, with Manage billing on the Pricing page. No reason needed. Your plan keeps working
					until the end of the period you paid for.
				</li>
				<li>
					Refunds: if you are not happy, email us within 14 days of a payment and we will refund it in full.
				</li>
				<li>We will not raise the price of a plan you already have without telling you at least 30 days before.</li>
			</ul>

			<h2>Storage: how much you can keep, and when files are deleted</h2>
			{/* Until launch (coach 19 Nov): the beta is still on R2's 14-day rule. Take this line out when paid plans open. */}
			<p>
				<strong>Until paid plans open, Komoray is in beta: beta videos are deleted automatically after 14 days.</strong> The rules below apply from then.
			</p>
			<p>Everything in your projects counts toward your storage: the videos you upload, the smaller copies we make of them, the finished videos and the pictures and clips you import.</p>
			<ul>
				<li>
					<strong>Free plan: 5 GB.</strong> If you don&apos;t open Komoray while signed in for 30 days in a row, we delete the files in
					your storage. We email you 7 days before. Your account, your words (My words) and your Brand Kit stay.
				</li>
				<li>
					<strong>Starter: 200 GB. Pro: 800 GB.</strong> While your plan is active, we never delete your files. You decide what to
					keep. When your storage is full, delete videos on the My projects page to upload new ones.
				</li>
				<li>
					<strong>If your plan ends</strong> (you cancel, or a payment fails and isn&apos;t fixed), we keep all your files for 90 days
					after the end of the period you paid for, even if they are more than the Free plan&apos;s 5 GB. During those 90 days you can
					open and download everything, and new uploads follow the Free plan. From 20 days before the 90 days are up, we show you a
					countdown and email you. After 90 days we delete the files. Your account, your words and your Brand Kit stay. If you start a
					plan again before then, everything stays.
				</li>
				<li>You can delete any video, and everything made from it, at any time on the My projects page.</li>
			</ul>

			<h2>Fair use</h2>
			<p>Please don&apos;t upload illegal content, content you don&apos;t have rights to, or anything meant to harm others, and don&apos;t try to break or overload the service. We may suspend accounts that do.</p>

			<h2>No guarantees</h2>
			<p>
				We work hard to make Komoray good, but it is provided &quot;as is&quot;. Automatic cuts and subtitles can contain
				mistakes, so please check your video before you publish it. Always keep your own copy of your original videos. As far as
				the law allows, we are not liable for lost content or indirect losses.
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
