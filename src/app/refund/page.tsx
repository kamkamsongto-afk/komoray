import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Refund Policy · Komoray" };

const CONTACT = "hello@komoray.com";

// Its own page so Paddle's check (and buyers) find it from the home page's footer (coach 19 Nov). Only what the Terms
// already promise ("Payments" in app/terms/page.tsx, approved by the coach 18 Nov): change both together, never one.
export default function RefundPage() {
	return (
		<LegalPage title="Refund Policy" updated="November 19, 2026">
			<ul>
				<li>
					If you are not happy, email us at <a href={`mailto:${CONTACT}`}>{CONTACT}</a> within 14 days of a payment and we will
					refund it in full. No reason needed.
				</li>
				<li>
					You can cancel at any time, in one click, with Manage billing on the <Link href="/pricing">Pricing page</Link>. Your plan
					keeps working until the end of the period you paid for.
				</li>
				<li>
					Our order process is conducted by our online reseller Paddle.com. Paddle.com is the Merchant of Record for all our
					orders. Paddle provides all customer service inquiries and handles returns.
				</li>
			</ul>
			<p>
				The full rules are in our <Link href="/terms">Terms of Service</Link>.
			</p>
		</LegalPage>
	);
}
