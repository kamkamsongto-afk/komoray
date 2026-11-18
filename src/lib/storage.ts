import type { SupabaseClient } from "@supabase/supabase-js";
import { type AccessStatus, hashEmail } from "@/lib/access";
import { planFor } from "@/lib/billing-store";
import { getJson, listObjects, putObject } from "@/lib/r2";

// Storage (coach 18 Nov; the Terms of Service, "Storage"):
// - Everything in a person's projects counts: every file in uploads/<project id>/ (upload, preview copies, finished
//   videos, imports, banners).
// - Free: 5 GB, and the files are deleted once Komoray hasn't been opened while signed in for 30 days (email 7 days before).
// - Starter 200 GB, Pro 800 GB: never deleted while the plan is active; when full, uploads stop until they delete videos.
// - A plan that ended: everything kept for 90 days after the paid period ends, even over Free's 5 GB (new uploads follow
//   Free), with a countdown and an email from 20 days before; then the files go (the account, My words and the Brand Kit stay).
// The beta (and the admin) have no cap here: R2's own 14-day rule deletes beta videos until launch.
export const STORAGE = { freeIdleDays: 30, freeWarnDays: 7, keepAfterPlanDays: 90, countdownDays: 20 };
const DAY = 24 * 60 * 60 * 1000;
export const GB = 1024 ** 3;

// The last time they opened Komoray while signed in (pages that ask /api/access or /api/storage), at most once every
// 12 hours a write: access/active/<hash>.json { at }.
const activeKey = async (email: string) => `access/active/${await hashEmail(email)}.json`;
export async function markActive(email: string) {
	const key = await activeKey(email);
	const last = await getJson<{ at: string }>(key).catch(() => null);
	if (last && Date.now() - new Date(last.at).getTime() < 12 * 60 * 60 * 1000) return;
	await putObject(key, JSON.stringify({ at: new Date().toISOString() }), "application/json").catch(() => {});
}
// strict: a read that fails throws (only a missing file is "never seen"), for the clean-up.
export async function lastActive(email: string, strict = false) {
	const read = getJson<{ at: string }>(await activeKey(email));
	return (await (strict ? read : read.catch(() => null)))?.at ?? null;
}

// Left in a folder whose files the clean-up deleted (lib/storage.ts, step B): My projects then leaves it out.
export const REMOVED_FILE = "removed.json";

// The bytes in each of these projects' folders, and in all; gone: the ones whose files were deleted by the clean-up.
export async function projectBytes(ids: string[]) {
	const listed = await Promise.all(ids.map(async (id) => [id, await listObjects(`uploads/${id}/`)] as const));
	const perProject = Object.fromEntries(listed.map(([id, files]) => [id, files.reduce((sum, f) => sum + f.size, 0)]));
	const gone = listed.filter(([, files]) => files.some((f) => f.key.endsWith(`/${REMOVED_FILE}`))).map(([id]) => id);
	return { used: Object.values(perProject).reduce((sum, bytes) => sum + bytes, 0), perProject, gone };
}

// The signed-in person's projects (the database only returns their own rows).
export async function storageOf(supabase: SupabaseClient) {
	const { data } = await supabase.from("projects").select("id");
	return projectBytes((data ?? []).map((row: { id: string }) => row.id));
}

// What to say when adding `adding` bytes would go over their storage, else null. No cap: never.
export function storageFull(access: Pick<AccessStatus, "storageGb" | "plan">, used: number, adding: number) {
	if (access.storageGb === null) return null;
	const cap = access.storageGb * GB;
	if (used + adding <= cap) return null;
	const shown = (bytes: number) => (bytes / GB).toFixed(bytes < 10 * GB ? 1 : 0);
	const more = access.plan === "pro" ? "" : " or upgrade on the Pricing page for more";
	return `Your storage is full: ${shown(used)} GB of ${access.storageGb} GB used. Delete videos on My projects to make room${more}.`;
}

// When their files will be deleted, and why; countdown: show it on My projects now. null: they won't be (a plan is active,
// the beta, the admin, or nothing to delete yet). planEnded: a plan that ended, whose files are kept 90 days from its end.
export type Deletion = { at: string; why: "plan ended" | "not used"; countdown: boolean } | null;
// newest: when their newest file was written, for someone never seen since the last-opened date began to be kept (a
// beta user who stopped before launch): their 30 days count from it instead of never.
// strict: every read must work, or it throws (the clean-up then leaves this person alone).
export async function deletionFor(email: string, access: Pick<AccessStatus, "storageGb" | "plan">, now = Date.now(), newest: string | null = null, strict = false): Promise<Deletion> {
	if (access.storageGb === null || access.plan !== "free") return null; // paid: kept while the plan is active
	const cleaned = getJson<{ endedAt: string }>(`access/storage-cleaned/${await hashEmail(email)}.json`);
	const [{ endedAt }, active, done] = await Promise.all([planFor(email, strict), lastActive(email, strict), strict ? cleaned : cleaned.catch(() => null)]);
	// A plan that ended and whose 90 days haven't been used up yet (done: its files were already deleted for that end).
	if (endedAt && done?.endedAt !== endedAt) {
		const at = new Date(new Date(endedAt).getTime() + STORAGE.keepAfterPlanDays * DAY);
		return { at: at.toISOString(), why: "plan ended", countdown: at.getTime() - now <= STORAGE.countdownDays * DAY };
	}
	// Free: 30 days after they last opened Komoray. They are opening it as they see this, so no countdown on screen.
	const since = active ?? newest;
	if (!since) return null;
	return { at: new Date(new Date(since).getTime() + STORAGE.freeIdleDays * DAY).toISOString(), why: "not used", countdown: false };
}

// Before an upload of `adding` bytes: the message if it won't fit in their storage, else null (no cap: never asks R2).
export async function uploadBlocked(supabase: SupabaseClient, access: Pick<AccessStatus, "storageGb" | "plan">, adding: number) {
	if (access.storageGb === null) return null;
	return storageFull(access, (await storageOf(supabase)).used, adding);
}

// The room left in their storage, in bytes (no cap: null), for an upload checked later without them signed in (the phone).
export async function roomLeft(supabase: SupabaseClient, access: Pick<AccessStatus, "storageGb">) {
	if (access.storageGb === null) return null;
	return Math.max(0, access.storageGb * GB - (await storageOf(supabase)).used);
}
