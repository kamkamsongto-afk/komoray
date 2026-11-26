// The guard on the spelling AI's fixes (lib/spelling.ts; coach 22 Nov: "make it as strong as it gets"). The AI only reads
// text, never hears the speech, so a fix it makes may change what was said. Every fix passes these checks, else it is
// dropped and kept in the record with its reason (api/spelling: spelling.json `rejected`), so the checks can be tuned.
// No AI and no network here: the same answer always gets the same verdict, and every rule is tested on its own.
//   negation:  a word that turns the meaning around (ไม่, อย่า, not, no, nicht ...) may never be added or removed.
//              Thai heard loosely: a ไม่ / อย่า whose tone mark the speech-to-text dropped (ไม, อยา) can get it back.
//   number:    the digits stay the same (50 → 5 is a different price). A Thai number word is never guessed from letters
//              that could be another one ("ห ร้อย" is not ห้าร้อย: it could be หกร้อย).
//   shape:     the fix keeps most of what was heard (dropped letters come back; a whole other word doesn't) and isn't
//              far longer.
//   made-up:   Thai words that were all real words never become a word that isn't (the AI inventing a name or a word).
//   too-many:  a part where the AI changes more than a share of the words is a part it misread; only its repairs of
//              words that aren't real Thai are kept (sharedFixes and the creator's words count as real).

export type GuardReason = "negation" | "number" | "shape" | "made-up" | "too-many";
export type GuardWords = {
	isThaiWord?: (word: string) => boolean; // the dictionary (newmm), server side
	cut?: (text: string) => string[]; // Thai text into words (newmm)
	known?: Set<string>; // words the creator or Komoray's shared list spell this way: never "made up"
};

const THAI = /[฀-๿]/;
const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";
const arabic = (text: string) => text.replace(/[๐-๙]/g, (c) => String(THAI_DIGITS.indexOf(c)));
const squash = (text: string) => arabic(text).replace(/ํา/g, "ำ").replace(/\s+/g, "").toLowerCase();

// ---- negation ----
// Thai, said: ไม่ (not ไม้, wood), อย่า (not อย่าง, อยาก), ห้าม. Heard: the same with the tone mark possibly dropped.
const THAI_NEG_SAID = /ไม่|อย่า(?![งก])|ห้าม/g;
const THAI_NEG_HEARD = /ไม(?![้๊๋])|อย่?า(?![งก])|ห้?าม(?!ะ)/g;
// Other languages offered on the site (lib/languages.ts): whole words, case left aside, plus English "…n't".
const NEG_WORDS = new Set(
	[
		"not", "no", "never", "nothing", "nobody", "none", "nor", "neither", "cannot", "nowhere", // en
		"nunca", "nada", "nadie", "ningún", "ninguna", "ninguno", "tampoco", "não", "nem", "nenhum", "nenhuma", // es pt
		"non", "mai", "niente", "nessuno", "ne", "pas", "jamais", "rien", "personne", "aucun", "aucune", // it fr
		"nicht", "kein", "keine", "keinen", "keinem", "keiner", "nie", "niemals", "nichts", // de
		"niet", "geen", "nooit", "niets", // nl
		"ikke", "ingen", "aldri", "inte", "aldrig", "intet", // no da sv
		// Left out on purpose: words that are also common words elsewhere (en, et: "a", "and"; tak: Polish "yes").
		"tidak", "bukan", "jangan", "belum", "tiada", // id ms
		"не", "нет", "ни", "ніж", "ні", "нема", "немає", "никогда", "nie", "żaden", "nigdy", // ru uk bg pl
		"ei", "emme", "ette", "eivät", "älä", // fi
		"ne", "nu", "niciodată", "nimic", "nem", "soha", "semmi", "ne", "ani", "nikdy", "nic", // ro hu cs
		"không", "chưa", "chẳng", "đừng", "hindi", "huwag", "wala", "değil", "yok", "hiç", "μην", "δεν", "ποτέ", // vi tl tr el
		"لا", "لم", "لن", "ليس", "לא", "אל", "אין", "नहीं", "मत", "न", // ar he hi
	].map((w) => w.toLowerCase()),
);
const CJK_NEG = /不|没|沒|別|别|无|無|未|ない|なかった|ません|안|않|못|없/g;

function negations(text: string, heard: boolean) {
	let n = (text.match(heard ? THAI_NEG_HEARD : THAI_NEG_SAID) ?? []).length;
	n += (text.match(CJK_NEG) ?? []).length;
	for (const word of text.toLowerCase().match(/[\p{L}\p{M}'’]+/gu) ?? []) {
		if (THAI.test(word)) continue;
		if (NEG_WORDS.has(word) || /n['’]t$/.test(word)) n++;
	}
	return n;
}
// A ไม่ heard loosely may also be ไม้ said, so heard may count more than said, never less: a fix keeps every negation
// it was heard with (dropping one is refused), and adds none (heard ไม can become ไม่, as it is counted in both).
function negationChanged(heard: string, fixed: string) {
	const before = negations(heard, true);
	const after = negations(fixed, false);
	const strictBefore = negations(heard, false);
	return after > before || after < strictBefore;
}

// ---- number ----
const digits = (text: string) => arabic(text).replace(/[^0-9]/g, "");

// A Thai number said in words: the AI may finish a digit only from letters that can be no other digit. Heard "ห ร้อย"
// (the person said หกร้อย, 600) came back "ห้าร้อย", 500 (coach's clip, 26 Nov): "ห" starts หก, ห้า and หนึ่ง alike.
const DIGIT_WORDS = ["ศูนย์", "หนึ่ง", "เอ็ด", "สอง", "ยี่", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
const UNITS = "สิบ|ร้อย|พัน|หมื่น|แสน|ล้าน";
const marks = /[็-์]/g; // tone and shortening marks, which the speech-to-text drops
const toneless = (text: string) => squash(text).replace(marks, "");
const occurs = (text: string, part: string) => text.split(part).length - 1;
function guessedDigit(heard: string, fixed: string) {
	const said = toneless(heard);
	const written = squash(fixed);
	const bare = DIGIT_WORDS.map((d) => d.replace(marks, ""));
	// What is left of the heard text once whole digits and units are taken out: the loose pieces.
	const rest = [...bare, ...UNITS.split("|").map((u) => u.replace(marks, ""))].reduce((text, word) => text.split(word).join(" "), said);
	return DIGIT_WORDS.some((digit, i) => {
		// Only where it reads as a number: beside a unit ("หา" and "สี" are ordinary words elsewhere).
		const asNumber = written.match(new RegExp(`${digit}(?=${UNITS})|(?<=${UNITS})${digit}`, "g"))?.length ?? 0;
		if (asNumber <= occurs(said, bare[i])) return false;
		let n = 1;
		while (n < bare[i].length && bare.some((other, k) => k !== i && other.startsWith(bare[i].slice(0, n)))) n++;
		return !rest.includes(bare[i].slice(0, n));
	});
}

// ---- shape ----
// The longest common subsequence of two short texts (a fix is a few words), for "most of what was heard stays".
function common(a: string, b: string) {
	const row = new Array(b.length + 1).fill(0);
	for (let i = 1; i <= a.length; i++) {
		let diag = 0;
		for (let j = 1; j <= b.length; j++) {
			const keep = row[j];
			row[j] = a[i - 1] === b[j - 1] ? diag + 1 : Math.max(row[j], row[j - 1]);
			diag = keep;
		}
	}
	return row[b.length];
}
export const GUARD = { keepShare: 0.5, growBy: 2, growPlus: 8, maxShare: 0.15, minBurst: 8 };
function shapeOff(heard: string, fixed: string) {
	const h = squash(heard);
	const f = squash(fixed);
	if (!h.length) return true;
	if (f.length > GUARD.growBy * h.length + GUARD.growPlus) return true;
	return common(h, f) < GUARD.keepShare * h.length;
}

// ---- made-up ----
function thaiWordsOf(text: string, w: GuardWords) {
	if (!w.cut) return [];
	return w.cut(text.replace(/[^฀-๿]+/g, " ").trim()).filter((t) => t.trim() && t !== "ๆ" && t.length > 1);
}
const real = (word: string, w: GuardWords) => (w.isThaiWord?.(word) ?? true) || (w.known?.has(word) ?? false);
// Every Thai word heard is a real word, and the fix has one that isn't.
function madeUp(heard: string, fixed: string, w: GuardWords) {
	if (!w.isThaiWord || !THAI.test(fixed)) return false;
	const before = thaiWordsOf(heard, w);
	if (!before.length || !before.every((t) => real(t, w))) return false;
	return thaiWordsOf(fixed, w).some((t) => !real(t, w));
}
// A repair: some Thai word heard isn't real, and every Thai word of the fix is (what the AI is surest to get right).
export function isRepair(heard: string, fixed: string, w: GuardWords) {
	if (!w.isThaiWord) return false;
	const before = thaiWordsOf(heard, w);
	const after = thaiWordsOf(fixed, w);
	return before.some((t) => !real(t, w)) && after.length > 0 && after.every((t) => real(t, w));
}

// The verdict on one fix: null if it may go on, else why not.
export function checkFix(heard: string, fixed: string, w: GuardWords = {}): GuardReason | null {
	if (negationChanged(heard, fixed)) return "negation";
	if (digits(heard) !== digits(fixed) || guessedDigit(heard, fixed)) return "number";
	if (shapeOff(heard, fixed)) return "shape";
	if (madeUp(heard, fixed, w)) return "made-up";
	return null;
}

// A whole part's fixes: past the share of its words a sane reading changes, only the repairs stay (too-many).
export function checkBurst<T extends { heard: string; fixed: string }>(fixes: T[], wordsRead: number, w: GuardWords) {
	const most = Math.max(GUARD.minBurst, Math.ceil(GUARD.maxShare * wordsRead));
	if (fixes.length <= most) return { kept: fixes, dropped: [] as T[] };
	const kept = fixes.filter((f) => isRepair(f.heard, f.fixed, w));
	return { kept, dropped: fixes.filter((f) => !kept.includes(f)) };
}
