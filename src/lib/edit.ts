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
	// The hand cuts as they are saved (to the millisecond, joined). The browser held a drag's raw seconds while the
	// video got the saved ones: a cut edge near half a frame moved a word across it, the preview's subtitle lines no
	// longer matched the video's words, and Make video stopped (review, 29 Nov).
	const manualCuts = asSaved(edit.manual ?? [], edit.duration);
	const kept = asSaved(edit.keep ?? [], edit.duration);
	const auto = [
		...edit.cuts.map((c) => ({ start: c.start, end: c.end, reason: "silence" as const })),
		...wordCuts(edit.words, edit.deleted ?? [], edit.duration),
	];
	const manual = manualCuts.map((c) => ({ start: c.start, end: c.end, reason: "manual" as const }));
	return [...subtractSpans(auto, kept), ...manual].sort((a, b) => a.start - b.start);
}

// Hand-cut spans as they are kept: whole milliseconds, never past the end, joined where they touch (readSpans).
function asSaved(spans: Span[], duration: number) {
	return mergeSpans(spans.map(({ start, end }) => ({ start: Math.round(start * 1000) / 1000, end: Math.round(Math.min(end, duration) * 1000) / 1000 })));
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
		spans.push({ start, end });
	}
	return asSaved(spans, duration);
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

// Cuts Thai typed with no spaces into words: newmm (lib/newmm.ts). Passed in, not imported: its dictionary is 1.5 MB, so
// the editor loads it only for a video with Thai fixes, and the render route always has it.
export type ThaiCut = (text: string) => string[];
const THAI_LETTER = /[฀-๿]/;

// A fix with spaces in it is several words, each with its own time, or the Highlight look and Bounce
// treat the whole phrase as one word. The time is shared by letters over when the words were really
// said (never the pauses between them, which may be cut). space: the user typed a space before it.
// Thai typed with no spaces is several words too, once cut (coach 15 Nov: a retyped line lit up as one block).
// br: two spaces (or more) typed before it: a new subtitle line starts there (coach 20 Nov: Split was for moving
// subtitles, not for where a line breaks). LINE_BREAK = the typed gap that means it.
export const LINE_BREAK = /\s{2,}|\n/;
// Two spaces typed before the first word: the line breaks before it too. The only way to break between words with a cut
// between them, as one fix can't cover both sides (coach 20 Nov: "ก็คือ | ไม่อยากจะ" with cut words between).
export const LEAD_BREAK = /^(?:\s{2,}|\s*\n)/;
// Two spaces typed after the last word: the next line starts after it (coach 22 Nov, VID20261120105025: "before or after
// the word, two spaces mean a break"). fixedWords gives the word after the fix br.
export const TRAIL_BREAK = /\S(?:\s{2,}|\s*\n\s*)$/;
// A fix's text as kept: trimmed, but a leading or a trailing break stays (as two spaces).
export const fixText = (text: string) => (LEAD_BREAK.test(text) && text.trim() ? "  " : "") + text.trim() + (TRAIL_BREAK.test(text) ? "  " : "");
function splitFix<W extends Span & { text: string }>(run: W[], text: string, cut?: ThaiCut): W[] {
	const pieces: string[] = [];
	const spaced: boolean[] = [];
	const broken: boolean[] = [];
	const gaps = text.trim().match(/\s+/g) ?? [];
	const lead = LEAD_BREAK.test(text);
	for (const [n, chunk] of text.trim().split(/\s+/).entries()) {
		const words = cut && THAI_LETTER.test(chunk) ? cut(chunk).filter((w) => w.trim()) : [chunk];
		for (const [k, word] of (words.length ? words : [chunk]).entries()) {
			pieces.push(word);
			spaced.push(n > 0 && k === 0);
			broken.push(k === 0 && (n > 0 ? LINE_BREAK.test(gaps[n - 1]) : lead));
		}
	}
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
		return [{ ...run[0], text: text.trim(), start: run[best[0]].start, end: run[best[1]].end, ...(lead ? { br: true } : {}) }];
	}
	// The times of pieces..: shared out by letters over these words' speech.
	const share = (words: W[], texts: string[]) => {
		const spoken = words.reduce((sum, w) => sum + w.end - w.start, 0);
		const letters = texts.reduce((sum, p) => sum + spokenLetters(p), 0);
		// Which word is being said after `gone` seconds of speech, and when.
		const at = (gone: number) => {
			let left = gone;
			for (const w of words) {
				if (left < w.end - w.start) return { word: w, time: w.start + left };
				left -= w.end - w.start;
			}
			const last = words[words.length - 1];
			return { word: last, time: last.end };
		};
		// The end of a piece: where its letters run out, or the first real pause on the way there,
		// since a piece over a pause that gets cut would land in the cut and vanish.
		const endOf = (from: W, to: { word: W; time: number }) => {
			for (let k = words.indexOf(from); k < words.indexOf(to.word); k++) if (words[k + 1].start - words[k].end > PAUSE_INSIDE_FIX) return words[k].end;
			return to.time;
		};
		let done = 0;
		return texts.map((piece) => {
			const from = at((spoken * done) / letters);
			done += spokenLetters(piece);
			return { start: from.time, end: endOf(from.word, at((spoken * done) / letters)) };
		});
	};
	// As many words as were said, none Thai (spelling fixed, or only two spaces typed for a new line): each keeps the time
	// it was said, so the Highlight look doesn't drift from the voice.
	const same = pieces.length === run.length && !THAI_LETTER.test(text);
	const times = same ? run.map((w) => ({ start: w.start, end: w.end })) : alignedTimes(run, pieces, share);
	return pieces.map((piece, k) => {
		// glue: cut out of words typed together ("ของโค้ช"), so a subtitle line never breaks before it (coach 16 Nov).
		const glue = k > 0 && !spaced[k];
		return { ...run[0], text: piece, ...times[k], ...(spaced[k] ? { space: true } : {}), ...(glue ? { glue: true } : {}), ...(broken[k] ? { br: true } : {}) };
	});
}

// Pieces that read exactly as the words said (spaces aside), from the start and from the end, take those words' own
// times; only what was really retyped in between is shared out by letters (share). Coach 22 Nov, VID20261120105025:
// "ราคา2,990บาท" retyped over "ราคา 2, 9 9 0 บาท" gave "2,990" 0.1 s by its 5 letters, so a gap before "บาท" broke the line
// ("ราคา 2,990" / "บาท"). Spoken numbers are long for their letters; the words' own times never are wrong.
function alignedTimes<W extends Span & { text: string }>(run: W[], pieces: string[], share: (words: W[], texts: string[]) => Span[]): Span[] {
	const squash = (t: string) => t.replace(/\s+/g, "");
	const times: (Span | null)[] = pieces.map(() => null);
	let head = 0; // pieces matched from the start
	let used = 0; // words they took
	while (head < pieces.length && used < run.length) {
		const want = squash(pieces[head]);
		let got = "";
		let k = used;
		while (k < run.length && got.length < want.length) got += squash(run[k++].text);
		if (got !== want) break;
		times[head++] = { start: run[used].start, end: run[k - 1].end };
		used = k;
	}
	let tail = pieces.length - 1; // pieces matched from the end
	let left = run.length - 1;
	while (tail >= head && left >= used) {
		const want = squash(pieces[tail]);
		let got = "";
		let k = left;
		while (k >= used && got.length < want.length) got = squash(run[k--].text) + got;
		if (got !== want) break;
		times[tail--] = { start: run[k + 1].start, end: run[left].end };
		left = k;
	}
	const middle = pieces.slice(head, tail + 1);
	if (!middle.length) return times as Span[];
	const words = run.slice(used, left + 1);
	// Retyped words with nothing said left for them: the old sharing over the whole run, as before.
	if (!words.length) return share(run, pieces);
	share(words, middle).forEach((t, n) => (times[head + n] = t));
	return times as Span[];
}

// The words as they should read in subtitles: a fix takes the place of the words it covers.
// cut: Thai typed with no spaces becomes its words (left out: such a fix stays one word).
// deleted: those words get gone: true, so a word deleted in the script never shows in the subtitles even when part of
// its sound was dragged back in on the timeline (placeWord in timeline.ts, place_word in render.py).
export function fixedWords<W extends Span & { text: string }>(words: W[], fixes: Fix[] = [], cut?: ThaiCut, deleted: number[] = []): (W & { gone?: true })[] {
	const byStart = new Map(fixes.map((f) => [f.from, f]));
	const gone = new Set(deleted);
	const out: (W & { gone?: true; br?: true })[] = [];
	// A fix ending in two spaces (TRAIL_BREAK): the next word still shown starts a new subtitle line (coach 22 Nov).
	let breakNext = false;
	const push = (w: W & { gone?: true; br?: true }) => {
		if (breakNext && !w.gone) {
			breakNext = false;
			out.push({ ...w, br: true });
		} else out.push(w);
	};
	for (let i = 0; i < words.length; i++) {
		const fix = byStart.get(i);
		if (!fix) {
			push(gone.has(i) ? { ...words[i], gone: true } : words[i]);
			continue;
		}
		// A fix is gone only when every word under it is.
		const allGone = Array.from({ length: fix.to - fix.from + 1 }, (_, k) => fix.from + k).every((k) => gone.has(k));
		for (const w of splitFix(words.slice(fix.from, fix.to + 1), fix.text, cut)) push(allGone ? { ...w, gone: true as const } : w);
		if (TRAIL_BREAK.test(fix.text)) breakNext = true;
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

// A fix that starts with the word just before it, or ends with the word just after it, is the words from..to
// together with that neighbour: Thai shows no gaps between words, so a creator double-clicks "ใช่" in "ไม่ใช่",
// types "ไม่ใช่", and the subtitle read "ไม่ไม่ใช่" (or "นะครับครับ" from "นะ" → "นะครับ"). Seen 3 times in
// VID20261112093656, 13 Nov. Returns the words the fix really covers. `words` = the words as the script draws them.
const MAX_NEIGHBOURS = 3;
const squashWord = (text: string) => normText(text).replace(/\s+/g, "");
function opens(text: string, word: string) {
	if (/[฀-๿]/.test(word)) return squashWord(text).length > squashWord(word).length && squashWord(text).startsWith(squashWord(word));
	return normText(text).startsWith(`${normText(word)} `);
}
function closes(text: string, word: string) {
	if (/[฀-๿]/.test(word)) return squashWord(text).length > squashWord(word).length && squashWord(text).endsWith(squashWord(word));
	return normText(text).endsWith(` ${normText(word)}`);
}
// gone: words cut from the video are never taken in. "มัน" was cut, the creator typed "มันมีสัญญาณ…" over the words after
// it, the fix took the cut word in and, starting on a cut word, the whole sentence showed (and played) as cut (coach 20 Nov).
export function withNeighbours(words: { index: number; last: number; text: string }[], from: number, to: number, text: string, shown: string, gone?: (index: number) => boolean) {
	let first = words.findIndex((w) => w.index === from);
	let last = words.findIndex((w) => w.last === to);
	if (first < 0 || last < 0 || !normText(text)) return { from, to };
	for (let n = 0; n < MAX_NEIGHBOURS && first > 0; n++) {
		const before = words[first - 1].text;
		if (gone?.(words[first - 1].index) || !opens(text, before) || opens(shown, before)) break;
		first--;
		shown = /[฀-๿]/.test(before) ? before + shown : `${before} ${shown}`;
	}
	for (let n = 0; n < MAX_NEIGHBOURS && last < words.length - 1; n++) {
		const after = words[last + 1].text;
		if (gone?.(words[last + 1].index) || !closes(text, after) || closes(shown, after)) break;
		last++;
		shown = /[฀-๿]/.test(after) ? shown + after : `${shown} ${after}`;
	}
	return { from: words[first].index, to: words[last].last };
}

// Put a fix on words from..to, replacing any fix it overlaps. The original text (or nothing) removes it.
export function setFix(fixes: Fix[], from: number, to: number, text: string, original: string): Fix[] {
	const kept = fixes.filter((f) => f.to < from || f.from > to);
	const clean = fixText(text);
	// Too long: nothing changes, and the box says so. Cutting it here made the end of the text vanish from the script and the subtitles.
	if (clean.length > MAX_FIX_LENGTH) return fixes;
	if (clean.trim() && clean !== original) kept.push({ from, to, text: clean });
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
		fixes.push({ from: from!, to: to!, text: fixText(text) });
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
