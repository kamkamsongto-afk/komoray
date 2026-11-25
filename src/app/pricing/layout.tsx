import { publicPage } from "@/lib/page-meta";

// The page itself runs in the browser, so what it is called lives here. The words are the page's own.
export const metadata = publicPage("Pricing · Komoray", "Komoray plans and prices. One counter: minutes of video you upload. Never charged automatically for more.", "/pricing");

export default function PricingLayout({ children }: { children: React.ReactNode }) {
	return children;
}
