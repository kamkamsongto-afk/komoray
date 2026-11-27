import { givesAccess, type PaidRecord, type SubRecord } from "@/lib/billing-store";
import { getJson, listObjects } from "@/lib/r2";

// Our own list of everyone who has bought a plan, from our copy of what the sellers sent (lib/billing-store.ts), so the
// customers can still be reached, and moved to another seller, if one stops (coach, 27 Nov). Card numbers are never here:
// only the seller has them. One row for each plan. A file that can't be read throws: a list with people silently missing
// would be worse than none. A payment with no plan record beside it (a missed webhook) is listed too, as such.
// Each buyer costs about three reads, and a Worker request has a limit on those: with a few
// hundred buyers this needs to be made in parts.

export type CustomerRow = {
	email: string;
	plan: string;
	billed: string;
	status: string;
	access_now: string;
	paid_until: string;
	period_ends: string;
	cancels_at: string;
	seller: string;
	seller_customer_id: string;
	subscription_id: string;
};
const COLUMNS: (keyof CustomerRow)[] = ["email", "plan", "billed", "status", "access_now", "paid_until", "period_ends", "cancels_at", "seller", "seller_customer_id", "subscription_id"];

const ROOT = "access/billing/users/";
const FILE = /^access\/billing\/users\/([0-9a-f]{64})\/(?:(contact)\.json|(subs|paid)\/([^/]+)\.json)$/;

// The address of a buyer with no contact.json (bought before it was kept): from their invitation, which is filed under
// the same hash. Only theirs is read.
const invitedEmail = async (hash: string) => (await getJson<{ email?: string }>(`access/people/${hash}.json`))?.email;

export async function customerRows(now = Date.now()): Promise<CustomerRow[]> {
	type Person = { contact?: string; subs: string[]; paid: Map<string, string> };
	const people = new Map<string, Person>();
	for (const { key } of await listObjects(ROOT)) {
		const [, hash, contact, kind, id] = FILE.exec(key) ?? [];
		if (!hash) continue;
		const person = people.get(hash) ?? { subs: [], paid: new Map<string, string>() };
		if (contact) person.contact = key;
		else if (kind === "subs") person.subs.push(key);
		else person.paid.set(id, key);
		people.set(hash, person);
	}
	const buyers = [...people].filter(([, p]) => p.subs.length || p.paid.size);
	const rows = await Promise.all(
		buyers.map(async ([hash, person]) => {
			const email = (person.contact ? (await getJson<{ email?: string }>(person.contact))?.email : undefined) ?? (await invitedEmail(hash)) ?? "";
			const who = email || `unknown (${hash.slice(0, 12)})`;
			const known = new Set<string>();
			const plans = await Promise.all(
				person.subs.map(async (key): Promise<CustomerRow[]> => {
					const sub = await getJson<SubRecord>(key);
					if (!sub) return [];
					known.add(sub.subscriptionId);
					const paidFile = person.paid.get(sub.subscriptionId);
					const paidUntil = paidFile ? (await getJson<PaidRecord>(paidFile))?.until : undefined;
					return [
						{
							email: who,
							plan: sub.plan,
							billed: sub.every === "year" ? "yearly" : "monthly",
							status: sub.status,
							access_now: givesAccess({ ...sub, paidUntil }, now) ? "yes" : "no",
							paid_until: paidUntil ?? "",
							period_ends: sub.periodEnds ?? "",
							cancels_at: sub.scheduled?.action === "cancel" ? sub.scheduled.at : "",
							seller: sub.provider ?? "paddle",
							seller_customer_id: sub.customerId,
							subscription_id: sub.subscriptionId,
						},
					];
				}),
			);
			const alone = await Promise.all(
				[...person.paid]
					.filter(([id]) => !known.has(id))
					.map(async ([id, key]): Promise<CustomerRow> => ({
						email: who, plan: "", billed: "", status: "paid, no plan record", access_now: "no", paid_until: (await getJson<PaidRecord>(key))?.until ?? "",
						period_ends: "", cancels_at: "", seller: "polar", seller_customer_id: "", subscription_id: id,
					})),
			);
			return [...plans.flat(), ...alone];
		}),
	);
	return rows.flat().sort((a, b) => a.email.localeCompare(b.email));
}

// A spreadsheet runs a cell starting with = + - @ as a formula: those get a ' in front.
export function customerCsv(rows: CustomerRow[]) {
	const cell = (text: string) => `"${(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
	return [COLUMNS.join(","), ...rows.map((row) => COLUMNS.map((c) => cell(row[c])).join(","))].join("\r\n");
}
