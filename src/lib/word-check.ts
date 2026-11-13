import { cutThaiWords, isThaiWord } from "./newmm";

// Server only (the Thai dictionary is large): is every part of this Thai text a real word? Then a fix of it may be
// wrong in another sentence (สวน → ส่วน, กด → กฎ), and only the spelling AI may put it on (lib/word-rules.ts).
export function realThaiWords(text: string) {
	const parts = cutThaiWords(text);
	return parts.length > 0 && parts.every((w) => isThaiWord(w));
}
