import { hashEmail, plansLive } from "@/lib/access";
import { OWNER_FILE } from "@/lib/admin-activity";
import { planFor } from "@/lib/billing-store";
import { deleteObject, getJson, listObjects, putObject } from "@/lib/r2";
import { sendMail } from "@/lib/mail";
import { PLAN_RULES } from "@/lib/plans";
import { deletionFor, REMOVED_FILE, STORAGE } from "@/lib/storage";
import { isAdmin } from "@/lib/supabase/server";
import { type StorageMailKind, storageMail } from "@/lib/storage-mail";

// The daily storage clean-up (coach 18 Nov; Terms "Storage"; called by api/cron/storage):
// - a plan that ended: 90 days after its paid period, every file in that person's projects goes;
// - Free: 30 days after Komoray was last opened signed in, the same.
// Who a project folder belongs to comes from its owner.json (written at upload, from the phone and on Duplicate).
// A folder's files are deleted and removed.json is left in it, so My projects leaves the project out (the database row
// stays: the clean-up has no right to the user's rows). The account, My words and the Brand Kit are never touched.
// The beta and the admin have no storage cap (deletionFor gives null): R2's own 14-day rule still covers the beta.
// It also lists who should be warned (the 20-day countdown of a plan that ended, Free's 7 days), for the emails (step C).
// apply false: only says what it would do. Report: no emails or names, only the scrambled code of each person.
// When unsure, keep (agent review 19 Nov): every read about a person must work (strict), else they are left alone this
// run (report.errors); and nobody is deleted before a reminder email went to them at least NOTICE_DAYS before, whatever
// the due date says (a late switch-on, a cron outage, Brevo down: the deletion waits, the Terms promise the email).
const DAY = 24 * 60 * 60 * 1000;
const NOTICE_DAYS = 7;

type Person = { email: string; hash: string; folders: string[]; bytes: number; newest: string };
export type CleanupReport = {
	at: string;
	applied: boolean;
	people: number;
	folders: number;
	noOwner: number; // folders without owner.json: left alone
	deleted: { who: string; why: string; due: string; folders: number; bytes: number }[];
	warn: { who: string; why: string; due: string; days: number; mail: string }[];
	waiting: { who: string; why: string; due: string; mail: string }[]; // due, but the reminder hasn't had its 7 days yet
	errors: number; // people left alone this run because something couldn't be read or deleted
};

// site: the address for the emails' links.
export async function storageCleanup(apply: boolean, site: string, now = Date.now()): Promise<CleanupReport> {
	// Every folder in uploads/, its size, and whether the clean-up already emptied it.
	const files = await listObjects("uploads/");
	const folders = new Map<string, { bytes: number; removed: boolean; hasOwner: boolean; newest: string }>();
	for (const f of files) {
		const [, id, ...rest] = f.key.split("/");
		if (!id) continue;
		const folder = folders.get(id) ?? { bytes: 0, removed: false, hasOwner: false, newest: "" };
		folder.bytes += f.size;
		if (f.lastModified > folder.newest) folder.newest = f.lastModified;
		if (rest.join("/") === REMOVED_FILE) folder.removed = true;
		if (rest.join("/") === OWNER_FILE) folder.hasOwner = true;
		folders.set(id, folder);
	}

	// Whose each one is.
	const people = new Map<string, Person>();
	let noOwner = 0;
	for (const [id, folder] of folders) {
		if (folder.removed) continue;
		if (!folder.hasOwner) {
			noOwner++;
			continue;
		}
		const owner = await getJson<{ email?: string }>(`uploads/${id}/${OWNER_FILE}`).catch(() => null);
		const email = owner?.email?.toLowerCase();
		if (!email) {
			noOwner++;
			continue;
		}
		const person = people.get(email) ?? { email, hash: (await hashEmail(email)).slice(0, 12), folders: [], bytes: 0, newest: "" };
		person.folders.push(id);
		person.bytes += folder.bytes;
		if (folder.newest > person.newest) person.newest = folder.newest;
		people.set(email, person);
	}

	const report: CleanupReport = { at: new Date(now).toISOString(), applied: apply, people: people.size, folders: folders.size, noOwner, deleted: [], warn: [], waiting: [], errors: 0 };
	for (const person of people.values()) {
		try {
			await onePerson(person, report, apply, site, now);
		} catch (error) {
			console.error("storage clean-up: left one person alone:", error);
			report.errors++;
		}
	}
	return report;
}

async function onePerson(person: Person, report: CleanupReport, apply: boolean, site: string, now: number) {
	// Only Free people have files the clean-up may delete: not the admin, not a paying person, not the beta. Read strictly,
	// without accessFor (which forgives a failed read, and would also start a Free month for them).
	if (isAdmin(person.email)) return;
	if ((await planFor(person.email, true)).plan !== "free") return;
	if (!plansLive()) return;
	const deletion = await deletionFor(person.email, { storageGb: PLAN_RULES.free.storageGb, plan: "free" }, now, person.newest ? new Date(person.newest).toISOString() : null, true);
	if (!deletion) return;
	const due = new Date(deletion.at).getTime();
	const days = Math.ceil((due - now) / DAY);
	if (due <= now) {
		// Due: only once a reminder for this date went out NOTICE_DAYS ago or more. Else send it now and wait.
		const firstMail = await firstReminder(person, deletion.at);
		if (firstMail === null || now - new Date(firstMail).getTime() < NOTICE_DAYS * DAY) {
			const kind: StorageMailKind = deletion.why === "not used" ? "not used" : "plan ended, 7 days";
			report.waiting.push({ who: person.hash, why: deletion.why, due: deletion.at, mail: firstMail ? "sent, waiting 7 days" : await remind(person, kind, deletion.at, site, apply, now) });
			return;
		}
		report.deleted.push({ who: person.hash, why: deletion.why, due: deletion.at, folders: person.folders.length, bytes: person.bytes });
		if (apply) await clearFolders(person, deletion.why);
		return;
	}
	const warnFrom = deletion.why === "plan ended" ? STORAGE.countdownDays : STORAGE.freeWarnDays;
	if (days > warnFrom) return;
	// Which email: a plan that ended gets one when the countdown starts and one in its last 7 days; Free gets one.
	const kind: StorageMailKind = deletion.why === "not used" ? "not used" : days <= 7 ? "plan ended, 7 days" : "plan ended";
	report.warn.push({ who: person.hash, why: deletion.why, due: deletion.at, days, mail: await remind(person, kind, deletion.at, site, apply, now) });
}

const mailKey = async (email: string) => `access/storage-mail/${await hashEmail(email)}.json`;

// When the first reminder about this deletion date went out, or null.
async function firstReminder(person: Person, due: string) {
	const sent = (await getJson<Record<string, string>>(await mailKey(person.email))) ?? {};
	const times = Object.entries(sent).filter(([id]) => id.endsWith(`|${due}`)).map(([, at]) => at).sort();
	return times[0] ?? null;
}

// One email per stage and deletion date (access/storage-mail/<hash>.json remembers which went), only when applying.
async function remind(person: Person, kind: StorageMailKind, due: string, site: string, apply: boolean, now: number) {
	const key = await mailKey(person.email);
	const sent = (await getJson<Record<string, string>>(key)) ?? {};
	const id = `${kind}|${due}`;
	if (sent[id]) return "already sent";
	if (!apply) return "would send";
	const mail = storageMail(kind, due, site);
	const result = await sendMail(person.email, mail.subject, mail.text, mail.html);
	if (result === "sent") await putObject(key, JSON.stringify({ ...sent, [id]: new Date(now).toISOString() }), "application/json"); // the run's clock, as the 7 days are counted with it
	return result;
}

// Every file in their project folders; for a plan that ended, which end it was, so its 90 days are used once (after
// that, Free's 30 days apply: lib/storage.ts deletionFor). Order (agent review 19 Nov): the files first, owner.json
// kept until last, then removed.json, then owner.json: if a delete fails half-way, the folder isn't marked removed (so
// it isn't hidden while its bytes still count) and still has its owner, so the next run finishes it.
async function clearFolders(person: Person, why: string) {
	for (const id of person.folders) {
		const inside = await listObjects(`uploads/${id}/`);
		for (const f of inside) if (!f.key.endsWith(`/${OWNER_FILE}`) && !f.key.endsWith(`/${REMOVED_FILE}`)) await deleteObject(f.key);
		await putObject(`uploads/${id}/${REMOVED_FILE}`, JSON.stringify({ at: new Date().toISOString(), why }), "application/json");
		await deleteObject(`uploads/${id}/${OWNER_FILE}`);
	}
	if (why === "plan ended") {
		const { endedAt } = await planFor(person.email, true);
		if (endedAt) await putObject(`access/storage-cleaned/${await hashEmail(person.email)}.json`, JSON.stringify({ endedAt, at: new Date().toISOString() }), "application/json");
	}
}
