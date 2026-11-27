import { currentUser } from "@/lib/supabase/server";
import { planFor } from "@/lib/billing-store";
import { accessFor } from "@/lib/access";

// The signed-in person's plan, from our own copy of what the seller sent (lib/billing-store.ts), for the pricing page.
export async function GET() {
	const { user } = await currentUser();
	if (!user?.email) return Response.json({ plan: null }, { status: 401 });
	const [now, access] = await Promise.all([planFor(user.email), accessFor(user.email)]);
	const sub = now.sub;
	return Response.json({
		plan: now.plan,
		hadPlan: Boolean(now.latest), // a plan that ended: the pricing page still offers Manage billing, for receipts
		pastDue: now.pastDue?.plan ?? null, // a renewal that wasn't paid: no paid rights until the card is fixed
		extraMinutes: access.extra?.left ?? 0, // what is left of them now, not what was bought
		monthly: access.monthly,
		...(sub && { status: sub.status, every: sub.every, periodEnds: sub.periodEnds, cancelsAt: sub.scheduled?.action === "cancel" ? sub.scheduled.at : null }),
	});
}
