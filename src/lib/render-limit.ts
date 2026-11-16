// How many times one account may make a video (coach 16 Nov). Make video costs us Modal time every press but takes no
// minutes (pricing doc: "Make video · Free, no minutes used"), so without a ceiling one account (or a competitor) could
// press it all day and night. Measured 16 Nov on staging: a 4.4-minute video with a Layout ≈ $0.015–0.02.
// Not shown to paid plans (fair use); the Free plan will show its numbers when plans exist (Paddle).
//
//   access/renders/<hash of email>.json   { days: { "2026-11-16": 3.5, ... } }   the last RENDER_WINDOW_DAYS days
//
// A part counts as its share of the whole video (Make this part). A press that changed nothing makes nothing (api/render)
// and is not counted. Admin: no limit.
import { hashEmail } from "./access";
import { getJson, putObject } from "./r2";
import { isAdmin } from "./supabase/server";

// Beta: Starter's numbers for everyone until plans exist. perDay stops a bot; perWindow is the money line
// (Founding Starter breaks even near 395 a month at $0.02, this keeps at least half).
export const RENDER_LIMITS = { perDay: 60, perWindow: 200 };
export const RENDER_WINDOW_DAYS = 30;

const fileOf = async (email: string) => `access/renders/${await hashEmail(email)}.json`;
const today = () => new Date().toISOString().slice(0, 10);

type Counts = { days?: Record<string, number> };

// The days still inside the window.
function recent(counts: Counts | null) {
	const since = new Date(Date.now() - RENDER_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
	return Object.fromEntries(Object.entries(counts?.days ?? {}).filter(([day]) => day >= since));
}

// null: may make it. Else the polite message to show (it never says the number to a paid plan).
export async function renderLimitReached(email: string | null | undefined): Promise<string | null> {
	if (!email || isAdmin(email)) return null;
	const days = recent(await getJson<Counts>(await fileOf(email)).catch(() => null));
	const day = days[today()] ?? 0;
	const window = Object.values(days).reduce((sum, n) => sum + n, 0);
	if (day < RENDER_LIMITS.perDay && window < RENDER_LIMITS.perWindow) return null;
	await putObject(
		`logs/${new Date().toISOString()}-${crypto.randomUUID().slice(0, 8)}.json`,
		JSON.stringify({ email, at: new Date().toISOString(), stage: "render limit", error: `Make video stopped by the limit: ${round(day)} today, ${round(window)} in ${RENDER_WINDOW_DAYS} days` }),
		"application/json",
	).catch(() => null); // seen on /admin with the other problems, so a real customer who hit it can be helped
	return "You've made a lot of videos lately. Please try again in a few hours, or email hello@komoray.com and we'll help.";
}

// Counted once Modal took the job. share: 1 for the whole video, less for a part.
export async function countRender(email: string | null | undefined, share = 1) {
	if (!email || isAdmin(email)) return;
	const file = await fileOf(email);
	const days = recent(await getJson<Counts>(file).catch(() => null));
	days[today()] = round((days[today()] ?? 0) + Math.min(1, Math.max(0.05, share)));
	await putObject(file, JSON.stringify({ days }), "application/json");
}

const round = (n: number) => Math.round(n * 100) / 100;
