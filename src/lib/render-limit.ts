// How many times one account may make a video (coach 16 Nov). Make video costs us Modal time every press but takes no
// minutes (pricing doc: "Make video · Free, no minutes used"), so without a ceiling one account (or a competitor) could
// press it all day and night. Measured 16 Nov on staging: a 4.4-minute video with a Layout ≈ $0.015–0.02.
// Not shown to paid plans (fair use); Free shows its numbers. Each plan's numbers: `renders` in lib/plans.ts.
//
//   access/renders/<hash of email>.json   { days: { "2026-11-16": 3.5, ... }, running: [...] }   the last RENDER_WINDOW_DAYS days
//
// A place is taken before Modal is asked (takeRender), and at most RENDERS_AT_ONCE videos are made at one time:
// counted afterwards, 500 presses sent together all passed and 13 were counted (26 Nov).
// A part counts as its share of the whole video (Make this part). A press that changed nothing makes nothing (api/render)
// and is not counted. Admin: no limit.
import { accessFor, hashEmail, renderRunning } from "./access";
import { getJson, putObject, siblingKey, updateJson } from "./r2";
import { PART_JOB, WHOLE_JOB } from "./render-part";
import { isAdmin } from "./supabase/server";

// Beta and paid plans: 60 a day, 200 in RENDER_WINDOW_DAYS. perDay stops a bot; perWindow is the money line
// (Founding Starter breaks even near 395 a month at $0.02, this keeps at least half). Free: 3 and 30 (lib/plans.ts).
export const RENDER_WINDOW_DAYS = 30;
export const RENDERS_AT_ONCE = 2; // videos or parts one account may have being made at the same time
const PENDING_MS = 60_000; // a place taken whose job isn't written down yet: it is being started

const fileOf = async (email: string) => `access/renders/${await hashEmail(email)}.json`;
const today = () => new Date().toISOString().slice(0, 10);

type Running = { id: string; key: string; at: string };
type Counts = { days?: Record<string, number>; running?: Running[] };

// The days still inside the window.
function recent(counts: Counts | null) {
	const since = new Date(Date.now() - RENDER_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
	return Object.fromEntries(Object.entries(counts?.days ?? {}).filter(([day]) => day >= since));
}

// Is the job this place was taken for still going? Once it is written down, its own files say (renderRunning).
async function stillGoing(place: Running) {
	const jobs = await Promise.all([WHOLE_JOB, PART_JOB].map((files) => getJson<{ startedAt?: string }>(siblingKey(place.key, files.job))));
	if (jobs.some((job) => (job?.startedAt ?? "") >= place.at)) return renderRunning(place.key);
	return Date.now() - new Date(place.at).getTime() < PENDING_MS;
}

type Refused = { error: string; status: number };

// Takes a place and counts the video, in one step that requests sent together can't share. share: 1 for the whole video,
// less for a part. Refused: the polite message (it never says the day's number to a paid plan). release: the job never
// started, so the place and the count are given back.
export async function takeRender(email: string | null | undefined, key: string, share = 1): Promise<Refused | { release: () => Promise<void> }> {
	if (!email || isAdmin(email)) return { release: async () => {} };
	const [file, limits] = await Promise.all([fileOf(email), accessFor(email).then((a) => a.renders)]);
	const part = round(Math.min(1, Math.max(0.05, share)));
	const place: Running = { id: crypto.randomUUID(), key, at: new Date().toISOString() };
	let spent = "";
	const taken = await updateJson<Counts, Refused | null>(file, async (counts) => {
		const days = recent(counts);
		const day = days[today()] ?? 0;
		const window = Object.values(days).reduce((sum, n) => sum + n, 0);
		spent = "";
		if (day >= limits.perDay || window >= limits.perWindow) {
			spent = `Make video stopped by the limit: ${round(day)} today, ${round(window)} in ${RENDER_WINDOW_DAYS} days`;
			const which = day >= limits.perDay ? `${limits.perDay} videos a day` : `${limits.perWindow} videos in ${RENDER_WINDOW_DAYS} days`;
			const error = limits.show
				? `On Free you can make ${which}. Please try again later, or upgrade on the Pricing page to make more.`
				: "You've made a lot of videos lately. Please try again in a few hours, or email hello@komoray.com and we'll help.";
			return { result: { error, status: 429 } };
		}
		const before = counts?.running ?? [];
		const going = await Promise.all(before.map(stillGoing));
		const running = before.filter((_, i) => going[i]);
		if (running.some((r) => r.key === key)) return { result: { error: "This video is already being made. Please wait for it to finish.", status: 409 } };
		if (running.length >= RENDERS_AT_ONCE) return { result: { error: `${RENDERS_AT_ONCE} of your videos are being made right now. Please wait for one to finish, then press Make video again.`, status: 429 } };
		days[today()] = round(day + part);
		return { next: { days, running: [...running, place] }, result: null };
	});
	if (!taken) return { error: "Komoray is busy with your account right now. Please try again in a moment.", status: 429 };
	if (taken.result) {
		// Seen on /admin with the other problems, so a real customer who hit the limit can be helped.
		if (spent) await putObject(`logs/${new Date().toISOString()}-${crypto.randomUUID().slice(0, 8)}.json`, JSON.stringify({ email, at: new Date().toISOString(), stage: "render limit", error: spent }), "application/json").catch(() => null);
		return taken.result;
	}
	return {
		release: async () => {
			await updateJson<Counts, null>(file, (counts) => {
				if (!counts?.running?.some((r) => r.id === place.id)) return { result: null };
				const days = recent(counts);
				const day = place.at.slice(0, 10);
				days[day] = round(Math.max(0, (days[day] ?? 0) - part));
				return { next: { days, running: counts.running.filter((r) => r.id !== place.id) }, result: null };
			}).catch(() => null);
		},
	};
}

const round = (n: number) => Math.round(n * 100) / 100;
