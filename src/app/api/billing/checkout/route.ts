import { getCloudflareContext } from "@opennextjs/cloudflare";
import { planFor } from "@/lib/billing-store";
import { polarCheckout, polarSetup, polarSync } from "@/lib/payments/polar";
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

	// A plan is never bought twice (coach, 17 Nov), and an unpaid one is fixed rather than bought again. Polar is asked
	// first, as our own copy can be behind (just paid, a second tab, a missed webhook: review 27 Nov).
	const refuse = (error: string, status = 409) => Response.json({ error }, { status });
	const unchecked = () => refuse("Couldn't check your plan just now. Please try again.", 502);
	const there = await polarSync(setup, user.email).catch(() => null);
	const now = await planFor(user.email, true).catch(() => null);
	if (!there || !now) return unchecked();
	if (now.pastDue || there.includes("past_due")) return refuse("Your last payment didn't go through. Update your card with Manage billing instead.");
	if (there.includes("paused")) return refuse("Your plan is paused. Open Manage billing to resume it.");
	if (now.sub || there.some((s) => s === "active" || s === "trialing")) return refuse("You already have a plan. Changing plans is coming soon.");

	const made = await polarCheckout(setup, user.email, plan, every, new URL(request.url).origin, request.headers.get("cf-connecting-ip"));
	return "url" in made ? Response.json(made) : Response.json({ error: made.error }, { status: made.status });
}
