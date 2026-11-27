import { getCloudflareContext } from "@opennextjs/cloudflare";
import { paddleEnvOf, polarProducts, pricesFor } from "@/lib/billing";
import { polarSetup } from "@/lib/payments/polar";
import { openSeller, type SellerSettings } from "@/lib/payments/seller";

// What the pricing page needs to sell, from whichever seller is open (lib/payments/seller.ts).
// Polar: only whether it is open and whether it is test money; the checkout is made by /api/billing/checkout.
// Paddle: its checkout opens in the page, with the client-side token (made to be public, but kept out of the code: a
// Worker secret, PADDLE_CLIENT_TOKEN), which Paddle it is for, and that Paddle's price IDs.
// Nothing set (the live site until selling starts): { ready: false }, and the page says buying isn't open yet.
type BillingEnv = SellerSettings & { PADDLE_CLIENT_TOKEN?: string; PADDLE_SANDBOX_CLIENT_TOKEN?: string };

export async function GET() {
	const env = getCloudflareContext().env as unknown as BillingEnv;
	if (openSeller(env) === "polar") {
		const setup = polarSetup(env);
		if (!setup || !polarProducts(setup.environment)) return Response.json({ ready: false });
		return Response.json({ ready: true, seller: "polar", environment: setup.environment });
	}
	// .dev.vars names it PADDLE_SANDBOX_CLIENT_TOKEN on this computer.
	const token = env.PADDLE_CLIENT_TOKEN || env.PADDLE_SANDBOX_CLIENT_TOKEN || "";
	const environment = token ? paddleEnvOf(token) : null;
	const prices = environment ? pricesFor(environment) : null;
	if (!token || !environment || !prices) return Response.json({ ready: false });
	return Response.json({ ready: true, seller: "paddle", token, environment, prices });
}
