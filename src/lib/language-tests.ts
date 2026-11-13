// Speech-to-text tests run by the team on clips with a checked transcript, one row per language and engine, shown on
// the admin's Accuracy tab next to the scores from creators' own videos. Filled by hand from the test runs (see the
// commit that adds each row for where the clips came from). percent = letters right out of letters in the transcript.
export type LanguageTest = { language: string; engine: string; clips: number; minutes: number; percent: number; source: string; at: string; note?: string };

export const LANGUAGE_TESTS: LanguageTest[] = [
	// One video of the coach's (VID20261112093656, 4:54), the creator's fixed script as the truth. 13 Nov 2026.
	{ language: "th", engine: "Deepgram nova-3", clips: 1, minutes: 4.9, percent: 96.0, source: "Coach's own video", at: "2026-11-13" },
	{ language: "th", engine: "Deepgram nova-3 + Haiku 5.5 spelling", clips: 1, minutes: 4.9, percent: 97.2, source: "Coach's own video", at: "2026-11-13" },
	{ language: "th", engine: "Deepgram nova-3 + Opus 5.5 spelling", clips: 1, minutes: 4.9, percent: 97.4, source: "Coach's own video", at: "2026-11-13", note: "about 13× Haiku's cost" },
	{ language: "th", engine: "Deepgram nova-2", clips: 1, minutes: 4.9, percent: 82.5, source: "Coach's own video", at: "2026-11-13" },
];
