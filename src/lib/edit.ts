import { PACES, PADDING } from "./silences";

type Span = { start: number; end: number };
export type EditCut = Span & { reason: "silence" | "words" | "manual" };

// Words the user deleted in the Script view become cuts. Each run of deleted words is cut
// from just before its first word to just before the next kept word, so the pause after it goes too.
export function wordCuts(words: Span[], deleted: number[], duration: number): EditCut[] {
	const gone = new Set(deleted);
	const cuts: EditCut[] = [];
	let i = 0;
	while (i < words.length) {
		if (!gone.has(i)) {
			i++;
			continue;
		}
		let j = i;
		while (gone.has(j + 1)) j++;
		const prev = words[i - 1];
		const next = words[j + 1];
		const start = prev ? Math.max(prev.end, words[i].start - PADDING) : 0;
		const end = next ? Math.max(words[j].end, next.start - PADDING) : duration;
		if (end > start) cuts.push({ start, end, reason: "words" });
		i = j + 1;
	}
	return cuts;
}

// Cut or kept by hand on the timeline (source seconds). `manual` is cut whatever is said there;
// `keep` stays in the video although a silence or a deleted word's cut covered it (e.g. the end of
// a word dragged back in). Deleting words again takes their part out of `keep` (page.tsx).
export type HandEdits = { manual?: Span[]; keep?: Span[] };

// Every cut for the final video: the silences and the deleted words (minus what was kept by hand),
// plus the hand cuts.
export function allCuts(edit: { duration: number; cuts: Span[]; words: Span[]; deleted?: number[] } & HandEdits): EditCut[] {
	const auto = [
		...edit.cuts.map((c) => ({ start: c.start, end: c.end, reason: "silence" as const })),
		...wordCuts(edit.words, edit.deleted ?? [], edit.duration),
	];
	const manual = (edit.manual ?? []).map((c) => ({ start: c.start, end: c.end, reason: "manual" as const }));
	return [...subtractSpans(auto, edit.keep ?? []), ...manual].sort((a, b) => a.start - b.start);
}

// Spans sorted and joined where they touch or overlap.
export function mergeSpans(spans: Span[]): Span[] {
	const out: Span[] = [];
	for (const s of [...spans].sort((a, b) => a.start - b.start)) {
		const last = out[out.length - 1];
		if (last && s.start <= last.end + 0.001) last.end = Math.max(last.end, s.end);
		else if (s.end > s.start) out.push({ start: s.start, end: s.end });
	}
	return out;
}

// `spans` with the parts inside any of `holes` taken out.
export function subtractSpans<S extends Span>(spans: S[], holes: Span[]): S[] {
	if (!holes.length) return spans;
	const gaps = mergeSpans(holes);
	const out: S[] = [];
	for (const s of spans) {
		let pos = s.start;
		for (const h of gaps) {
			if (h.end <= pos || h.start >= s.end) continue;
			if (h.start - pos > 0.01) out.push({ ...s, start: pos, end: h.start });
			pos = Math.max(pos, h.end);
		}
		if (s.end - pos > 0.01) out.push({ ...s, start: pos, end: s.end });
	}
	return out;
}

// Hand spans sent by the browser, checked: inside the video, at most MAX_HAND_SPANS. Null if bad.
export const MAX_HAND_SPANS = 1000;
export function readSpans(value: unknown, duration: number): Span[] | null {
	if (!Array.isArray(value) || value.length > MAX_HAND_SPANS) return null;
	const spans: Span[] = [];
	for (const v of value as Partial<Span>[]) {
		const { start, end } = v ?? {};
		if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end)) return null;
		if (start < 0 || end > duration + 0.01 || end <= start) return null;
		spans.push({ start: Math.round(start * 1000) / 1000, end: Math.round(Math.min(end, duration) * 1000) / 1000 });
	}
	return mergeSpans(spans);
}

// Words the user retyped in the script: words from..to (positions in the transcript) read as `text`.
// Deepgram's own words stay untouched, so cuts and deleted words keep working on the same positions.
export type Fix = { from: number; to: number; text: string };

export const MAX_FIX_LENGTH = 2000;

// Words compared the way people read them: ignore capitals, spacing and punctuation at the ends
// ("People," = "people"). Used to find words in the script and as the personal dictionary's key.
export const TRAIL = /[.,!?;:…]+$/;
export const normText = (text: string) =>
	text
		.toLowerCase()
		.replace(/\s+/g, " ")
		.replace(/^[\s"'“”‘’([]+|[\s"'“”‘’)\].,!?;:…]+$/g, "");

// One entry of the personal dictionary (table word_fixes): the script showed `heard`, the user wants `fixed`.
export type WordFix = { heard: string; fixed: string };

// A retyped word is only as long as its letters; marks above and below a Thai letter take no time.
const spokenLetters = (text: string) => Math.max(1, text.replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, "").length);

const PAUSE_INSIDE_FIX = 0.05; // seconds between two words that counts as a pause, not words said in a row
const CUTTABLE_PAUSE = PACES.tight.minSilence; // the shortest pause any pace cuts (lib/silences.ts)

// A fix with spaces in it is several words, each with its own time, or the Highlight look and Bounce
// treat the whole phrase as one word. The time is shared by letters over when the words were really
// said (never the pauses between them, which may be cut). space: the user typed a space before it.
function splitFix<W extends Span & { text: string }>(run: W[], text: string): W[] {
	const pieces = text.trim().split(/\s+/);
	if (pieces.length === 1) {
		// One word over a pause: timed on its longest stretch of speech, not across the pause. Subtitles place a word
		// at its middle, and the middle of "ส|่วน|ใหญ่" (263.00-264.04 s) fell in the 263.35-263.62 s silence that was cut,
		// so the fixed word vanished from the subtitles (VID20261112093656, 13 Nov).
		let best = [0, 0];
		for (let s = 0, k = 1; k <= run.length; k++) {
			if (k < run.length && run[k].start - run[k - 1].end < CUTTABLE_PAUSE) continue;
			if (run[k - 1].end - run[s].start > run[best[1]].end - run[best[0]].start) best = [s, k - 1];
			s = k;
		}
		return [{ ...run[0], text, start: run[best[0]].start, end: run[best[1]].end }];
	}
	const spoken = run.reduce((sum, w) => sum + w.end - w.start, 0);
	const letters = pieces.reduce((sum, p) => sum + spokenLetters(p), 0);
	// Which word is being said after `gone` seconds of speech, and when.
	const at = (gone: number) => {
		let left = gone;
		for (const w of run) {
			if (left < w.end - w.start) return { word: w, time: w.start + left };
			left -= w.end - w.start;
		}
		const last = run[run.length - 1];
		return { word: last, time: last.end };
	};
	// The end of a piece: where its letters run out, or the first real pause on the way there,
	// since a piece over a pause that gets cut would land in the cut and vanish.
	const endOf = (from: W, to: { word: W; time: number }) => {
		for (let k = run.indexOf(from); k < run.indexOf(to.word); k++) if (run[k + 1].start - run[k].end > PAUSE_INSIDE_FIX) return run[k].end;
		return to.time;
	};
	let done = 0;
	return pieces.map((piece, k) => {
		const from = at((spoken * done) / letters);
		done += spokenLetters(piece);
		return { ...run[0], text: piece, start: from.time, end: endOf(from.word, at((spoken * done) / letters)), ...(k ? { space: true } : {}) };
	});
}

// The words as they should read in subtitles: a fix takes the place of the words it covers.
export function fixedWords<W extends Span & { text: string }>(words: W[], fixes: Fix[] = []): W[] {
	const byStart = new Map(fixes.map((f) => [f.from, f]));
	const out: W[] = [];
	for (let i = 0; i < words.length; i++) {
		const fix = byStart.get(i);
		if (!fix) {
			out.push(words[i]);
			continue;
		}
		out.push(...splitFix(words.slice(fix.from, fix.to + 1), fix.text));
		i = fix.to;
	}
	return out;
}

// Find inside words: Thai has no spaces, so a misheard part often sits in the middle of a word
// ("ฉนั้น" inside "ราะฉนั้น") and looking only at word starts missed it. keep = the text around each
// hit, so joining it with the replacement gives the word's new text. Thai searches only: in
// English, "the" must not hit "there". Fix all and the dictionary stay on whole words, for the same reason.
export function findInside(words: { index: number; last: number; text: string; space: boolean }[], target: string) {
	const matches: { from: number; to: number; trail: string; keep: string[] }[] = [];
	const starts: number[] = [];
	let joined = "";
	words.forEach((w, k) => {
		if (k && w.space) joined += " ";
		starts.push(joined.length);
		joined += w.text.toLowerCase();
	});
	let item = 0; // the word the search has reached
	let doneWord = -1; // the word the previous hit ended in, and where in it
	let doneAt = 0;
	for (let hit = joined.indexOf(target); hit !== -1; hit = joined.indexOf(target, hit + target.length)) {
		while (item + 1 < words.length && starts[item + 1] <= hit) item++;
		let end = item;
		while (end + 1 < words.length && starts[end + 1] < hit + target.length) end++;
		const head = hit - starts[item];
		const tail = hit + target.length - starts[end];
		const last = matches[matches.length - 1];
		if (last && doneWord === item) {
			// A second hit in the word the last one ended in: both are one fix of that word.
			last.keep[last.keep.length - 1] = words[item].text.slice(doneAt, head);
			last.keep.push(words[end].text.slice(tail));
			last.to = words[end].last;
		} else matches.push({ from: words[item].index, to: words[end].last, trail: "", keep: [words[item].text.slice(0, head), words[end].text.slice(tail)] });
		doneWord = end;
		doneAt = tail;
	}
	return matches;
}

// Put a fix on words from..to, replacing any fix it overlaps. The original text (or nothing) removes it.
export function setFix(fixes: Fix[], from: number, to: number, text: string, original: string): Fix[] {
	const kept = fixes.filter((f) => f.to < from || f.from > to);
	const clean = text.trim();
	// Too long: nothing changes, and the box says so. Cutting it here made the end of the text vanish from the script and the subtitles.
	if (clean.length > MAX_FIX_LENGTH) return fixes;
	if (clean && clean !== original) kept.push({ from, to, text: clean });
	return kept.sort((a, b) => a.from - b.from);
}

// Fixes sent by the browser, checked: whole numbers inside the transcript, no overlaps. Null if bad.
export function readFixes(value: unknown, count: number): Fix[] | null {
	if (!Array.isArray(value)) return null;
	const fixes: Fix[] = [];
	for (const f of value as Partial<Fix>[]) {
		const { from, to, text } = f ?? {};
		if (!Number.isInteger(from) || !Number.isInteger(to) || typeof text !== "string") return null;
		if (from! < 0 || to! < from! || to! >= count || !text.trim() || text.length > MAX_FIX_LENGTH) return null;
		fixes.push({ from: from!, to: to!, text: text.trim() });
	}
	fixes.sort((a, b) => a.from - b.from);
	return fixes.every((f, i) => i === 0 || f.from > fixes[i - 1].to) ? fixes : null;
}

// Seconds removed in total (cuts can overlap, so merge them first).
export function cutSeconds(cuts: Span[]): number {
	let total = 0;
	let reach = 0;
	for (const c of [...cuts].sort((a, b) => a.start - b.start)) {
		const start = Math.max(c.start, reach);
		if (c.end > start) total += c.end - start;
		reach = Math.max(reach, c.end);
	}
	return total;
}
