// Extra features the admin turns on for each person on /admin (try a feature with a few people first).
// Kept with the person's invite in R2 (lib/access.ts). Off unless turned on; the admin always has all of them.
// The server checks these before doing (and paying for) the work: hiding a button is not enough.

// Cutout: the speaker cut out of the background (text behind them, a picture or clip behind a smaller them).
// seconds = how much of one video may be cut out: a taste for free, the paid length for more.
export const CUTOUT_SECONDS = [10, 50] as const;

export type Features = { cutout: { on: boolean; seconds: number } };

export const NO_FEATURES: Features = { cutout: { on: false, seconds: CUTOUT_SECONDS[0] } };
export const ALL_FEATURES: Features = { cutout: { on: true, seconds: CUTOUT_SECONDS[CUTOUT_SECONDS.length - 1] } };

// Whatever was saved (or sent by the admin page), as Features: unknown or broken parts are off.
export function readFeatures(raw: unknown): Features {
	const cutout = (raw as { cutout?: { on?: unknown; seconds?: unknown } } | null)?.cutout;
	const seconds = Number(cutout?.seconds);
	return {
		cutout: {
			on: cutout?.on === true,
			seconds: (CUTOUT_SECONDS as readonly number[]).includes(seconds) ? seconds : NO_FEATURES.cutout.seconds,
		},
	};
}
