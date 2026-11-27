// The only file that knows Polar's API (like lib/transcribe.ts for Deepgram): the checkout, "Manage billing", and
// reading its webhooks. Called with fetch, no Polar package. Docs: polar.sh/docs.
//
// Keys, as Worker secrets (and in .dev.vars on this computer):
//   POLAR_ACCESS_TOKEN + POLAR_WEBHOOK_SECRET                   the live site
//   POLAR_SANDBOX_ACCESS_TOKEN + POLAR_SANDBOX_WEBHOOK_SECRET   staging (test money)
//
// Who is who: our name for a person is the hash of their signed-in email. It is Polar's external_id for their customer,
// and travels on the checkout as metadata.email_hash. Both are set here on the server, never by the browser.
import { polarProducts, productMeaning, type PaidPlan, type SellerEnv } from "@/lib/billing";
import { keepPaid, keepSubscription, SAFE_ID, type SubRecord, type SubStatus } from "@/lib/billing-store";
import { hashEmail } from "@/lib/email-hash";

export type PolarEnv = { POLAR_ACCESS_TOKEN?: string; POLAR_SANDBOX_ACCESS_TOKEN?: string; POLAR_WEBHOOK_SECRET?: string; POLAR_SANDBOX_WEBHOOK_SECRET?: string };
export type PolarSetup = { token: string; environment: SellerEnv; api: string };

export function polarSetup(env: PolarEnv): PolarSetup | null {
	if (env.POLAR_ACCESS_TOKEN) return { token: env.POLAR_ACCESS_TOKEN, environment: "production", api: "https://api.polar.sh/v1" };
	if (env.POLAR_SANDBOX_ACCESS_TOKEN) return { token: env.POLAR_SANDBOX_ACCESS_TOKEN, environment: "sandbox", api: "https://sandbox-api.polar.sh/v1" };
	return null;
}

// A failed call is logged with its status and Polar's error kind only: its bodies can carry a person's email.
async function call<T>(setup: PolarSetup, method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<{ status: number; data: T | null }> {
	const res = await fetch(`${setup.api}${path}`, {
		method,
		headers: { Authorization: `Bearer ${setup.token}`, "Content-Type": "application/json" },
		...(body !== undefined && { body: JSON.stringify(body) }),
	}).catch(() => null);
	if (!res) return { status: 0, data: null };
	const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
	if (!res.ok && res.status !== 404) console.error(`Polar ${method} ${path.split("?")[0]}: ${res.status} ${data?.error ?? ""}`);
	return { status: res.status, data: res.ok ? data : null };
}

type Customer = { id: string; email?: string | null; external_id?: string | null };

// Their customer at Polar, made before the checkout opens: a checkout for a known external_customer_id has its email
// locked, so nobody can buy under someone else's address and end up sharing a billing page.
// "taken": that email already belongs to a customer under another name; null: Polar couldn't be asked.
async function ensureCustomer(setup: PolarSetup, email: string, hash: string): Promise<"ok" | "taken" | null> {
	const known = await call<Customer>(setup, "GET", `/customers/external/${hash}`);
	if (known.data) return "ok";
	if (known.status !== 404) return null;
	const made = await call<Customer>(setup, "POST", "/customers/", { type: "individual", email, external_id: hash });
	if (made.data) return "ok";
	if (made.status !== 422) return null;
	// The email is there already: take it as theirs only if it has no name yet (they are signed in with that email).
	const found = await call<{ items?: Customer[] }>(setup, "GET", `/customers/?email=${encodeURIComponent(email)}`);
	const old = found.data?.items?.[0];
	if (!old) return null;
	if (old.external_id) return old.external_id === hash ? "ok" : "taken";
	return (await call<Customer>(setup, "PATCH", `/customers/${old.id}`, { external_id: hash })).data ? "ok" : null;
}

// A checkout page at Polar for one plan. site: our own address, where the buyer comes back to. ip: the buyer's, which
// Polar picks the billing country (and so the tax) from; without it Polar sees our server's.
export async function polarCheckout(setup: PolarSetup, email: string, plan: PaidPlan, every: "month" | "year", site: string, ip?: string | null): Promise<{ url: string } | { error: string; status: number }> {
	const productId = polarProducts(setup.environment)?.[plan][every];
	if (!productId) return { error: "Buying isn't open yet.", status: 503 };
	const failed = { error: "Couldn't open the checkout just now. Please try again.", status: 502 };
	const hash = await hashEmail(email);
	const customer = await ensureCustomer(setup, email, hash);
	if (customer === "taken") return { error: "This email already has a billing account. Please email hello@komoray.com.", status: 409 };
	if (!customer) return failed;
	const made = await call<{ url?: string }>(setup, "POST", "/checkouts/", {
		products: [productId],
		external_customer_id: hash,
		customer_email: email,
		metadata: { email_hash: hash },
		allow_trial: false,
		...(ip && { customer_ip_address: ip }),
		success_url: `${site}/pricing?paid=1`,
		return_url: `${site}/pricing`,
	});
	return made.data?.url?.startsWith("https://") ? { url: made.data.url } : failed;
}

// A fresh link to Polar's customer portal (cancel, change card, receipts). Which customer comes from our own record of
// the signed-in person's plan, and Polar is asked that it really is theirs before a link is made.
export async function polarPortal(setup: PolarSetup, record: SubRecord, email: string, site: string): Promise<{ url: string } | { error: string; status: number }> {
	const failed = { error: "Couldn't open billing just now. Please try again.", status: 502 };
	if (!SAFE_ID.test(record.customerId)) return failed;
	const customer = (await call<Customer>(setup, "GET", `/customers/${record.customerId}`)).data;
	if (!customer) return failed;
	const hash = await hashEmail(email);
	const theirs = customer.external_id ? customer.external_id === hash : Boolean(customer.email) && (await hashEmail(customer.email!)) === hash;
	if (!theirs) {
		console.error("Portal refused: the Polar customer is not the signed-in person");
		return { error: "This plan was bought with another email. Please email hello@komoray.com.", status: 403 };
	}
	const session = await call<{ customer_portal_url?: string }>(setup, "POST", "/customer-sessions/", { customer_id: record.customerId, return_url: `${site}/pricing` });
	const url = session.data?.customer_portal_url;
	return url?.startsWith("https://") ? { url } : failed;
}

// --- Webhooks -------------------------------------------------------------------------------------------------------

// Polar signs as "Standard Webhooks": webhook-signature holds one or more "v1,<base64>", each an HMAC-SHA256 of
// "<webhook-id>.<webhook-timestamp>.<body>". The key is the bytes after "whsec_" (base64) for secrets made since
// 8 Sep 2026, the whole secret as text for older ones; both are tried. Too old a timestamp is refused.
export const SIGNATURE_MAX_AGE_SECONDS = 300;

export async function polarSigned(rawBody: string, headers: Headers, secret: string, nowSeconds = Date.now() / 1000) {
	const id = headers.get("webhook-id") ?? "";
	const ts = headers.get("webhook-timestamp") ?? "";
	const sent = (headers.get("webhook-signature") ?? "").split(" ").flatMap((part) => (part.startsWith("v1,") ? [part.slice(3)] : []));
	if (!secret || !id || !/^\d+$/.test(ts) || !sent.length) return false;
	if (Math.abs(nowSeconds - Number(ts)) > SIGNATURE_MAX_AGE_SECONDS) return false;
	const text = new TextEncoder();
	const keys: Uint8Array<ArrayBuffer>[] = [new Uint8Array(text.encode(secret))];
	if (secret.startsWith("whsec_")) {
		try {
			keys.push(Uint8Array.from(atob(secret.slice(6)), (c) => c.charCodeAt(0)));
		} catch {
			// not base64: only the text key applies
		}
	}
	for (const bytes of keys) {
		const key = await crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
		for (const signature of sent) {
			let mac: Uint8Array<ArrayBuffer>;
			try {
				mac = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
			} catch {
				continue;
			}
			// verify compares in constant time.
			if (await crypto.subtle.verify("HMAC", key, mac, text.encode(`${id}.${ts}.${rawBody}`))) return true;
		}
	}
	return false;
}

// The parts of Polar's subscription used here.
export type PolarSubscription = {
	id: string;
	status: string;
	customer_id: string;
	product_id: string;
	current_period_start?: string | null;
	current_period_end?: string | null;
	cancel_at_period_end?: boolean;
	ends_at?: string | null;
	ended_at?: string | null;
	past_due_at?: string | null;
	metadata?: Record<string, unknown> | null;
	customer?: { external_id?: string | null } | null;
};

// Polar's statuses as ours. unpaid (every retry failed) and trial_ended give nothing and may buy again; a status not
// known gives nothing. null: a checkout not paid yet, nothing to keep.
function ourStatus(status: string): SubStatus | null {
	if (status === "incomplete" || status === "incomplete_expired") return null;
	return status === "active" || status === "trialing" || status === "past_due" || status === "paused" ? status : "canceled";
}

// What we keep of it. periodEnds is when the PAID period ends: for an unpaid renewal Polar has already moved
// current_period_end forward, so it is when the payment failed; for an ended plan, when it ended.
export function polarRecord(sub: PolarSubscription, occurredAt: string): SubRecord | null {
	const status = ourStatus(sub.status);
	const meaning = productMeaning(sub.product_id);
	if (!status || !meaning || !SAFE_ID.test(sub.id)) return null;
	const periodEnds =
		status === "past_due" ? (sub.past_due_at ?? sub.current_period_start) : status === "canceled" ? (sub.ended_at ?? sub.current_period_end) : sub.current_period_end;
	const cancelAt = sub.cancel_at_period_end && (status === "active" || status === "trialing") ? (sub.ends_at ?? sub.current_period_end) : null;
	return {
		provider: "polar",
		subscriptionId: sub.id,
		customerId: sub.customer_id,
		status,
		plan: meaning.plan,
		every: meaning.every,
		priceId: sub.product_id,
		periodEnds: periodEnds ?? null,
		scheduled: cancelAt ? { action: "cancel", at: cancelAt } : null,
		occurredAt: new Date(occurredAt).toISOString(),
	};
}

// The parts of Polar's order used here (a bill: the first payment, or a renewal).
export type PolarOrder = {
	id: string;
	paid?: boolean;
	billing_reason?: string;
	subscription_id?: string | null;
	customer_id: string;
	metadata?: Record<string, unknown> | null;
	customer?: { external_id?: string | null } | null;
	subscription?: { current_period_end?: string | null; metadata?: Record<string, unknown> | null } | null;
	items?: { end_timestamp?: string | null; proration?: boolean; amount?: number }[];
	created_at?: string;
};

// How far a paid order pays a plan up to, or null (not paid, or not for a period of a plan). From the period its lines
// cover; a first or renewal bill without one: the plan's period as Polar has it now. A plan change is billed in
// "proration" lines only (seen in the sandbox, 27 Nov): the one that charges is the new plan's period; the one that
// gives back (a negative amount) is the old plan's, and says nothing about what is paid.
export function paidThrough(order: PolarOrder): string | null {
	const renewal = order.billing_reason === "subscription_create" || order.billing_reason === "subscription_cycle";
	if (!order.paid || !order.subscription_id || !(renewal || order.billing_reason === "subscription_update")) return null;
	const ends = (order.items ?? []).flatMap((item) => ((!item.proration || (item.amount ?? 0) > 0) && item.end_timestamp ? [new Date(item.end_timestamp).getTime()] : []));
	const end = ends.length ? Math.max(...ends) : renewal ? new Date(order.subscription?.current_period_end ?? "").getTime() : NaN;
	return Number.isNaN(end) ? null : new Date(end).toISOString();
}

export async function recordPolarOrder(order: PolarOrder, event: string) {
	const until = paidThrough(order);
	if (!until || !SAFE_ID.test(order.id)) return "nothing to keep";
	const claimed = order.metadata?.email_hash ?? order.subscription?.metadata?.email_hash ?? order.customer?.external_id;
	const paid = { subscriptionId: order.subscription_id!, customerId: order.customer_id, orderId: order.id, orderedAt: order.created_at ?? "", until, at: new Date().toISOString() };
	return keepPaid(paid, { email_hash: claimed }, event, order);
}

// Ask Polar what this person really has, and keep it: for before a checkout, and when our copy says a plan stopped or
// went unpaid (a webhook may have been missed). Returns the statuses of their plans there; null: couldn't ask.
export async function polarSync(setup: PolarSetup, email: string): Promise<string[] | null> {
	const hash = await hashEmail(email);
	const asked = new Date().toISOString(); // before asking: an event from later than this is newer than the answer
	const [subs, orders] = await Promise.all([
		call<{ items?: PolarSubscription[] }>(setup, "GET", `/subscriptions/?external_customer_id=${hash}&limit=100`),
		call<{ items?: PolarOrder[] }>(setup, "GET", `/orders/?external_customer_id=${hash}&limit=100&sorting=-created_at`),
	]);
	if (!subs.data?.items || !orders.data?.items) return null;
	// Only theirs, whatever the filter did.
	const theirs = <T extends { customer?: { external_id?: string | null } | null }>(list: T[]) => list.filter((x) => x.customer?.external_id === hash);
	for (const order of theirs(orders.data.items)) await recordPolarOrder(order, "sync");
	for (const sub of theirs(subs.data.items)) await recordPolarSubscription(sub, asked, "sync");
	return theirs(subs.data.items).map((sub) => sub.status);
}

// A subscription.* event: keep the newest state of this plan.
export async function recordPolarSubscription(sub: PolarSubscription, occurredAt: string, event: string) {
	const record = polarRecord(sub, occurredAt);
	if (!record) return "not ours"; // a product we don't sell, or not paid yet
	const claimed = sub.metadata?.email_hash ?? sub.customer?.external_id;
	return keepSubscription(record, { email_hash: claimed }, event, sub);
}
