import { getCloudflareContext } from "@opennextjs/cloudflare";
import { currentUser } from "@/lib/supabase/server";
import { planFor } from "@/lib/billing-store";
import { accessFor } from "@/lib/access";
import { type PolarEnv, polarSetup, polarSync } from "@/lib/payments/polar";

// The signed-in person's plan, from our own copy of what the seller sent (lib/billing-store.ts), for the pricing page.
export async function GET() {
	const { user } = await currentUser();
	if (!user?.email) return Response.json({ plan: null }, { status: 401 });
	let now = await planFor(user.email);
	// Our copy says a Polar plan stopped, went unpaid or is still waiting for its payment: ask Polar, in case a webhook
	// was missed (review 27 Nov).
	if ((now.unsure || now.pastDue) && now.latest?.provider === "polar") {
		const setup = polarSetup(getCloudflareContext().env as unknown as PolarEnv);
		if (setup && (await polarSync(setup, user.email).catch(() => null))) now = await planFor(user.email);
	}
	const access = await accessFor(user.email);
	const sub = now.sub;
	return Response.json({
		plan: now.plan,
		hadPlan: Boolean(now.latest), // a plan that ended: the pricing page still offers Manage billing, for receipts
		pastDue: now.pastDue?.plan ?? null, // a renewal that wasn't paid: no paid rights until the card is fixed
		pending: now.pending?.plan ?? null, // bought, the payment not confirmed yet
		extraMinutes: access.extra?.left ?? 0, // what is left of them now, not what was bought
		monthly: access.monthly,
		...(sub && { status: sub.status, every: sub.every, periodEnds: sub.periodEnds, cancelsAt: sub.scheduled?.action === "cancel" ? sub.scheduled.at : null }),
	});
}
