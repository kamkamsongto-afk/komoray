import { getCloudflareContext } from "@opennextjs/cloudflare";
import { type PolarEnv, polarSigned, type PolarSubscription, recordPolarSubscription } from "@/lib/payments/polar";

// Polar tells us here when someone buys, renews, fails to pay, changes or cancels (its webhook endpoint points at this
// URL, format Raw). Only a 2xx counts as delivered; anything else is sent again, up to 10 times, and Polar switches the
// endpoint off after 10 events in a row fail (re-enable it there, then redeliver). So a failure answers 500 and the work
// is safe to repeat (lib/billing-store.ts).
type PolarEvent = { type?: string; timestamp?: string; data?: unknown };

export async function POST(request: Request) {
	const env = getCloudflareContext().env as unknown as PolarEnv;
	const secret = env.POLAR_WEBHOOK_SECRET || env.POLAR_SANDBOX_WEBHOOK_SECRET || "";
	const raw = await request.text(); // the exact bytes Polar signed: read before anything parses them
	if (!secret) {
		console.error("billing webhook: no POLAR_WEBHOOK_SECRET");
		return Response.json({ error: "Not set up" }, { status: 500 });
	}
	if (!(await polarSigned(raw, request.headers, secret))) {
		return Response.json({ error: "Bad signature" }, { status: 401 });
	}
	try {
		const event = JSON.parse(raw) as PolarEvent;
		const type = event.type ?? "";
		let result = "not handled";
		// Every subscription.* event carries the whole subscription as it is now.
		if (type.startsWith("subscription.")) result = await recordPolarSubscription(event.data as PolarSubscription, event.timestamp ?? new Date().toISOString(), type);
		console.log(`billing webhook (Polar): ${type} ${request.headers.get("webhook-id") ?? ""} ${result}`);
		return Response.json({ received: true });
	} catch (e) {
		console.error("billing webhook (Polar) failed:", e);
		return Response.json({ error: "Failed" }, { status: 500 });
	}
}
