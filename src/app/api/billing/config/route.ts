import { getCloudflareContext } from "@opennextjs/cloudflare";
import { paddleEnvOf, pricesFor } from "@/lib/billing";

// What the pricing page needs to open Paddle's checkout: the client-side token (made to be public, but kept out of the
// code: a Worker secret, PADDLE_CLIENT_TOKEN), which Paddle it is for, and that Paddle's price IDs.
// No token (the live site until selling starts): { ready: false }, and the page says buying isn't open yet.
type BillingEnv = { PADDLE_CLIENT_TOKEN?: string; PADDLE_SANDBOX_CLIENT_TOKEN?: string };

export async function GET() {
	const env = getCloudflareContext().env as unknown as BillingEnv;
	// .dev.vars names it PADDLE_SANDBOX_CLIENT_TOKEN on this computer.
	const token = env.PADDLE_CLIENT_TOKEN || env.PADDLE_SANDBOX_CLIENT_TOKEN || "";
	const environment = token ? paddleEnvOf(token) : null;
	const prices = environment ? pricesFor(environment) : null;
	if (!token || !environment || !prices) return Response.json({ ready: false });
	return Response.json({ ready: true, token, environment, prices });
}
