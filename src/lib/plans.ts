// What each plan may use: one table for the server (lib/access.ts, the API routes) and the pages, so both show and
// enforce the same numbers. No server imports here. The numbers are the decided pricing doc of 15 Nov
// (Google Doc "Komoray ★Final★ ราคาและแพ็กเกจ"): only 5 things are locked, the watermark, minutes, Cutout,
// the own font and how many Brand Kits. Everything else is on for all.
import { MAX_FILE_GB, MINUTES_PER_VIDEO } from "./limits";

// Off until launch day: until then whoever isn't paying is on the beta's rules (invite only, 45 minutes in all), as
// komoray.com is today. On: everyone signed in may use the studio, and whoever isn't paying is on Free.
export const PLANS_LIVE = false;

export type PlanName = "beta" | "free" | "starter" | "pro";

export type PlanRules = {
	monthly: number | null; // minutes each month (resets on the plan's own day, not the calendar's); null: beta, BETA_MINUTES in all
	firstMonth: number | null; // Free: the first month's minutes instead of `monthly`
	perVideo: number; // longest video, minutes
	maxGb: number; // biggest file
	storageGb: number | null; // everything kept in their projects (lib/storage.ts, Terms "Storage"); null: the beta, R2 deletes after 14 days
	renders: { perDay: number; perWindow: number }; // Make video (lib/render-limit.ts), over RENDER_WINDOW_DAYS
	showRenderLimit: boolean; // say the numbers (Free) or only that it's a lot (paid: fair use, never "unlimited")
	extraMinutes: boolean; // may buy Extra minutes
	translate: boolean;
	cutout: boolean; // Fast and Balanced (the admin can still turn it on for one person: lib/features.ts)
	ownFont: boolean;
	brandKits: number;
	watermark: boolean; // not made yet (render.py + the preview): kept here so it lands in one place
};

// The beta keeps what it has today, so nothing changes on komoray.com before launch.
// Except translating: hidden for everyone for now (coach, 18 Nov: a separate .srt to upload by hand costs us AI money per
// language and isn't a wow). The code stays (api/translate, lib/translate.ts) for when it builds translated subtitles in.
const BETA: PlanRules = { monthly: null, firstMonth: null, perVideo: MINUTES_PER_VIDEO, maxGb: MAX_FILE_GB, storageGb: null, renders: { perDay: 60, perWindow: 200 }, showRenderLimit: false, extraMinutes: false, translate: false, cutout: false, ownFont: true, brandKits: 20, watermark: false }; // 20: MAX_KITS in lib/brand-kits.ts (which reads R2, so not imported here)

export const PLAN_RULES: Record<PlanName, PlanRules> = {
	beta: BETA,
	// Free: 35 minutes the first month, then 10 a month for good. Files up to 15 minutes and 1 GB. Make video 3 a day, 30 a month (16 Nov).
	// Storage (coach 18 Nov): Free 5 GB, Starter 200 GB, Pro 800 GB.
	free: { monthly: 10, firstMonth: 35, perVideo: 15, maxGb: 1, storageGb: 5, renders: { perDay: 3, perWindow: 30 }, showRenderLimit: true, extraMinutes: false, translate: false, cutout: false, ownFont: false, brandKits: 0, watermark: true },
	// Paid files: the doc says 5 GB, but Deepgram refuses over 2 GB (lib/limits.ts) until the sound is sent on its own.
	// Longest video for paid plans isn't decided yet (doc 13.): the beta's 20 minutes until it is.
	// Extra minutes not sold for now (coach, 18 Nov: reads like a credit top-up); packs already bought still count.
	// 10 and 20 hours (coach, 18 Nov: was 300 and 600; with no translation cost, full use still pays on every price).
	// Starter has the own font too (coach 18 Nov): Starter and Pro differ only in how much (minutes, storage, Brand Kits).
	starter: { ...BETA, monthly: 600, storageGb: 200, extraMinutes: false, cutout: true, ownFont: true, brandKits: 1 },
	pro: { ...BETA, monthly: 1200, storageGb: 800, extraMinutes: false, cutout: true, ownFont: true, brandKits: 5 },
};

export const PLAN_LABEL: Record<PlanName, string> = { beta: "Beta", free: "Free", starter: "Starter", pro: "Pro" };

// The next month boundary after `from`, counted from `anchor` (the plan's own day of the month). A plan bought on the
// 31st resets on the last day of shorter months. Months only: a yearly plan still gets its minutes each month (doc 2.).
export function cycleAround(anchor: string, at = new Date()): { start: Date; end: Date } {
	const base = new Date(anchor);
	if (Number.isNaN(base.getTime())) {
		const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
		return { start, end: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1)) };
	}
	const step = (months: number) => {
		const d = new Date(base);
		const day = d.getUTCDate();
		d.setUTCDate(1);
		d.setUTCMonth(d.getUTCMonth() + months);
		const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
		d.setUTCDate(Math.min(day, last));
		return d;
	};
	let months = (at.getUTCFullYear() - base.getUTCFullYear()) * 12 + (at.getUTCMonth() - base.getUTCMonth());
	while (step(months) > at) months--;
	while (step(months + 1) <= at) months++;
	return { start: step(months), end: step(months + 1) };
}

// Extra minutes left now. Each pack lasts 12 months from buying; what was taken from Extra goes from the pack that runs
// out first among those bought by then and still good then, so a newer pack isn't spent while an older one expires.
export type ExtraPack = { minutes: number; at: string; until: string };
export type ExtraUse = { extra: number; at: string };
export function extraLeft(packs: ExtraPack[], uses: ExtraUse[], now = new Date().toISOString()) {
	const left = packs.map((p) => ({ ...p, left: p.minutes })).sort((a, b) => a.until.localeCompare(b.until));
	for (const use of [...uses].sort((a, b) => a.at.localeCompare(b.at))) {
		let need = use.extra;
		for (const pack of left) {
			if (need <= 0) break;
			if (pack.at > use.at || pack.until <= use.at) continue;
			const take = Math.min(need, pack.left);
			pack.left -= take;
			need -= take;
		}
	}
	const good = left.filter((p) => p.until > now && p.left > 0);
	return { minutes: good.reduce((sum, p) => sum + p.left, 0), until: good.length ? good[good.length - 1].until : null };
}

// "Dec 14" for the pages and the messages.
export const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
