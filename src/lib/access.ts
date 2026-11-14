import { deleteObject, exists, getJson, listObjects, putIfAbsent, putObject, siblingKey } from "@/lib/r2";
import { justClaimed } from "@/lib/listen-state";
import { isAdmin } from "@/lib/supabase/server";
import { ALL_FEATURES, type Features, NO_FEATURES, readFeatures } from "@/lib/features";
import { BETA_MINUTES, MAX_FILE_GB, MINUTES_PER_VIDEO } from "@/lib/limits";
import { type JobFiles, PART_JOB, WHOLE_JOB } from "./render-part";
import { videoDuration } from "@/lib/video-duration";

// Who may use the studio during the beta, and how much. All kept in R2, away from uploads/ so it stays:
//   access/people/<hash of email>.json                   invited by the admin: { email, at, features? } (lib/features.ts)
//   access/usage/<hash>/<YYYY-MM>/<video id>.json        minutes this video took, added up across every month of the beta: { minutes }
//   access/best/<hash>/<YYYY-MM>/<video id>.json         Cutout Best seconds this video took from that month: { seconds }
//   uploads/<id>/access.json                             how many times this video was listened to
// Minutes count the length of the original video, once, when Find silences is pressed. Deleting the
// video gives nothing back; a failed job does (refundListen).
const LISTENS_PER_VIDEO = 3; // the first, and Wrong language? twice. Each one pays speech-to-text again
export const JOB_TOO_OLD_MS = 30 * 60 * 1000; // a job still running after this has died (same as the admin page)

export const NO_INVITE = "Komoray is invite-only for now. Your invite will come by email.";

export type AccessStatus = { allowed: boolean; unlimited: boolean; used: number; limit: number; left: number; perVideo: number; maxGb: number; features: Features };
type PersonRecord = { email: string; at: string; features?: unknown };

export async function hashEmail(email: string) {
	const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.trim().toLowerCase())));
	return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const personKey = async (email: string) => `access/people/${await hashEmail(email)}.json`;
const month = () => new Date().toISOString().slice(0, 7);

// Everything this person has used since the beta began: the limit never renews, so no month in the path.
async function minutesUsed(email: string) {
	const files = await listObjects(`access/usage/${await hashEmail(email)}/`);
	const used = await Promise.all(files.map((file) => getJson<{ minutes: number }>(file.key).catch(() => null)));
	return used.reduce((sum, item) => sum + (item?.minutes ?? 0), 0);
}

export async function accessFor(email?: string | null): Promise<AccessStatus> {
	const base = { limit: BETA_MINUTES, perVideo: MINUTES_PER_VIDEO, maxGb: MAX_FILE_GB };
	const none = { ...base, allowed: false, unlimited: false, used: 0, left: 0, features: NO_FEATURES };
	if (!email) return none;
	if (isAdmin(email)) return { ...base, allowed: true, unlimited: true, used: 0, left: BETA_MINUTES, features: ALL_FEATURES };
	const person = await getJson<PersonRecord>(await personKey(email));
	if (!person) return none;
	const used = await minutesUsed(email);
	return { ...base, allowed: true, unlimited: false, used, left: Math.max(0, BETA_MINUTES - used), features: readFeatures(person.features) };
}

export async function canUseStudio(email?: string | null) {
	return (await accessFor(email)).allowed;
}

export async function listPeople() {
	const files = await listObjects("access/people/");
	const people = await Promise.all(files.map((file) => getJson<PersonRecord>(file.key).catch(() => null)));
	const known = people.filter((person): person is PersonRecord => Boolean(person));
	const rows = await Promise.all(known.map(async (person) => ({ ...person, features: readFeatures(person.features), used: await minutesUsed(person.email) })));
	return rows.sort((a, b) => b.at.localeCompare(a.at));
}

export async function addPerson(email: string) {
	const key = await personKey(email);
	if (!(await exists(key))) await putObject(key, JSON.stringify({ email: email.trim().toLowerCase(), at: new Date().toISOString() }), "application/json");
}

// Turn features on or off for someone already invited. false = not invited.
export async function setFeatures(email: string, features: Features) {
	const key = await personKey(email);
	const person = await getJson<PersonRecord>(key);
	if (!person) return false;
	await putObject(key, JSON.stringify({ ...person, features }), "application/json");
	return true;
}

export async function removePerson(email: string) {
	await deleteObject(await personKey(email));
}

// May this video be listened to now? Takes the minutes the first time. On success, usageKey says what a failed job gives back.
export async function startListening(key: string, email?: string | null): Promise<{ error: string; status: number } | { usageKey?: string }> {
	const status = await accessFor(email);
	if (!status.allowed || !email) return { error: NO_INVITE, status: 403 };

	const [started, done, failed] = await Promise.all([
		getJson<{ startedAt?: string }>(siblingKey(key, "analyze.json")),
		exists(siblingKey(key, "edit.json")),
		exists(siblingKey(key, "analyze-error.json")),
	]);
	const running = started?.startedAt && !done && !failed && Date.now() - new Date(started.startedAt).getTime() < JOB_TOO_OLD_MS;
	if (running) return { error: "This video is already being listened to. Please wait for it to finish.", status: 409 };
	if (status.unlimited) return {};

	const recordKey = siblingKey(key, "access.json");
	const record = await getJson<{ listens: number; at?: string }>(recordKey);
	if (record) {
		if (justClaimed(record.at, Boolean(started?.startedAt), done || failed, Date.now())) return { error: "This video is already being listened to. Please wait for it to finish.", status: 409 };
		if (record.listens >= LISTENS_PER_VIDEO) return { error: `This video has been listened to ${LISTENS_PER_VIDEO} times. Please email hello@komoray.com for more.`, status: 429 };
		await putObject(recordKey, JSON.stringify({ listens: record.listens + 1, at: new Date().toISOString() }), "application/json");
		return {};
	}

	const seconds = await videoDuration(key);
	if (!seconds) return { error: "We could not read this video's length. Please try exporting it again as MP4.", status: 400 };
	const minutes = Math.ceil(seconds / 60);
	if (minutes > MINUTES_PER_VIDEO) return { error: `This video is ${minutes} minutes long. During the beta, each video can be up to ${MINUTES_PER_VIDEO} minutes. Please trim it and upload it again.`, status: 400 };
	if (minutes > status.left) return { error: `This video needs ${minutes} minutes and you have ${status.left} of your beta minutes left. Need more? Email hello@komoray.com.`, status: 429 };

	// The same video sent twice at once: only one request gets past here, so speech-to-text is paid for once.
	if (!(await putIfAbsent(recordKey, JSON.stringify({ listens: 1, at: new Date().toISOString() }), "application/json"))) {
		return { error: "This video is already being listened to. Please wait for it to finish.", status: 409 };
	}
	const usageKey = `access/usage/${await hashEmail(email)}/${month()}/${key.split("/")[1]}.json`;
	await putObject(usageKey, JSON.stringify({ minutes }), "application/json");
	return { usageKey };
}

// A job that never reported back has died: say so and give the minutes back. true = it had died.
export async function settleDeadListen(key: string) {
	const started = await getJson<{ startedAt?: string; usageKey?: string }>(siblingKey(key, "analyze.json"));
	if (!started?.startedAt || Date.now() - new Date(started.startedAt).getTime() < JOB_TOO_OLD_MS) return false;
	await putObject(siblingKey(key, "analyze-error.json"), JSON.stringify({ error: "This took too long and stopped. Your minutes are back. Please try again.", at: new Date().toISOString() }), "application/json");
	if (started.usageKey) await refundListen(key, started.usageKey).catch(() => {});
	return true;
}

// The job failed, so the minutes go back.
export async function refundListen(key: string, usageKey: string) {
	await Promise.all([deleteObject(usageKey), deleteObject(siblingKey(key, "access.json"))]);
}

// Only one Best can be starting per person at a time, so two presses can't both pay for a GPU or both
// slip past the allowance. Named by the minute: a lock left by a crash clears itself. null = busy.
export async function lockBest(email: string) {
	const lock = `access/best-lock/${await hashEmail(email)}/${Math.floor(Date.now() / 60000)}.json`;
	if (!(await putIfAbsent(lock, "{}", "application/json"))) return null;
	return () => deleteObject(lock).catch(() => {});
}

// Cutout Best is paid GPU time. Its seconds are taken when it starts and given back if it fails.
export async function bestSecondsUsed(email: string) {
	const files = await listObjects(`access/best/${await hashEmail(email)}/${month()}/`);
	const used = await Promise.all(files.map((file) => getJson<{ seconds: number }>(file.key).catch(() => null)));
	return Math.round(used.reduce((sum, item) => sum + (item?.seconds ?? 0), 0) * 10) / 10;
}

export async function chargeBest(email: string, key: string, seconds: number) {
	const usageKey = `access/best/${await hashEmail(email)}/${month()}/${key.split("/")[1]}.json`;
	const before = await getJson<{ seconds: number }>(usageKey);
	await putObject(usageKey, JSON.stringify({ seconds: (before?.seconds ?? 0) + seconds }), "application/json");
	return usageKey;
}

export async function refundBest(usageKey: string, seconds: number) {
	const before = await getJson<{ seconds: number }>(usageKey);
	if (!before) return;
	await putObject(usageKey, JSON.stringify({ seconds: Math.max(0, before.seconds - seconds) }), "application/json");
}

// A second render of the same video must wait for the first: each one is paid for.
export async function renderRunning(key: string) {
	// The whole video's job or a part's (Make this part): each has its own files (lib/render-part.ts). One at a time.
	const running = async (files: JobFiles) => {
		const [started, done, failed] = await Promise.all([
			getJson<{ startedAt?: string }>(siblingKey(key, files.job)),
			exists(siblingKey(key, files.out)),
			exists(siblingKey(key, files.error)),
		]);
		return Boolean(started?.startedAt && !done && !failed && Date.now() - new Date(started.startedAt).getTime() < JOB_TOO_OLD_MS);
	};
	const [whole, part] = await Promise.all([running(WHOLE_JOB), running(PART_JOB)]);
	return whole || part;
}

// Changes from the admin page must come from our own site.
export const sameOrigin = (request: Request) => request.headers.get("origin") === new URL(request.url).origin;
