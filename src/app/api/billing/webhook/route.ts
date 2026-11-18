import { getCloudflareContext } from "@opennextjs/cloudflare";
import { paddleSigned } from "@/lib/paddle-signature";
import { type PaddleSubscription, type PaddleTransaction, recordSubscription, recordTransaction } from "@/lib/billing-store";

// Paddle tells us here when someone buys, changes or cancels (its notification destination points at this URL).
// Only a 2xx counts as delivered; anything else is sent again (sandbox: 3 times in ~15 min, live: for ~3 days), so a
// failure answers 500 and the work is safe to repeat (lib/billing-store.ts). The secret is the destination's own
// (PADDLE_WEBHOOK_SECRET, a Worker secret; PADDLE_SANDBOX_WEBHOOK_SECRET in .dev.vars on this computer).
type WebhookEnv = { PADDLE_WEBHOOK_SECRET?: string; PADDLE_SANDBOX_WEBHOOK_SECRET?: string };
type PaddleEvent = { event_id?: string; event_type?: string; occurred_at?: string; data?: unknown };

const SUBSCRIPTION_EVENTS = new Set(["subscription.created", "subscription.updated", "subscription.canceled", "subscription.activated", "subscription.past_due", "subscription.paused", "subscription.resumed", "subscription.trialing"]);

export async function POST(request: Request) {
	const env = getCloudflareContext().env as unknown as WebhookEnv;
	const secret = env.PADDLE_WEBHOOK_SECRET || env.PADDLE_SANDBOX_WEBHOOK_SECRET || "";
	const raw = await request.text(); // the exact bytes Paddle signed: read before anything parses them
	if (!secret) {
		console.error("billing webhook: no PADDLE_WEBHOOK_SECRET");
		return Response.json({ error: "Not set up" }, { status: 500 });
	}
	if (!(await paddleSigned(raw, request.headers.get("paddle-signature") ?? "", secret))) {
		return Response.json({ error: "Bad signature" }, { status: 401 });
	}
	try {
		const event = JSON.parse(raw) as PaddleEvent;
		const type = event.event_type ?? "";
		const occurredAt = event.occurred_at ?? new Date().toISOString();
		let result = "not handled";
		if (SUBSCRIPTION_EVENTS.has(type)) result = await recordSubscription(event.data as PaddleSubscription, occurredAt, type);
		else if (type === "transaction.completed") result = await recordTransaction(event.data as PaddleTransaction, type);
		console.log(`billing webhook: ${type} ${event.event_id ?? ""} ${result}`);
		return Response.json({ received: true });
	} catch (e) {
		console.error("billing webhook failed:", e);
		return Response.json({ error: "Failed" }, { status: 500 });
	}
}
