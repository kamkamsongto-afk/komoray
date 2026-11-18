import { deleteObject, exists, getJson, listObjects, putIfAbsent, putObject, siblingKey } from "@/lib/r2";
import { justClaimed } from "@/lib/listen-state";
import { isAdmin } from "@/lib/supabase/server";
import { ALL_FEATURES, type Features, NO_FEATURES, readFeatures } from "@/lib/features";
import { BETA_MINUTES, OUT_OF_MINUTES } from "@/lib/limits";
import { cycleAround, extraLeft, PLAN_LABEL, PLAN_RULES, type PlanName, type PlanRules, PLANS_LIVE, shortDate } from "@/lib/plans";
import { planFor } from "@/lib/billing-store";
import { type JobFiles, PART_JOB, WHOLE_JOB } from "./render-part";
import { videoDuration } from "@/lib/video-duration";
import { hashEmail } from "@/lib/email-hash";

// Who may use the studio during the beta, and how much. All kept in R2, away from uploads/ so it stays:
//   access/people/<hash of email>.json                   invited by the admin: { email, at, features? } (lib/features.ts)
//   access/usage/<hash>/<YYYY-MM>/<video id>.json        minutes this video took: { minutes, extra?, at } (UsageRecord below)
//   access/usage/<hash>/<YYYY-MM>/<id>-tr-<lang>.json    minutes a translation took (api/translate, paid plans)
//   access/free/<hash>.json                              when Free began for this person (once PLANS_LIVE)
//   access/best/<hash>/<YYYY-MM>/<video id>.json         Cutout Best seconds this video took from that month: { seconds }
//   uploads/<id>/access.json                             how many times this video was listened to
// Minutes count the length of the original video, once, when Find silences is pressed. Deleting the
// video gives nothing back; a failed job does (refundListen).
const LISTENS_PER_VIDEO = 3; // the first, and Wrong language? twice. Each one pays speech-to-text again
export const JOB_TOO_OLD_MS = 30 * 60 * 1000; // a job still running after this has died (same as the admin page)

export const NO_INVITE = "Komoray is invite-only for now. Your invite will come by email.";

// plan: whose rules (lib/plans.ts). used / limit / left: this month's minutes on a plan (all of the beta's on the beta),
// left also counting Extra minutes. monthly and extra: the two parts, for the minutes bar ("212 of 300 · resets Dec 14").
// perks: what the plan unlocks; features: what the admin turned on for this person, with Cutout also on for paid plans.
export type Perks = { translate: boolean; ownFont: boolean; brandKits: number; watermark: boolean; extraMinutes: boolean };
export type AccessStatus = {
	allowed: boolean;
	unlimited: boolean;
	plan: PlanName | "admin" | null;
	used: number;
	limit: number;
	left: number;
	monthly: { used: number; limit: number; left: number; resetsAt: string } | null;
	extra: { left: number; until: string | null } | null;
	perVideo: number;
	maxGb: number;
	storageGb: number | null; // the plan's storage (lib/storage.ts); null: no cap (the beta, the admin)
	features: Features;
	perks: Perks;
	renders: { perDay: number; perWindow: number; show: boolean };
};
type PersonRecord = { email: string; at: string; features?: unknown };
// A charge of minutes: a video listened to (uploads/…/<video id>.json) or a translation (<video id>-tr-<language>.json).
// extra: how many of them came from Extra minutes. at: when (files from before 18 Nov have none: when the file was written).
type UsageRecord = { minutes: number; extra?: number; at?: string };

export { hashEmail }; // lib/email-hash.ts: the pricing page needs the same name in the browser

const personKey = async (email: string) => `access/people/${await hashEmail(email)}.json`;
const month = () => new Date().toISOString().slice(0, 7);

async function usageOf(email: string) {
	const files = await listObjects(`access/usage/${await hashEmail(email)}/`);
	const used = await Promise.all(files.map(async (file) => ({ file, item: await getJson<UsageRecord>(file.key).catch(() => null) })));
	return used.flatMap(({ file, item }) => (item ? [{ minutes: item.minutes ?? 0, extra: item.extra ?? 0, at: item.at ?? file.lastModified }] : []));
}

// Everything this person has used since the beta began: the beta's limit never renews, so the month in the path is not read.
async function minutesUsed(email: string) {
	return (await usageOf(email)).reduce((sum, item) => sum + item.minutes, 0);
}

const perksOf = (rules: PlanRules): Perks => ({ translate: rules.translate, ownFont: rules.ownFont, brandKits: rules.brandKits, watermark: rules.watermark, extraMinutes: rules.extraMinutes });
const rendersOf = (rules: PlanRules) => ({ ...rules.renders, show: rules.showRenderLimit });

// When Free began for this person: their first visit once plans are live (beta users on launch day, doc 4.), kept so it
// never moves. Their month resets on that day.
async function freeSince(email: string) {
	const key = `access/free/${await hashEmail(email)}.json`;
	await putIfAbsent(key, JSON.stringify({ at: new Date().toISOString() }), "application/json");
	return (await getJson<{ at: string }>(key))?.at ?? new Date().toISOString();
}

export async function accessFor(email?: string | null): Promise<AccessStatus> {
	const beta = PLAN_RULES.beta;
	const base = { limit: BETA_MINUTES, perVideo: beta.perVideo, maxGb: beta.maxGb, storageGb: beta.storageGb, monthly: null, extra: null, perks: perksOf(beta), renders: rendersOf(beta) };
	const none: AccessStatus = { ...base, allowed: false, unlimited: false, plan: null, used: 0, left: 0, features: NO_FEATURES };
	if (!email) return none;
	if (isAdmin(email)) return { ...base, allowed: true, unlimited: true, plan: "admin", used: 0, left: BETA_MINUTES, features: ALL_FEATURES };
	const [person, bought] = await Promise.all([getJson<PersonRecord>(await personKey(email)), planFor(email).catch(() => null)]);
	const granted = person ? readFeatures(person.features) : NO_FEATURES;
	const paid = bought && bought.plan !== "free" ? bought.plan : null;
	const plan: PlanName | null = paid ?? (PLANS_LIVE ? "free" : person ? "beta" : null);
	if (!plan) return none;
	const rules = PLAN_RULES[plan];
	const features: Features = { cutout: { ...granted.cutout, on: granted.cutout.on || rules.cutout } };
	const shared = { allowed: true, unlimited: false, plan, perVideo: rules.perVideo, maxGb: rules.maxGb, storageGb: rules.storageGb, features, perks: perksOf(rules), renders: rendersOf(rules) };
	const usage = await usageOf(email);

	if (rules.monthly === null) {
		const used = usage.reduce((sum, item) => sum + item.minutes, 0);
		return { ...shared, limit: BETA_MINUTES, used, left: Math.max(0, BETA_MINUTES - used), monthly: null, extra: null };
	}
	// A paid plan's month runs from its own billing day (Paddle's period end), Free's from the day it began.
	const anchor = paid ? (bought?.sub?.periodEnds ?? bought?.sub?.occurredAt ?? "") : await freeSince(email);
	const cycle = cycleAround(anchor);
	const first = !paid && cycle.start.getTime() <= new Date(anchor).getTime();
	const limit = first && rules.firstMonth !== null ? rules.firstMonth : rules.monthly;
	const start = cycle.start.toISOString();
	const used = usage.filter((u) => u.at >= start).reduce((sum, u) => sum + Math.max(0, u.minutes - u.extra), 0);
	// Extra minutes bought on a paid plan stay theirs after it ends (paid for, good 12 months), so they are read on any plan.
	const extra = extraLeft(bought?.extras ?? [], usage);
	const monthlyLeft = Math.max(0, limit - used);
	return {
		...shared,
		limit,
		used,
		left: monthlyLeft + extra.minutes,
		monthly: { used, limit, left: monthlyLeft, resetsAt: cycle.end.toISOString() },
		extra: extra.minutes || bought?.extras.length ? { left: extra.minutes, until: extra.until } : null,
	};
}

// What to say when there are no minutes left (before an upload, and when a video needs more than is left).
export function outOfMinutes(status: AccessStatus, needs?: number) {
	if (status.plan === "beta" || !status.monthly) {
		return needs ? `This video needs ${needs} minutes and you have ${status.left} of your beta minutes left. Need more? Email hello@komoray.com.` : OUT_OF_MINUTES;
	}
	const resets = `Your minutes reset ${shortDate(status.monthly.resetsAt)}.`;
	const head = needs ? `This needs ${needs} minutes. You have ${status.left} left.` : "You've used all your minutes for now.";
	// Extra minutes aren't sold for now (lib/plans.ts), and Pro has nothing above it yet (Max is "coming soon").
	const more = status.perks.extraMinutes ? "Add Extra minutes on the Pricing page, or upgrade." : status.plan === "pro" ? "" : "Upgrade on the Pricing page for more.";
	return `${head} ${resets}${more && ` ${more}`}`;
}

// Take minutes for one charge (name: the file under this month). Monthly minutes go first, then Extra (doc 2.).
// once: the same name twice at once takes them only once (a translation; a listen has its own guard in startListening).
// null: not enough left, or (once) already taken.
export async function takeMinutes(email: string, name: string, minutes: number, status: AccessStatus, once = false) {
	if (status.unlimited) return { usageKey: undefined };
	if (minutes > status.left) return null;
	const extra = status.monthly ? Math.max(0, minutes - status.monthly.left) : 0;
	const usageKey = `access/usage/${await hashEmail(email)}/${month()}/${name}.json`;
	const record = JSON.stringify({ minutes, at: new Date().toISOString(), ...(extra && { extra }) } satisfies UsageRecord);
	if (once) {
		if (!(await putIfAbsent(usageKey, record, "application/json"))) return null;
	} else await putObject(usageKey, record, "application/json");
	return { usageKey };
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
	if (minutes > status.perVideo) {
		const which = status.plan === "beta" ? "During the beta, each video" : `On ${PLAN_LABEL[status.plan as PlanName] ?? "your plan"}, each video`;
		return { error: `This video is ${minutes} minutes long. ${which} can be up to ${status.perVideo} minutes. Please trim it and upload it again.`, status: 400 };
	}
	if (minutes > status.left) return { error: outOfMinutes(status, minutes), status: 429 };

	// The same video sent twice at once: only one request gets past here, so speech-to-text is paid for once.
	if (!(await putIfAbsent(recordKey, JSON.stringify({ listens: 1, at: new Date().toISOString() }), "application/json"))) {
		return { error: "This video is already being listened to. Please wait for it to finish.", status: 409 };
	}
	const taken = await takeMinutes(email, key.split("/")[1], minutes, status);
	return { usageKey: taken?.usageKey };
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
