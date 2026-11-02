// The spoken languages people can pick. Only ones we measured with Deepgram Nova-3 on real recordings
// against the text they read (Nov 2026) and that put spaces between words, so nobody has to check where
// words split: Deepgram's average confidence >= 93%, the best recording >= 80% of heard words spelled as
// real words of the article, none below 60%. Thai is ours (lib/thai-words.ts joins its pieces).
// Before adding one: languages with no spaces (Japanese, Chinese) need their own line breaks, right-to-left
// ones (Arabic, Persian) need testing with word-by-word subtitles, and both need fonts in render.py.
export const LANGUAGES = [
	{ code: "en", name: "English" },
	{ code: "th", name: "ไทย" },
	{ code: "es", name: "Español" },
	{ code: "fr", name: "Français" },
	{ code: "de", name: "Deutsch" },
	{ code: "pt", name: "Português" },
	{ code: "it", name: "Italiano" },
	{ code: "nl", name: "Nederlands" },
	{ code: "pl", name: "Polski" },
	{ code: "id", name: "Bahasa Indonesia" },
	{ code: "ru", name: "Русский" },
	{ code: "uk", name: "Українська" },
	{ code: "bg", name: "Български" },
	{ code: "fi", name: "Suomi" },
	{ code: "no", name: "Norsk" },
	{ code: "ca", name: "Català" },
] as const;

export const isLanguage = (code: unknown): code is string => LANGUAGES.some((l) => l.code === code);

// The browser's language if we have it ("pt-BR" is "pt", "nb" is Norwegian), else English.
export function browserLanguage(tag: string) {
	const code = tag.toLowerCase().split("-")[0];
	const name = code === "nb" || code === "nn" ? "no" : code;
	return isLanguage(name) ? name : "en";
}
