import { getJson, listObjects, putIfAbsent, putObject } from "@/lib/r2";
import { EXTRA_MONTHS, type PaidPlan, priceMeaning } from "@/lib/billing";
import { hashEmail } from "@/lib/email-hash";

// What each person has bought, mirrored from Paddle's webhooks into R2 next to the rest of access/ (lib/access.ts),
// so the app reads its own copy and never asks Paddle while someone works. All keyed by the hash of their email:
//   access/billing/users/<hash>/subs/<subscription id>.json   one plan: SubRecord, the newest Paddle sent
//   access/billing/users/<hash>/extra/<transaction id>.json   a pack of extra minutes: ExtraRecord
//   access/billing/customers/<customer id>.json              { user: <hash> }: whose this Paddle customer is
//   access/billing/subs/<subscription id>.json               { user: <hash> }: whose this subscription is
//   access/billing/unmatched/<id>.json                       an event we could not tie to anyone, to look at by hand
// Who it is comes from the checkout's custom_data (email_hash, set by the pricing page from the signed-in email,
// which is also the email the checkout is locked to). What was bought comes from the price ID (lib/billing.ts).
// Paddle sends at least once and in no set order: writing the same thing twice is harmless, and an event older than
// what is kept (occurred_at) is left out.

const HASH = /^[0-9a-f]{64}$/;
const PADDLE_ID = /^[a-z]{3}_[0-9a-z]{26}$/; // sub_…, ctm_…, txn_…: safe as a file name

export type SubStatus = "active" | "trialing" | "past_due" | "paused" | "canceled";
export type SubRecord = {
	subscriptionId: string;
	customerId: string;
	status: SubStatus;
	plan: PaidPlan;
	every: "month" | "year";
	priceId: string;
	periodEnds: string | null; // when this paid period ends (the next bill, unless it is cancelled)
	scheduled: { action: string; at: string } | null; // e.g. cancel at the end of the period
	occurredAt: string; // of the Paddle event this came from
};
export type ExtraRecord = { transactionId: string; minutes: number; at: string; until: string };

// The parts of Paddle's payloads used here (developer.paddle.com/webhooks).
type PaddleItem = { quantity?: number; price?: { id?: string } | null };
export type PaddleSubscription = {
	id: string;
	status: string;
	customer_id: string;
	items: PaddleItem[];
	custom_data?: Record<string, unknown> | null;
	current_billing_period?: { ends_at?: string } | null;
	scheduled_change?: { action?: string; effective_at?: string } | null;
};
export type PaddleTransaction = { id: string; status?: string; customer_id?: string | null; subscription_id?: string | null; items: PaddleItem[]; custom_data?: Record<string, unknown> | null; billed_at?: string | null };

const userRoot = (user: string) => `access/billing/users/${user}/`;

// Whose it is: the checkout said so, or this customer or subscription was tied to someone before.
async function ownerOf(customData: Record<string, unknown> | null | undefined, customerId?: string | null, subscriptionId?: string | null) {
	const said = typeof customData?.email_hash === "string" ? customData.email_hash : "";
	if (HASH.test(said)) return said;
	for (const [kind, id] of [["customers", customerId], ["subs", subscriptionId]] as const) {
		if (id && PADDLE_ID.test(id)) {
			const known = await getJson<{ user: string }>(`access/billing/${kind}/${id}.json`);
			if (known && HASH.test(known.user)) return known.user;
		}
	}
	return null;
}

async function remember(user: string, customerId?: string | null, subscriptionId?: string | null) {
	const note = JSON.stringify({ user });
	if (customerId && PADDLE_ID.test(customerId)) await putIfAbsent(`access/billing/customers/${customerId}.json`, note, "application/json");
	if (subscriptionId && PADDLE_ID.test(subscriptionId)) await putIfAbsent(`access/billing/subs/${subscriptionId}.json`, note, "application/json");
}

async function unmatched(id: string, event: string, body: unknown) {
	if (PADDLE_ID.test(id)) await putObject(`access/billing/unmatched/${id}.json`, JSON.stringify({ event, at: new Date().toISOString(), body }), "application/json");
}

const STATUSES: SubStatus[] = ["active", "trialing", "past_due", "paused", "canceled"];

// subscription.created / updated / canceled / … : keep the newest state of this plan.
export async function recordSubscription(sub: PaddleSubscription, occurredAt: string, event: string) {
	if (!PADDLE_ID.test(sub.id)) return "not ours";
	const priceId = sub.items?.[0]?.price?.id ?? "";
	const meaning = priceMeaning(priceId);
	if (!meaning || !("plan" in meaning)) return "not ours"; // a price we don't sell as a plan
	const user = await ownerOf(sub.custom_data, sub.customer_id, sub.id);
	if (!user) {
		await unmatched(sub.id, event, sub);
		return "unmatched";
	}
	const key = `${userRoot(user)}subs/${sub.id}.json`;
	const kept = await getJson<SubRecord>(key);
	if (kept && kept.occurredAt > occurredAt) return "older";
	const status = STATUSES.includes(sub.status as SubStatus) ? (sub.status as SubStatus) : "canceled"; // unknown: no access
	const change = sub.scheduled_change;
	const record: SubRecord = {
		subscriptionId: sub.id,
		customerId: sub.customer_id,
		status,
		plan: meaning.plan,
		every: meaning.every,
		priceId,
		periodEnds: sub.current_billing_period?.ends_at ?? null,
		scheduled: change?.action && change.effective_at ? { action: change.action, at: change.effective_at } : null,
		occurredAt,
	};
	await putObject(key, JSON.stringify(record), "application/json");
	await remember(user, sub.customer_id, sub.id);
	return "saved";
}

// transaction.completed: a pack of extra minutes was paid for (plans come through the subscription events).
// Keyed by the transaction, so a second delivery writes the same file.
export async function recordTransaction(txn: PaddleTransaction, event: string) {
	if (!PADDLE_ID.test(txn.id)) return "not ours";
	const minutes = (txn.items ?? []).reduce((sum, item) => {
		const meaning = priceMeaning(item.price?.id ?? "");
		return sum + (meaning && "extraMinutes" in meaning ? meaning.extraMinutes * Math.max(1, item.quantity ?? 1) : 0);
	}, 0);
	if (!minutes) return "nothing to keep";
	const user = await ownerOf(txn.custom_data, txn.customer_id, txn.subscription_id);
	if (!user) {
		await unmatched(txn.id, event, txn);
		return "unmatched";
	}
	const at = txn.billed_at ?? new Date().toISOString();
	const until = new Date(at);
	until.setUTCMonth(until.getUTCMonth() + EXTRA_MONTHS);
	const record: ExtraRecord = { transactionId: txn.id, minutes, at, until: until.toISOString() };
	await putObject(`${userRoot(user)}extra/${txn.id}.json`, JSON.stringify(record), "application/json");
	await remember(user, txn.customer_id, null);
	return "saved";
}

// What this person has now: their best plan that still gives access, and the extra minutes not yet run out.
// Free when nothing is bought. past_due keeps the plan while Paddle retries the card (Paddle's advice).
// extras: every pack still good, for lib/access.ts to take minutes from (extraMinutes is their total before any was used).
export type PlanNow = { plan: "free" | PaidPlan; sub: SubRecord | null; extraMinutes: number; extras: ExtraRecord[] };
const GIVES_ACCESS: SubStatus[] = ["active", "trialing", "past_due"];
const RANK: Record<PaidPlan, number> = { starter: 1, pro: 2 };

export async function planFor(email: string): Promise<PlanNow> {
	const root = userRoot(await hashEmail(email));
	const [subFiles, extraFiles] = await Promise.all([listObjects(`${root}subs/`), listObjects(`${root}extra/`)]);
	const subs = (await Promise.all(subFiles.map((f) => getJson<SubRecord>(f.key).catch(() => null)))).filter((s): s is SubRecord => Boolean(s));
	const best = subs.filter((s) => GIVES_ACCESS.includes(s.status)).sort((a, b) => RANK[b.plan] - RANK[a.plan])[0] ?? null;
	const now = new Date().toISOString();
	const extras = (await Promise.all(extraFiles.map((f) => getJson<ExtraRecord>(f.key).catch(() => null)))).filter((x): x is ExtraRecord => Boolean(x));
	const extraMinutes = extras.reduce((sum, x) => sum + (x.until > now ? x.minutes : 0), 0);
	return { plan: best?.plan ?? "free", sub: best, extraMinutes, extras };
}
