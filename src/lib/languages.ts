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

// The languages subtitles can be translated into, for .srt files (lib/translate.ts). Wider than the spoken
// list: nothing here needs Deepgram, line breaks or our fonts. `english` is what Claude is asked for.
export const TRANSLATIONS = [
	{ code: "en", name: "English", english: "English" },
	{ code: "th", name: "ไทย", english: "Thai" },
	{ code: "es", name: "Español", english: "Spanish" },
	{ code: "fr", name: "Français", english: "French" },
	{ code: "de", name: "Deutsch", english: "German" },
	{ code: "pt", name: "Português", english: "Portuguese" },
	{ code: "it", name: "Italiano", english: "Italian" },
	{ code: "nl", name: "Nederlands", english: "Dutch" },
	{ code: "pl", name: "Polski", english: "Polish" },
	{ code: "id", name: "Bahasa Indonesia", english: "Indonesian" },
	{ code: "ms", name: "Bahasa Melayu", english: "Malay" },
	{ code: "tl", name: "Filipino", english: "Filipino" },
	{ code: "vi", name: "Tiếng Việt", english: "Vietnamese" },
	{ code: "ru", name: "Русский", english: "Russian" },
	{ code: "uk", name: "Українська", english: "Ukrainian" },
	{ code: "bg", name: "Български", english: "Bulgarian" },
	{ code: "fi", name: "Suomi", english: "Finnish" },
	{ code: "no", name: "Norsk", english: "Norwegian" },
	{ code: "sv", name: "Svenska", english: "Swedish" },
	{ code: "da", name: "Dansk", english: "Danish" },
	{ code: "ca", name: "Català", english: "Catalan" },
	{ code: "cs", name: "Čeština", english: "Czech" },
	{ code: "hu", name: "Magyar", english: "Hungarian" },
	{ code: "ro", name: "Română", english: "Romanian" },
	{ code: "el", name: "Ελληνικά", english: "Greek" },
	{ code: "tr", name: "Türkçe", english: "Turkish" },
	{ code: "hi", name: "हिन्दी", english: "Hindi" },
	{ code: "ja", name: "日本語", english: "Japanese" },
	{ code: "ko", name: "한국어", english: "Korean" },
	{ code: "zh-Hans", name: "简体中文", english: "Simplified Chinese" },
	{ code: "zh-Hant", name: "繁體中文", english: "Traditional Chinese" },
	{ code: "ar", name: "العربية", english: "Arabic" },
	{ code: "he", name: "עברית", english: "Hebrew" },
] as const;

export const translationName = (code: string) => TRANSLATIONS.find((l) => l.code === code)?.english;

// The browser's language if we have it ("pt-BR" is "pt", "nb" is Norwegian), else English.
export function browserLanguage(tag: string) {
	const code = tag.toLowerCase().split("-")[0];
	const name = code === "nb" || code === "nn" ? "no" : code;
	return isLanguage(name) ? name : "en";
}
