import { accessFor, hashEmail } from "@/lib/access";
import { OWNER_FILE } from "@/lib/admin-activity";
import { planFor } from "@/lib/billing-store";
import { deleteObject, getJson, listObjects, putObject } from "@/lib/r2";
import { sendMail } from "@/lib/mail";
import { deletionFor, REMOVED_FILE, STORAGE } from "@/lib/storage";
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
const DAY = 24 * 60 * 60 * 1000;

type Person = { email: string; hash: string; folders: string[]; bytes: number; newest: string };
export type CleanupReport = {
	at: string;
	applied: boolean;
	people: number;
	folders: number;
	noOwner: number; // folders without owner.json: left alone
	deleted: { who: string; why: string; due: string; folders: number; bytes: number }[];
	warn: { who: string; why: string; due: string; days: number; mail: string }[];
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

	const report: CleanupReport = { at: new Date(now).toISOString(), applied: apply, people: people.size, folders: folders.size, noOwner, deleted: [], warn: [] };
	for (const person of people.values()) {
		const access = await accessFor(person.email);
		const deletion = await deletionFor(person.email, access, now, person.newest ? new Date(person.newest).toISOString() : null);
		if (!deletion) continue;
		const due = new Date(deletion.at).getTime();
		const days = Math.ceil((due - now) / DAY);
		if (due <= now) {
			report.deleted.push({ who: person.hash, why: deletion.why, due: deletion.at, folders: person.folders.length, bytes: person.bytes });
			if (apply) await clearFolders(person, deletion.why);
			continue;
		}
		const warnFrom = deletion.why === "plan ended" ? STORAGE.countdownDays : STORAGE.freeWarnDays;
		if (days > warnFrom) continue;
		// Which email: a plan that ended gets one when the countdown starts and one in its last 7 days; Free gets one.
		const kind: StorageMailKind = deletion.why === "not used" ? "not used" : days <= 7 ? "plan ended, 7 days" : "plan ended";
		report.warn.push({ who: person.hash, why: deletion.why, due: deletion.at, days, mail: await remind(person, kind, deletion.at, site, apply) });
	}
	return report;
}

// One email per stage and deletion date (access/storage-mail/<hash>.json remembers which went), only when applying.
async function remind(person: Person, kind: StorageMailKind, due: string, site: string, apply: boolean) {
	const key = `access/storage-mail/${await hashEmail(person.email)}.json`;
	const sent = (await getJson<Record<string, string>>(key).catch(() => null)) ?? {};
	const id = `${kind}|${due}`;
	if (sent[id]) return "already sent";
	if (!apply) return "would send";
	const mail = storageMail(kind, due, site);
	const result = await sendMail(person.email, mail.subject, mail.text, mail.html);
	if (result === "sent") await putObject(key, JSON.stringify({ ...sent, [id]: new Date().toISOString() }), "application/json");
	return result;
}

// Every file in their project folders, leaving removed.json; for a plan that ended, which end it was, so its 90 days
// are used once (after that, Free's 30 days apply: lib/storage.ts deletionFor).
async function clearFolders(person: Person, why: string) {
	for (const id of person.folders) {
		const inside = await listObjects(`uploads/${id}/`);
		await putObject(`uploads/${id}/${REMOVED_FILE}`, JSON.stringify({ at: new Date().toISOString(), why }), "application/json");
		for (const f of inside) if (!f.key.endsWith(`/${REMOVED_FILE}`)) await deleteObject(f.key);
	}
	if (why === "plan ended") {
		const { endedAt } = await planFor(person.email);
		if (endedAt) await putObject(`access/storage-cleaned/${await hashEmail(person.email)}.json`, JSON.stringify({ endedAt, at: new Date().toISOString() }), "application/json");
	}
}
