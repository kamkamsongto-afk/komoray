import { currentUser } from "@/lib/supabase/server";
import { planFor } from "@/lib/billing-store";

// The signed-in person's plan, from our own copy of what Paddle sent (lib/billing-store.ts), for the pricing page.
export async function GET() {
	const { user } = await currentUser();
	if (!user?.email) return Response.json({ plan: null }, { status: 401 });
	const now = await planFor(user.email);
	const sub = now.sub;
	return Response.json({
		plan: now.plan,
		extraMinutes: now.extraMinutes,
		...(sub && { status: sub.status, every: sub.every, periodEnds: sub.periodEnds, cancelsAt: sub.scheduled?.action === "cancel" ? sub.scheduled.at : null }),
	});
}
