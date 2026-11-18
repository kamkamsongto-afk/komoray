import { getCloudflareContext } from "@opennextjs/cloudflare";
import { planFor } from "@/lib/billing-store";
import { hashEmail } from "@/lib/email-hash";
import { currentUser } from "@/lib/supabase/server";

// "Manage billing" (coach 18 Nov; money promise 5: cancel in one click): a fresh link to Paddle's own customer portal,
// where the buyer cancels, changes their card and gets their invoices. Paddle's API is called with fetch (no SDK in
// this project). The customer is ALWAYS the signed-in person's own, from what Paddle's webhooks told us
// (lib/billing-store.ts): nothing from the browser chooses whose portal it is. Only the link goes back, never the session.
// The link works once and runs out, so one is made on every press. The secret API key is a Worker secret:
// PADDLE_API_KEY on the live site, PADDLE_SANDBOX_API_KEY in the sandbox (staging and this computer).
type PortalEnv = { PADDLE_API_KEY?: string; PADDLE_SANDBOX_API_KEY?: string };
const PADDLE_ID = /^[a-z]{3}_[0-9a-z]{26}$/;

export async function POST() {
	const { user } = await currentUser();
	if (!user?.email) return Response.json({ error: "Please sign in first" }, { status: 401 });

	const { sub } = await planFor(user.email);
	if (!sub || !PADDLE_ID.test(sub.customerId) || !PADDLE_ID.test(sub.subscriptionId)) {
		return Response.json({ error: "There's no plan to manage on this account yet." }, { status: 404 });
	}

	const env = getCloudflareContext().env as unknown as PortalEnv;
	const key = env.PADDLE_API_KEY || env.PADDLE_SANDBOX_API_KEY || "";
	if (!key) return Response.json({ error: "Managing billing isn't set up yet. Please email hello@komoray.com." }, { status: 503 });
	const api = key.includes("_sdbx_") ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";

	// The customer must have the signed-in person's email (agent review, 18 Nov): who a plan belongs to comes from the
	// checkout's custom_data, which the browser sets, so someone could buy with a stranger's email and their own hash.
	// Asking Paddle for the customer's email makes sure a portal never opens on someone else's billing.
	const customer = await fetch(`${api}/customers/${sub.customerId}`, { headers: { Authorization: `Bearer ${key}` } })
		.then((r) => (r.ok ? (r.json() as Promise<{ data?: { email?: string } }>) : null))
		.catch(() => null);
	const theirs = customer?.data?.email;
	if (!theirs) return Response.json({ error: "Couldn't open billing just now. Please try again." }, { status: 502 });
	if ((await hashEmail(theirs)) !== (await hashEmail(user.email))) {
		console.error("Portal refused: the Paddle customer's email is not the signed-in person's");
		return Response.json({ error: "This plan was bought with another email. Please email hello@komoray.com." }, { status: 403 });
	}

	const res = await fetch(`${api}/customers/${sub.customerId}/portal-sessions`, {
		method: "POST",
		headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
		body: JSON.stringify({ subscription_ids: [sub.subscriptionId] }),
	}).catch(() => null);
	const data = (await res?.json().catch(() => null)) as { data?: { urls?: { general?: { overview?: string } } } } | null;
	const url = data?.data?.urls?.general?.overview;
	if (!res?.ok || !url?.startsWith("https://")) {
		console.error("Paddle portal session failed:", res?.status);
		return Response.json({ error: "Couldn't open billing just now. Please try again." }, { status: 502 });
	}
	return Response.json({ url });
}
