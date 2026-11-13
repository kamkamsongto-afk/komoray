// How right the speech-to-text was, per video, for the admin's Accuracy tab. The creator's final script (their fixes)
// is taken as the truth, so a video only counts once they made the video (final.mp4): before that they may not
// have read it. Score = letters right out of letters in the final script, ignoring spaces, capitals and
// punctuation, as Deepgram wrote it ("raw") and after the AI's spelling fixes ("ai", lib/spelling.ts).
// Only the stretches someone fixed are compared, so a long script costs no more than its fixes. Words the creator
// deleted don't count: they never read them. On VID20261112093656 (13 Nov) this gave 102 and 70 letters wrong of
// 2,494, where comparing the whole scripts gave 101 and 69.

type Word = { text: string };
type Fix = { from: number; to: number; text: string };

export type ClipScore = {
	chars: number; // letters in the final script (kept words)
	rawErrors: number; // letters wrong as Deepgram wrote them
	aiErrors: number | null; // after the AI's fixes; null if the AI never read this video
	fixes: number; // fixed stretches in the final script
	aiFixes: number; // fixes the AI made
	aiKept: number; // of those, still there in the final script
};

const clean = (text: string) =>
	text
		.toLowerCase()
		.replace(/ํา/g, "ำ")
		.replace(/[\s.,!?;:…"'“”‘’()[\]\-–—]+/g, "");

// Letters to change, add or remove to turn a into b. The same start and end are skipped first; a stretch still too
// long to compare letter by letter (a fix can be 2,000 letters) counts as all wrong, so one odd video can't use up
// the request's time (200 such fixes took 7.4 s, Codex review 13 Nov).
const MAX_COMPARE = 250_000; // letters × letters
export function distance(a: string, b: string) {
	let A = [...a];
	let B = [...b];
	let head = 0;
	while (head < A.length && head < B.length && A[head] === B[head]) head++;
	let tail = 0;
	while (tail < A.length - head && tail < B.length - head && A[A.length - 1 - tail] === B[B.length - 1 - tail]) tail++;
	A = A.slice(head, A.length - tail);
	B = B.slice(head, B.length - tail);
	if (A.length * B.length > MAX_COMPARE) return Math.max(A.length, B.length);
	let row = Array.from({ length: B.length + 1 }, (_, j) => j);
	for (let i = 1; i <= A.length; i++) {
		const next = [i];
		for (let j = 1; j <= B.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1));
		row = next;
	}
	return row[B.length];
}

// Words from..to as they read with `fixes` on (only fixes inside from..to).
function readAs(words: Word[], fixes: Fix[], from: number, to: number) {
	const byStart = new Map(fixes.map((f) => [f.from, f]));
	let out = "";
	for (let i = from; i <= to; i++) {
		const fix = byStart.get(i);
		if (fix && fix.to <= to) {
			out += fix.text;
			i = fix.to;
		} else out += words[i].text;
	}
	return clean(out);
}

export function scoreClip(words: Word[], fixes: Fix[] = [], deleted: number[] = [], aiFixes: Fix[] | null = null): ClipScore {
	const gone = new Set(deleted);
	const valid = (f: Fix) => Number.isInteger(f.from) && Number.isInteger(f.to) && f.from >= 0 && f.to < words.length && f.from <= f.to && typeof f.text === "string";
	// Sorted, and one that overlaps the one before is dropped (as readFixes in lib/edit.ts refuses them).
	const tidy = (list: Fix[]) =>
		list
			.filter(valid)
			.sort((a, b) => a.from - b.from)
			.filter((f, i, all) => i === 0 || f.from > all[i - 1].to);
	const final = tidy(fixes);
	const ai = tidy(aiFixes ?? []);
	const allGone = (from: number, to: number) => {
		for (let i = from; i <= to; i++) if (!gone.has(i)) return false;
		return true;
	};

	// The stretches anyone fixed, joined where they overlap, so each is compared whole.
	const spans = [...final, ...ai].map((f) => [f.from, f.to]).sort((a, b) => a[0] - b[0]);
	const regions: number[][] = [];
	for (const [from, to] of spans) {
		const last = regions[regions.length - 1];
		if (last && from <= last[1]) last[1] = Math.max(last[1], to);
		else regions.push([from, to]);
	}

	let rawErrors = 0;
	let aiErrors = 0;
	for (const [from, to] of regions) {
		if (allGone(from, to)) continue;
		const truth = readAs(words, final, from, to);
		rawErrors += distance(readAs(words, [], from, to), truth);
		aiErrors += distance(readAs(words, ai, from, to), truth);
	}

	// Letters of the final script, deleted words left out.
	let chars = 0;
	const finalAt = new Map(final.map((f) => [f.from, f]));
	for (let i = 0; i < words.length; i++) {
		const fix = finalAt.get(i);
		if (fix) {
			if (!allGone(fix.from, fix.to)) chars += [...clean(fix.text)].length;
			i = fix.to;
		} else if (!gone.has(i)) chars += [...clean(words[i].text)].length;
	}

	const kept = ai.filter((f) => readAs(words, final, f.from, f.to) === clean(f.text)).length;
	return { chars, rawErrors, aiErrors: aiFixes ? aiErrors : null, fixes: final.length, aiFixes: ai.length, aiKept: kept };
}

// One video on the admin's Accuracy tab (api/admin/accuracy). guessed: the language was guessed from the letters.
export type AccuracyRow = ClipScore & { id: string; file: string; email: string | null; language: string; guessed: boolean; at: string };

export const percentRight = (errors: number, chars: number) => (chars ? Math.max(0, 100 - (100 * errors) / chars) : null);

// Older videos didn't keep the language they were listened in: guessed from their letters, and shown as a guess.
export function guessScript(words: Word[]) {
	const text = words
		.slice(0, 300)
		.map((w) => w.text)
		.join("");
	const thai = (text.match(/[฀-๿]/g) ?? []).length;
	const cyrillic = (text.match(/[Ѐ-ӿ]/g) ?? []).length;
	const latin = (text.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;
	if (thai >= cyrillic && thai >= latin && thai > 0) return "th";
	if (cyrillic > latin) return "cyrillic";
	return "latin";
}
