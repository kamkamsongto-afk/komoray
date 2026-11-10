// Thai word cutting: newmm from PyThaiNLP (https://github.com/PyThaiNLP/pythainlp), put into TypeScript so it runs
// in the Worker. Copyright PyThaiNLP Project, Apache License 2.0; the rules for Thai letter groups (TCC) are by
// Jakkrit TeCho, Wittawat Jitkrittum and Korakot Chaovavanich. Changed from the original: only the language.
// Checked word by word against PyThaiNLP 5.4.0 (11 Nov 2026): don't "tidy" a rule here without checking again.
import { THAI_DICTIONARY } from "./thai-dictionary";

// c = a consonant, t = a tone mark, k = a silenced ending. Order matters: the first rule that fits wins.
const TCC_RULES = `เc็ck
เcctาะk
เccีtยะk
เccีtย(?=[เ-ไก-ฮ]|$)k
เcc็ck
เcิc์ck
เcิtck
เcีtยะ?k
เcืtอะ?k
เc[ิีุู]tย(?=[เ-ไก-ฮ]|$)k
เctา?ะ?k
cัtวะk
c[ัื]tc[ุิะ]?k
c[ิุู]์
c[ะ-ู]tk
cรรc์
c็
ct[ะาำ]?k
ck
แc็c
แcc์
แctะ
แcc็c
แccc์
โctะ
[เ-ไ]ct
ก็
อึ
หึ`
	.replace(/k/g, "(cc?[dิ]?[์])?")
	.replace(/c/g, "[ก-ฮ]")
	.replace(/t/g, "[่-๋]?")
	.replace(/d/g, "ูุ")
	.split("\n");
const TCC = new RegExp(TCC_RULES.join("|"), "uy");
const NON_THAI = /[-a-zA-Z]+|\p{Nd}+([,.]\p{Nd}+)*|[ \t]+|\r?\n|[^฀-๿ \t\r\n]+/uy;
const TWO_LETTERS = /^[ก-ฮ]{0,2}$/;
const MAX_GRAPH = 50; // choices remembered at once, so odd text can't take forever

// Built the first time a Thai script arrives, then kept for as long as the Worker lives.
let words: Set<string> | undefined;
let lengths: number[] = [];
function dictionary() {
	if (!words) {
		words = new Set(THAI_DICTIONARY.split("\n").map((w) => w.trim()).filter(Boolean));
		lengths = [...new Set([...words].map((w) => w.length))].sort((a, b) => a - b);
	}
	return words;
}

// Every dictionary word that starts at `at`, shortest first.
function wordsAt(text: string, at: number) {
	const all = dictionary();
	const found: string[] = [];
	for (const length of lengths) {
		if (at + length > text.length) break;
		const piece = text.slice(at, at + length);
		if (all.has(piece)) found.push(piece);
	}
	return found;
}

const matchAt = (pattern: RegExp, text: string, at: number) => {
	pattern.lastIndex = at;
	return pattern.exec(text);
};

// Where a word may end: never inside a group of Thai letters.
function letterGroupEnds(text: string) {
	const ends = new Uint8Array(text.length + 1);
	let at = 0;
	while (at < text.length) {
		// A letter outside Thai's first 65,536 is two units here: moving by one still lands on its end.
		at += matchAt(TCC, text, at)?.[0].length || 1;
		ends[at] = 1;
	}
	return ends;
}

// The first way (fewest steps) from one position to another, through the words found so far.
function firstPath(graph: Map<number, number[]>, start: number, goal: number) {
	const visited = new Set([start]);
	const queue: [number, number[]][] = [[start, [start]]];
	for (let head = 0; head < queue.length; head++) {
		const [at, path] = queue[head];
		for (const next of graph.get(at) ?? []) {
			if (next === goal) return [...path, next];
			if (!visited.has(next)) {
				visited.add(next);
				queue.push([next, [...path, next]]);
			}
		}
	}
	return [start, goal];
}

// Text the dictionary doesn't know: how far to skip before something it does.
function skipUnknown(text: string, begin: number, ends: Uint8Array) {
	const other = matchAt(NON_THAI, text, begin);
	if (other) return begin + other[0].length;
	for (let at = begin + 1; at < text.length; at++) {
		if (!ends[at]) continue;
		if (wordsAt(text, at).some((w) => ends[at + w.length] && !TWO_LETTERS.test(w))) return at;
		if (matchAt(NON_THAI, text, at)) return at;
	}
	return text.length;
}

export function cutThaiWords(text: string) {
	const tokens: string[] = [];
	if (!text) return tokens;
	const ends = letterGroupEnds(text);
	const graph = new Map<number, number[]>();
	let graphSize = 0;
	let waiting = [0]; // possible places a word could start, smallest first
	let done = 0;
	while (waiting[0] < text.length) {
		const begin = waiting.shift() as number;
		for (const word of wordsAt(text, begin)) {
			const end = begin + word.length;
			if (!ends[end]) continue;
			graph.set(begin, [...(graph.get(begin) ?? []), end]);
			graphSize++;
			if (!waiting.includes(end)) waiting = [...waiting, end].sort((a, b) => a - b);
			if (graphSize > MAX_GRAPH) break;
		}
		if (waiting.length === 1) {
			for (const at of firstPath(graph, done, waiting[0]).slice(1)) {
				tokens.push(text.slice(done, at));
				done = at;
			}
			graphSize = 0;
			graph.clear();
		} else if (!waiting.length) {
			done = skipUnknown(text, begin, ends);
			graphSize = 0;
			graph.clear();
			tokens.push(text.slice(begin, done));
			waiting = [done];
		}
	}
	return tokens;
}
