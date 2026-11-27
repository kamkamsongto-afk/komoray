import { getJson, listObjects, putIfAbsent, putObject, updateJson } from "@/lib/r2";
import { EXTRA_MONTHS, type PaidPlan, priceMeaning, type Seller } from "@/lib/billing";
import { hashEmail } from "@/lib/email-hash";

// What each person has bought, mirrored from the seller's webhooks (Polar or Paddle) into R2 next to the rest of access/
// (lib/access.ts), so the app reads its own copy and never asks the seller while someone works. Keyed by the hash of
// their email:
//   access/billing/users/<hash>/subs/<subscription id>.json   one plan: SubRecord, the newest the seller sent
//   access/billing/users/<hash>/extra/<transaction id>.json   a pack of extra minutes: ExtraRecord (Paddle)
//   access/billing/customers/<customer id>.json              { user: <hash> }: whose this customer is
//   access/billing/subs/<subscription id>.json               { user: <hash> }: whose this subscription is
//   access/billing/unmatched/<id>.json                       an event we could not tie to anyone, to look at by hand
// Who it is comes from what was put on the checkout (email_hash: Polar's is set by our server, lib/payments/polar.ts;
// Paddle's by the pricing page). What was bought comes from the price or product ID (lib/billing.ts).
// Sellers send at least once and in no set order: writing the same thing twice is harmless, and an event older than
// what is kept (occurred_at) is left out.

const HASH = /^[0-9a-f]{64}$/;
const PADDLE_ID = /^[a-z]{3}_[0-9a-z]{26}$/; // sub_…, ctm_…, txn_…
// Paddle's IDs or Polar's (a UUID): both safe as a file name.
export const SAFE_ID = /^([a-z]{3}_[0-9a-z]{26}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export type SubStatus = "active" | "trialing" | "past_due" | "paused" | "canceled";
export type SubRecord = {
	provider?: Seller; // not there: Paddle (kept before Polar)
	subscriptionId: string;
	customerId: string;
	status: SubStatus;
	plan: PaidPlan;
	every: "month" | "year";
	priceId: string;
	periodEnds: string | null; // when this paid period ends (the next bill, unless it is cancelled)
	scheduled: { action: string; at: string } | null; // e.g. cancel at the end of the period
	occurredAt: string; // of the seller's event this came from
	paidUntil?: string; // Polar: how far money has actually come in (its own file, added by planFor)
};
export type PaidRecord = { until: string; orderId: string; orderedAt: string; at: string }; // orderedAt: when the seller made the bill
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
		if (id && SAFE_ID.test(id)) {
			const known = await getJson<{ user: string }>(`access/billing/${kind}/${id}.json`);
			if (known && HASH.test(known.user)) return known.user;
		}
	}
	return null;
}

async function remember(user: string, customerId?: string | null, subscriptionId?: string | null) {
	const note = JSON.stringify({ user });
	if (customerId && SAFE_ID.test(customerId)) await putIfAbsent(`access/billing/customers/${customerId}.json`, note, "application/json");
	if (subscriptionId && SAFE_ID.test(subscriptionId)) await putIfAbsent(`access/billing/subs/${subscriptionId}.json`, note, "application/json");
}

async function unmatched(id: string, event: string, body: unknown) {
	if (SAFE_ID.test(id)) await putObject(`access/billing/unmatched/${id}.json`, JSON.stringify({ event, at: new Date().toISOString(), body }), "application/json");
}

const STATUSES: SubStatus[] = ["active", "trialing", "past_due", "paused", "canceled"];

// subscription.created / updated / canceled / … : keep the newest state of this plan.
export async function recordSubscription(sub: PaddleSubscription, occurredAt: string, event: string) {
	if (!PADDLE_ID.test(sub.id)) return "not ours";
	const priceId = sub.items?.[0]?.price?.id ?? "";
	const meaning = priceMeaning(priceId);
	if (!meaning || !("plan" in meaning)) return "not ours"; // a price we don't sell as a plan
	const status = STATUSES.includes(sub.status as SubStatus) ? (sub.status as SubStatus) : "canceled"; // unknown: no access
	const change = sub.scheduled_change;
	const record: SubRecord = {
		provider: "paddle",
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
	return keepSubscription(record, sub.custom_data, event, sub);
}

// Keep one plan's newest state, whoever sold it. claim: what the checkout carried ({ email_hash }); raw: the seller's own
// data, kept aside when nobody can be told. The newest is decided on the file itself (updateJson): two events landing
// together can't leave the older one on top (a "past_due" overwritten by an "active" would keep a plan unpaid).
export async function keepSubscription(record: SubRecord, claim: Record<string, unknown> | null | undefined, event: string, raw: unknown) {
	const user = await ownerOf(claim, record.customerId, record.subscriptionId);
	if (!user) {
		await unmatched(record.subscriptionId, event, raw);
		return "unmatched";
	}
	const kept = await updateJson<SubRecord, string>(`${userRoot(user)}subs/${record.subscriptionId}.json`, (old) =>
		old && old.occurredAt > record.occurredAt ? { result: "older" } : { next: record, result: "saved" },
	);
	if (!kept) throw new Error("billing: the plan's file is too busy"); // a 500: the seller sends it again
	if (kept.result === "saved") await remember(user, record.customerId, record.subscriptionId);
	return kept.result;
}

// A period of a plan was paid for (Polar's order.paid): keep how far it is paid, in its own file, as the payment can
// arrive before the plan's own events. The newest bill wins, even when it pays to an earlier date (yearly switched to
// monthly); an older one delivered late changes nothing. Polar calls a renewed plan "active" before it has taken the
// money (review 27 Nov), so this, not the status, opens a new period's minutes.
export async function keepPaid(paid: PaidRecord & { subscriptionId: string; customerId: string }, claim: Record<string, unknown> | null | undefined, event: string, raw: unknown) {
	const { subscriptionId, customerId, ...record } = paid;
	if (!SAFE_ID.test(subscriptionId)) return "not ours";
	const user = await ownerOf(claim, customerId, subscriptionId);
	if (!user) {
		await unmatched(record.orderId, event, raw);
		return "unmatched";
	}
	const kept = await updateJson<PaidRecord, string>(`${userRoot(user)}paid/${subscriptionId}.json`, (old) =>
		old && (old.orderedAt ?? "") > record.orderedAt ? { result: "older" } : { next: record, result: "saved" },
	);
	if (!kept) throw new Error("billing: the payment's file is too busy"); // a 500: the seller sends it again
	if (kept.result === "saved") await remember(user, customerId, subscriptionId);
	return kept.result;
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
// Free when nothing is bought. past_due (a renewal payment failed) gives nothing, at once (coach, 27 Nov): a new month's
// minutes would otherwise be used unpaid, again and again. It shows as pastDue, so the page can ask for a new card.
// A paid period that ran out SILENT_DAYS ago with no word (the seller's webhooks stopped, or Polar saw no payment for
// the new one) stops giving access too. unsure: the seller last said the plan was running, so we may simply have missed
// something: their files are never given a deletion date on that (lib/storage.ts).
// extras: every pack still good, for lib/access.ts to take minutes from (extraMinutes is their total before any was used).
// endedAt: when their last plan stopped giving access (none active now): the 90 days of keeping their files count from
// there (lib/storage.ts). null: they never had one, or one is active.
// latest: their newest plan whatever its status (cancelled or paused too), only for Manage billing, so past receipts
// stay reachable after a plan ends (agent review 18 Nov). Never for access: that is `sub`.
// pending: running at Polar but giving nothing, as no payment has been seen for it: a first purchase, or a renewal not
// confirmed within SILENT_DAYS (a card takes seconds; a bank payment may take longer). everHad: they have had a plan.
export type PlanNow = { plan: "free" | PaidPlan; sub: SubRecord | null; pastDue: SubRecord | null; pending: SubRecord | null; latest: SubRecord | null; everHad: boolean; unsure: boolean; extraMinutes: number; extras: ExtraRecord[]; endedAt: string | null };
const GIVES_ACCESS: SubStatus[] = ["active", "trialing"];
export const SILENT_DAYS = 3;
const RANK: Record<PaidPlan, number> = { starter: 1, pro: 2 };
// Polar calls a new plan "active" before it says the money arrived: nothing is given until it does (coach, 27 Nov).
const awaitingPayment = (s: SubRecord) => s.provider === "polar" && s.status === "active" && !s.paidUntil;
// A Polar plan whose newest period has no payment seen for it (a day's slack: the two dates come from different events).
export const behindOnPayment = (s: SubRecord | null) =>
	Boolean(s && s.provider === "polar" && s.status === "active" && (!s.paidUntil || (s.periodEnds && Date.parse(s.periodEnds) - Date.parse(s.paidUntil) > 24 * 60 * 60 * 1000)));
export function givesAccess(s: SubRecord, now = Date.now()) {
	const end = s.status === "active" ? (s.paidUntil ?? s.periodEnds) : s.periodEnds;
	return GIVES_ACCESS.includes(s.status) && !awaitingPayment(s) && !(end && new Date(end).getTime() + SILENT_DAYS * 24 * 60 * 60 * 1000 < now);
}

// strict: a file that can't be read throws instead of being left out (the storage clean-up: when unsure, keep; agent
// review 19 Nov: one failed read made a paying person look Free and their files due).
export async function planFor(email: string, strict = false): Promise<PlanNow> {
	const soft = <T>(p: Promise<T | null>) => (strict ? p : p.catch(() => null));
	const root = userRoot(await hashEmail(email));
	const [subFiles, extraFiles] = await Promise.all([listObjects(`${root}subs/`), listObjects(`${root}extra/`)]);
	const kept = (await Promise.all(subFiles.map((f) => soft(getJson<SubRecord>(f.key))))).filter((s): s is SubRecord => Boolean(s));
	const subs = await Promise.all(
		kept.map(async (s) => {
			if (s.provider !== "polar") return s;
			const paid = await soft(getJson<PaidRecord>(`${root}paid/${s.subscriptionId}.json`));
			return paid ? { ...s, paidUntil: paid.until } : s;
		}),
	);
	const best = subs.filter((s) => givesAccess(s)).sort((a, b) => RANK[b.plan] - RANK[a.plan])[0] ?? null;
	const now = new Date().toISOString();
	const extras = (await Promise.all(extraFiles.map((f) => soft(getJson<ExtraRecord>(f.key))))).filter((x): x is ExtraRecord => Boolean(x));
	const extraMinutes = extras.reduce((sum, x) => sum + (x.until > now ? x.minutes : 0), 0);
	// The end of the period they paid for: a scheduled cancel's date, else the period's end, else when the seller said so.
	const unsure = !best && subs.some((s) => GIVES_ACCESS.includes(s.status));
	const ends = best || unsure ? [] : subs.map((s) => (s.scheduled?.action === "cancel" ? s.scheduled.at : null) ?? s.periodEnds ?? s.occurredAt).filter(Boolean);
	const endedAt = ends.length ? ends.sort().at(-1)! : null;
	const newest = (list: SubRecord[]) => [...list].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).at(-1) ?? null;
	const pastDue = best ? null : newest(subs.filter((s) => s.status === "past_due"));
	const pending = best || pastDue ? null : newest(subs.filter((s) => behindOnPayment(s) && !givesAccess(s)));
	// An unpaid plan first (its card is waiting to be fixed), then one waiting for its payment, then a paused one before a
	// cancelled one (it can still be resumed there, agent review 19 Nov), then the newest.
	const latest = best ?? pastDue ?? pending ?? newest(subs.filter((s) => s.status === "paused")) ?? newest(subs);
	const everHad = subs.some((s) => !awaitingPayment(s));
	return { plan: best?.plan ?? "free", sub: best, pastDue, pending, latest, everHad, unsure, extraMinutes, extras, endedAt };
}
