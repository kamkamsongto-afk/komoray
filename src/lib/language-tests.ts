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
	// Google FLEURS (CC BY 4.0), first 20 sentences of the dev set per language, joined into one clip and sent as the site
	// sends it (nova-3, the site language code). Read speech with many names, so creators talking will differ. 13 Nov 2026.
	{ language: "en", engine: "Deepgram nova-3", clips: 20, minutes: 2.9, percent: 98.6, source: "FLEURS dev (read speech)", at: "2026-11-13", note: "words right 95.8%" },
	{ language: "th", engine: "Deepgram nova-3", clips: 20, minutes: 3.7, percent: 91.9, source: "FLEURS dev (read speech)", at: "2026-11-13" },
	{ language: "es", engine: "Deepgram nova-3", clips: 20, minutes: 4.2, percent: 96.3, source: "FLEURS dev (read speech)", at: "2026-11-13", note: "words right 94.5%" },
	{ language: "fr", engine: "Deepgram nova-3", clips: 20, minutes: 3.2, percent: 96.4, source: "FLEURS dev (read speech)", at: "2026-11-13", note: "words right 92.9%" },
	{ language: "de", engine: "Deepgram nova-3", clips: 20, minutes: 4, percent: 94.7, source: "FLEURS dev (read speech)", at: "2026-11-13", note: "words right 93.4%" },
	{ language: "pt", engine: "Deepgram nova-3", clips: 20, minutes: 3.9, percent: 95.3, source: "FLEURS dev (read speech)", at: "2026-11-13", note: "words right 89.7%" },
	{ language: "it", engine: "Deepgram nova-3", clips: 20, minutes: 4.4, percent: 96.7, source: "FLEURS dev (read speech)", at: "2026-11-13", note: "words right 93.3%" },
	{ language: "nl", engine: "Deepgram nova-3", clips: 20, minutes: 3.4, percent: 97.1, source: "FLEURS dev (read speech)", at: "2026-11-13", note: "words right 92.5%" },
	{ language: "pl", engine: "Deepgram nova-3", clips: 20, minutes: 3.4, percent: 96.7, source: "FLEURS dev (read speech)", at: "2026-11-13", note: "words right 93.2%" },
	{ language: "id", engine: "Deepgram nova-3", clips: 20, minutes: 3.9, percent: 94.5, source: "FLEURS dev (read speech)", at: "2026-11-13", note: "words right 88.6%" },
	{ language: "ru", engine: "Deepgram nova-3", clips: 20, minutes: 3.7, percent: 97.9, source: "FLEURS dev (read speech)", at: "2026-11-13", note: "words right 91.4%" },
	{ language: "uk", engine: "Deepgram nova-3", clips: 20, minutes: 3.4, percent: 90.1, source: "FLEURS dev (read speech)", at: "2026-11-13", note: "words right 84.4%" },
	{ language: "bg", engine: "Deepgram nova-3", clips: 20, minutes: 3.1, percent: 95.9, source: "FLEURS dev (read speech)", at: "2026-11-13", note: "words right 89.4%" },
	{ language: "fi", engine: "Deepgram nova-3", clips: 20, minutes: 3.7, percent: 80.9, source: "FLEURS dev (read speech)", at: "2026-11-13", note: "words right 79.8%" },
	{ language: "no", engine: "Deepgram nova-3", clips: 20, minutes: 4, percent: 94.9, source: "FLEURS dev (read speech)", at: "2026-11-13", note: "words right 85.4%" },
	{ language: "ca", engine: "Deepgram nova-3", clips: 20, minutes: 4.1, percent: 96.7, source: "FLEURS dev (read speech)", at: "2026-11-13", note: "words right 94.2%" },
	{ language: "zh-Hans", engine: "Deepgram nova-3", clips: 20, minutes: 4.1, percent: 94.8, source: "FLEURS dev (read speech)", at: "2026-11-13", note: "not offered on the site yet" },
	{ language: "ja", engine: "Deepgram nova-3", clips: 20, minutes: 4.6, percent: 96.1, source: "FLEURS dev (read speech)", at: "2026-11-13", note: "not offered on the site yet" },
	{ language: "ko", engine: "Deepgram nova-3", clips: 20, minutes: 4.4, percent: 91.9, source: "FLEURS dev (read speech)", at: "2026-11-13", note: "words right 80.3%; not offered on the site yet" },
	{ language: "vi", engine: "Deepgram nova-3", clips: 20, minutes: 3.8, percent: 92.7, source: "FLEURS dev (read speech)", at: "2026-11-13", note: "words right 90.8%; not offered on the site yet" },
	{ language: "hi", engine: "Deepgram nova-3", clips: 20, minutes: 3.8, percent: 88.5, source: "FLEURS dev (read speech)", at: "2026-11-13", note: "words right 86.2%; not offered on the site yet" },
	{ language: "tr", engine: "Deepgram nova-3", clips: 20, minutes: 4.4, percent: 94.6, source: "FLEURS dev (read speech)", at: "2026-11-13", note: "words right 88.9%; not offered on the site yet" },
	{ language: "ar", engine: "Deepgram nova-3", clips: 20, minutes: 3.6, percent: 89, source: "FLEURS dev (read speech)", at: "2026-11-13", note: "words right 67.9%; not offered on the site yet" },
];
