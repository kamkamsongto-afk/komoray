// Old bugs that must not come back (docs/bugs.md), and saved settings that must survive saving. Web code only.
import { isDeepStrictEqual } from "node:util";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lib, repo, ts } from "./lib.mjs";

const frame = lib("src/lib/frame-me");
const layout = lib("src/lib/layout");
const banners = lib("src/lib/banners");
const behind = lib("src/lib/behind");
const zoom = lib("src/lib/zoom");
const style = lib("src/lib/subtitle-style");
const fades = lib("src/lib/fades");
const silences = lib("src/lib/silences");
const thaiWords = lib("src/lib/thai-words");
const thaiNumbers = lib("src/lib/thai-numbers");
const rows = lib("src/lib/lane-rows");

let failed = 0;
function check(name, run) {
	let problem;
	try {
		problem = run();
	} catch (err) {
		problem = `stopped: ${err.message}`;
	}
	console.log(`${problem ? "FAIL" : "ok  "}  ${name}${problem ? `\n        ${problem}` : ""}`);
	if (problem) failed++;
}
const same = (got, want) => (isDeepStrictEqual(got, want) ? null : `got ${JSON.stringify(got)}, should be ${JSON.stringify(want)}`);

// ---- saved settings: every field of a type must come back from its reader ----
// The field names written in `export type <name> = { ... }`.
function fieldsOf(file, name) {
	const source = ts.createSourceFile(file, readFileSync(join(repo, file), "utf8"), ts.ScriptTarget.ES2022, true);
	let found = null;
	const members = (node) => {
		if (ts.isTypeLiteralNode(node)) return node.members.filter(ts.isPropertySignature).map((m) => m.name.getText(source));
		if (ts.isIntersectionTypeNode(node)) return node.types.flatMap(members);
		return [];
	};
	source.forEachChild((node) => {
		if (ts.isTypeAliasDeclaration(node) && node.name.text === name) found = members(node.type);
	});
	if (!found) throw new Error(`type ${name} not found in ${file}`);
	return found;
}
const FADES = { fadeIn: false, fadeOut: false };
const CLIP = { volume: 0.4, muted: true, clipFrom: 2.5 };
// fields: the type's own field names. full: one item with every one of them set to something that is not the default.
// elsewhere: fields this reader is right to drop for this kind of item.
function survives(name, file, type, full, read, elsewhere = []) {
	check(`${name}: every saved field survives`, () => {
		const missing = fieldsOf(file, type).filter((f) => !(f in full) && !elsewhere.includes(f));
		if (missing.length) return `this check has no value for the new field(s) ${missing.join(", ")}: add them in scripts/check/rules.mjs`;
		const out = read(full);
		if (!out) return "the reader refused the item";
		const lost = Object.keys(full).filter((key) => !isDeepStrictEqual(out[key], full[key]));
		if (lost.length) return lost.map((k) => `${k}: saved ${JSON.stringify(full[k])}, back ${JSON.stringify(out[k])}`).join("; ");
		return same(read(out), out);
	});
}

survives("Frame Me", "src/lib/frame-me.ts", "FrameMe", {
	id: "a", start: 1, end: 3, shape: "heart", x: 0.4, y: 0.3, size: 0.8, zoom: 0.9, meX: 0.4, meY: 0.6, border: 12, borderColor: "#FFE600", back: "file", backColor: "#FF2D95", dim: 0.4, blur: 20,
	file: "media-abc.mp4", media: "video", ...CLIP, backMotion: "panLeft", backAmount: 0.3, backSpeed: 3, backSize: 0.6, backX: 0.2, backY: -0.1, ...(frame.FRAME.back?.rotate && { backRotate: 25 }), name: "Mine", ...FADES,
}, (x) => frame.readFrames([x])?.[0]);

survives("Layout", "src/lib/layout.ts", "VideoLayout", {
	id: "a", start: 1, end: 4, kind: "side", meFirst: false, split: 0.4, meX: 0.3, meY: 0.6, meZoom: 1.4, color: "#34C759", enter: "flash", inFade: true, outFade: true, file: "media-abc.mp4", media: "video", ...CLIP,
	fileZoom: 1.5, fileX: 0.3, fileY: 0.7, ...(layout.LAYOUT.fileRotate && { fileRotate: -40 }), fileMotion: "in", fileMotionZoom: 0.3, fileMotionSpeed: 3, name: "Mine",
}, (x) => layout.readLayouts([x])?.[0]);

survives("Banner (words)", "src/lib/banners.ts", "Banner", {
	id: "a", kind: "price", text: "One\nTwo", sub: "small", start: 1, end: 4, place: "bottom", x: 0.3, y: 0.6, scale: 1.5, color: "#0A84FF", ink: "#FFFFFF", radius: 20, opacity: 0.8, anim: "pop",
	font: "kanit", lineGap: 12, noBox: true, align: "left", name: "Mine", rotate: 15, padding: 10, templateId: "t-1", stroke: 4, strokeColor: "#FF3B30", ...FADES,
}, (x) => banners.readBanners([x])?.[0], ["ownFont", "file", "media", "volume", "muted", "clipFrom"]);

survives("Banner (a clip)", "src/lib/banners.ts", "Banner", {
	id: "a", kind: "file", text: "Clip", sub: "", start: 1, end: 4, place: "middle", x: 0.3, y: 0.6, scale: 1.5, opacity: 0.8, anim: "slideUp", name: "Mine", rotate: 15, templateId: "t-1", file: "banner-abc.mp4", media: "video", ...CLIP, ...FADES,
}, (x) => banners.readBanners([x])?.[0], ["color", "ink", "radius", "font", "ownFont", "lineGap", "noBox", "align", "padding", "stroke", "strokeColor"]);

survives("Cutout picture or clip", "src/lib/behind.ts", "Insert", {
	id: "a", kind: "video", file: "insert-abc.mp4", start: 1, end: 4, speakerScale: 0.6, speakerX: 0.7, hidden: true, name: "Mine", soft: 0.1, speakerLift: 0.1, picScale: 1.2, picX: 0.1, picY: -0.1, picRotate: 20,
	seeThrough: false, picMotion: "tiltUp", picZoom: 0.3, picSpeed: 3, ...CLIP, ...FADES,
}, (x) => behind.readCutout({ texts: [], inserts: [x] })?.inserts[0]);

survives("Cutout text", "src/lib/behind.ts", "BehindText", {
	id: "a", text: "WOW", start: 1, end: 4, font: "kanit", size: 200, color: "#FFE600", stroke: 6, strokeColor: "#FF3B30", fx: "pulse", speed: "fast", y: 0.4, lineGap: 10, dim: 0.3, blur: 8, ...FADES,
}, (x) => behind.readCutout({ texts: [x], inserts: [] })?.texts[0], ["ownFont"]);

// A text with a font of one's own (from 25 Nov, once the type has the field).
if (fieldsOf("src/lib/behind.ts", "BehindText").includes("ownFont")) {
	const file = "a".repeat(64);
	const mine = { id: "a", text: "WOW", start: 1, end: 4, font: "own", ownFont: { family: "My Font", height: 1.4, version: 0, file } };
	check("Cutout text: an own font survives saving, and counts as used in My files", () => {
		const out = behind.readCutout({ texts: [mine], inserts: [] })?.texts[0];
		if (!isDeepStrictEqual([out?.font, out?.ownFont], [mine.font, mine.ownFont])) return JSON.stringify(out);
		const { idsIn } = lib("src/lib/my-files-usage");
		return idsIn({ cutout: { texts: [out], inserts: [] } }).includes(file) ? null : "My files would let it be deleted without a warning";
	});
}

survives("Zoom part", "src/lib/zoom.ts", "ZoomPart", { start: 1, end: 4, zoom: "out", amount: 1.2, whole: true }, (x) => zoom.readZoomParts([x], 100)?.[0]);

check("Subtitle style: reading it twice changes nothing", () => {
	const once = style.readStyle({ ...style.DEFAULT_STYLE, size: 120, look: "two", zoom: "smooth", splits: [3, 1] });
	return same(style.readStyle(once), once);
});

// ---- old bugs ----
const w = (text, start, end) => ({ text, start, end });
const said = (...texts) => texts.map((text, k) => w(text, k * 0.3, k * 0.3 + 0.28));
const texts = (words) => words.map((x) => x.text);

check("An item saved without fade switches still fades in and out (20 Nov)", () => same(fades.fadesOn({}), { in: true, out: true }));

check("A pause longer than 0.4 s is cut, with room left round the words", () =>
	same(silences.findSilences({ duration: 3, words: [w("a", 0, 0.5), w("b", 0.8, 1.2), w("c", 2.2, 3)] }).map((c) => [c.start, c.end]), [[1.3, 2.1]]));

check("Thai: a number said digit by digit is one word (22 Nov)", () => same(texts(thaiWords.mergeThaiWords(said("ราคา", "9", "9", "0", "บาท"))), ["ราคา", "990", "บาท"]));
check("Thai: two whole numbers are not joined (22 Nov)", () => {
	const out = texts(thaiWords.mergeThaiWords(said("เลข", "10", "20", "ครับ")));
	return out.includes("1020") ? `joined into ${out.join(" ")}` : null;
});
check("English: a count is not joined into one number (22 Nov)", () => same(texts(thaiWords.mergeThaiWords(said("count", "1", "2", "3", "now"))), ["count", "1", "2", "3", "now"]));
check("Thai numbers in words become digits (22 Nov)", () => same(texts(thaiNumbers.mergeThaiNumbers(said("ราคา", "สาม", "สิบ", "บาท"))), ["ราคา", "30", "บาท"]));
check("Thai: ร้อย ละ (percent) is left as heard (22 Nov)", () => same(texts(thaiNumbers.mergeThaiNumbers(said("คิด", "เป็น", "ร้อย", "ละ"))), ["คิด", "เป็น", "ร้อย", "ละ"]));

check("Thai: a letter on the wrong side of a long pause goes back to its word (28 Nov)", () => {
	const pieces = [w("เว", 84.94, 85.09), w("ลาด", 85.09, 85.66), w("ัง", 88.9, 89.14), w("นั้น", 89.14, 89.3)];
	const got = thaiWords.mergeThaiWords(thaiWords.mendAcrossPause(pieces)).map((x) => [x.text, x.start, x.end]);
	return same(got, [["เวลา", 84.94, 85.66], ["ดังนั้น", 88.9, 89.3]]);
});
check("Thai: a short pause before a vowel mark still joins, nothing moved (13 Nov)", () => {
	const pieces = [w("ส", 263, 263.35), w("่วน", 263.62, 263.9)];
	return same([texts(thaiWords.mendAcrossPause(pieces)), texts(thaiWords.mergeThaiWords(thaiWords.mendAcrossPause(pieces)))], [["ส", "่วน"], ["ส่วน"]]);
});

check("Cutout: a speaker off the screen is noticed, and a drag can't lose them (28 Nov)", () => {
	const { speakerOnScreen, speakerDragged, SPEAKER_LOST } = behind;
	if (speakerOnScreen({ speakerScale: 0.65, speakerX: -0.5, speakerLift: -0.164 }) >= SPEAKER_LOST) return "the coach's lost speaker counts as seen";
	if (speakerOnScreen({ speakerScale: 0.5, speakerX: 0.25, speakerLift: 0 }) < 0.99) return "a new picture's speaker counts as off the screen";
	for (const scale of [0.25, 0.5, 1, 1.5])
		for (const [x, lift] of [[-9, -9], [9, -9], [-9, 9], [9, 9]]) {
			const got = speakerDragged(x, lift, scale);
			if (speakerOnScreen({ speakerScale: scale, ...got }) < SPEAKER_LOST) return `dragged to ${x}, ${lift} at ${scale}: lost at ${JSON.stringify(got)}`;
		}
	const far = speakerDragged(-0.2, 0, 0.5, { speakerX: -0.2, speakerLift: 0 });
	return far.speakerX === -0.2 ? null : `a speaker the slider put at -0.2 jumped to ${far.speakerX} on the first drag`;
});

check("Timeline: a strip stretched into its neighbour stops at it (17 Nov)", () => {
	const memo = new Map();
	rows.packRows([{ id: "a", start: 0, end: 2 }, { id: "b", start: 3, end: 5 }], "banners", 0, memo);
	const fitted = rows.fitInRow(memo, "a", { start: 0, end: 2 }, { end: 4 }, 10);
	return fitted.end === 3 && (fitted.start ?? 0) === 0 ? null : `became ${JSON.stringify(fitted)}`; // only what changes comes back
});

// Rules that came with a fix: checked once that fix's row is in docs/bugs.md, so they hold from then on.
const bugs = readFileSync(join(repo, "docs/bugs.md"), "utf8");
if (bugs.includes("findSilences` ตัดช่วงเงียบระหว่างตัวเลข")) {
	check("Silences: nothing cut between two numbers said close together (25 Nov)", () =>
		same(silences.findSilences({ duration: 2, words: [w("59", 0, 0.3), w("0", 0.9, 1.2), w("บาท", 1.25, 2)] }), []));
}
if (bugs.includes("`uploadName`")) {
	check("Uploads: no name can land on a file Komoray writes (25 Nov)", () => {
		const { uploadName } = lib("src/lib/upload-name");
		const written = ["final.mp4", "part.mp4", "proxy.mp4", "matte.mp4", "proxy-cutout.mp4", "access.json", "edit.json", "owner.json", "removed.json", "banner-a.mp4", "media-a.mp4", "insert-a.mp4"];
		const bad = written.map((n) => [n, uploadName(n, "video/mp4")]).filter(([, stored]) => written.includes(stored) || !/^src-.*\.(mp4|mov)$/i.test(stored));
		return bad.length ? JSON.stringify(bad) : null;
	});
}

if (bugs.includes("`wordUse`, `thaiSpoken`")) {
	check("Word pairs: a heard side of one or two Thai letters is never fixed everywhere by itself (28 Nov)", () => {
		const { wordUse } = lib("src/lib/word-rules");
		const dictionary = lib("src/lib/word-check").thaiWords;
		const short = [["จ", "จา"], ["พ่", "พ่น"], ["อิ", "อิฐ"], ["โค้", "โค้ช"]].map(([h, f]) => `${h} ${wordUse(h, f, { ...dictionary, shared: true })}`);
		return same([...short, wordUse("ผูหญิง", "ผู้หญิง", { ...dictionary, shared: true })], ["จ ai", "พ่ ai", "อิ ai", "โค้ ai", "always"]);
	});
}
if (bugs.includes("`wordEdges`")) {
	check("Word pairs: never cut down to part of a word the creator typed (28 Nov)", () => {
		const { learnFromFix } = lib("src/lib/word-rules");
		const { cutThaiWords } = lib("src/lib/newmm");
		const learned = [[["คอม", "พิเตอร์"], "คอมพิวเตอร์"], [["โปร", "แกม"], "โปรแกรม"], [["ที่", "คอม", "พิเตอร์", "เลย"], "ที่คอมพิวเตอร์เลย"], [["ทีละ", "กอน"], "ทีละ ก้อน"]].map(([pieces, typed]) =>
			learnFromFix(pieces, typed, cutThaiWords).pairs.map((p) => `${p.heard}>${p.fixed}`).join());
		return same(learned, ["คอมพิเตอร์>คอมพิวเตอร์", "โปรแกม>โปรแกรม", "คอมพิเตอร์>คอมพิวเตอร์", "กอน>ก้อน"]);
	});
}

if (bugs.includes("`agrees` ใน")) {
	check("Word suggestions: a rule that would double a word or change a right one is counted as left (28 Nov)", () => {
		const { suggestWords } = lib("src/lib/word-suggestions");
		const { cutThaiWords, isThaiWord } = lib("src/lib/newmm");
		const say = (...texts) => texts.map((text) => ({ text }));
		const options = { cut: cutThaiWords, oneWord: isThaiWord, allowed: () => true, known: () => false, done: () => false, safe: () => false };
		const left = (clip, heard) => suggestWords([clip], options).flatMap((s) => s.variants).find((v) => v.heard === heard)?.left;
		const doubled = left({ words: say("เพราะ", "ฉ", "เรา", "เพราะ", "ฉ", "นั้น"), fixes: [{ from: 0, to: 1, text: "เพราะฉะนั้น" }, { from: 3, to: 5, text: "เพราะฉะนั้น" }], ai: [] }, "เพราะ ฉ");
		const right = left({ words: say("ยาย", "กิน", "ยาย", "มา"), fixes: [{ from: 0, to: 0, text: "ยา" }], ai: [] }, "ยาย");
		const added = suggestWords([{ words: say("ผม", "ไป"), fixes: [{ from: 0, to: 1, text: "ผมจะไม่ได้ไป" }], ai: [] }], options).length;
		return same([doubled, right, added], [1, 1, 0]);
	});
}

console.log(failed ? `\n${failed} rule check(s) failed.` : "\nAll rule checks pass.");
process.exit(failed ? 1 : 0);
