import { getCloudflareContext } from "@opennextjs/cloudflare";
import { planFor } from "@/lib/billing-store";
import { polarCheckout, polarSetup } from "@/lib/payments/polar";
import { openSeller, type SellerSettings } from "@/lib/payments/seller";
import { currentUser } from "@/lib/supabase/server";

// Choose Starter / Pro when Polar is the seller: a checkout page is made here for the signed-in person and the browser is
// sent to it. The browser says only which plan and how often; who is buying comes from the sign-in.
// (Paddle's checkout opens in the page itself, from /api/billing/config.)
export async function POST(request: Request) {
	const { user } = await currentUser();
	if (!user?.email) return Response.json({ error: "Please sign in first" }, { status: 401 });
	const body = (await request.json().catch(() => null)) as { plan?: unknown; every?: unknown } | null;
	const plan = body?.plan === "starter" || body?.plan === "pro" ? body.plan : null;
	const every = body?.every === "month" || body?.every === "year" ? body.every : null;
	if (!plan || !every) return Response.json({ error: "Please pick a plan" }, { status: 400 });

	const env = getCloudflareContext().env as unknown as SellerSettings;
	const setup = polarSetup(env);
	if (openSeller(env) !== "polar" || !setup) return Response.json({ error: "Buying isn't open yet." }, { status: 503 });

	// A plan is never bought twice (coach, 17 Nov), and an unpaid one is fixed rather than bought again.
	const now = await planFor(user.email, true).catch(() => null);
	if (!now) return Response.json({ error: "Couldn't check your plan just now. Please try again." }, { status: 502 });
	if (now.sub) return Response.json({ error: "You already have a plan. Changing plans is coming soon." }, { status: 409 });
	if (now.pastDue) return Response.json({ error: "Your last payment didn't go through. Update your card with Manage billing instead." }, { status: 409 });

	const made = await polarCheckout(setup, user.email, plan, every, new URL(request.url).origin);
	return "url" in made ? Response.json(made) : Response.json({ error: made.error }, { status: made.status });
}
