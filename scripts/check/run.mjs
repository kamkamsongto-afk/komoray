// npm run check: does the preview (src/lib) still work things out the same way as the final video (modal_app/render.py)?
// Both sides' real functions get the same made-up cases, and their answers are compared. No video is made, nothing is
// sent anywhere, nothing costs money. Needs Python (render_side.py). Exit code 1 when anything differs.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { lib, repo } from "./lib.mjs";

const timeline = lib("src/lib/timeline");
const zoom = lib("src/lib/zoom");
const bg = lib("src/lib/bg-motion");
const layout = lib("src/lib/layout");
const frame = lib("src/lib/frame-me");
const banners = lib("src/lib/banners");
const behind = lib("src/lib/behind");
const style = lib("src/lib/subtitle-style");
const framing = lib("src/lib/framing");
const logo = lib("src/lib/logo-motion");
const motion = lib("src/lib/motion");
const { FPS } = timeline;

// The same made-up cases every run.
let seed = Number(process.env.SEED) || 20261125; // SEED=7 npm run check: other cases
const random = () => ((seed = (seed * 48271) % 2147483647) - 1) / 2147483646;
const between = (a, b) => a + random() * (b - a);
const pick = (list) => list[Math.floor(random() * list.length)];
const many = (n, make) => Array.from({ length: n }, (_, k) => make(k));
const ms = (n) => Math.round(n * 1000) / 1000;
const SIZES = [[1080, 1920], [1080, 1080], [1920, 1080]];

function cutsFor(duration) {
	const cuts = [];
	for (let at = between(0, 2); at < duration - 0.5; at += between(0.5, 6)) {
		const length = between(0.05, 1.5);
		cuts.push({ start: ms(at), end: ms(Math.min(duration, at + length)), reason: "silence" });
		at += length;
	}
	return cuts;
}

const THAI = ["วันนี้", "เรา", "จะ", "มา", "คุย", "เรื่อง", "ราคา", "990", "บาท", "สาม", "สี่", "ชั่วโมง", "ที่", "ของ", "การ", "ไม่", "กับ", "ครับ", "ค่ะ", "นะ", "มากๆ", "เพื่อน", "ประหยัด", "เวลา", "2,990", "9", "0", "AI", "studio", "Komoray"];
const ENGLISH = ["With", "Komoray,", "I", "can", "edit", "my", "videos.", "And", "the", "a", "to", "of", "10", "hours", "is", "it", "so", "very", "incredibly", "now.", "you", "make", "faster,"];
function wordsFor(thai) {
	const words = [];
	let at = between(0, 1);
	for (let k = 0; k < Math.floor(between(8, 60)); k++) {
		const length = between(0.08, 0.7);
		const word = { text: pick(thai ? THAI : ENGLISH), start: ms(at), end: ms(at + length) };
		if (k && random() < 0.04) word.br = true;
		if (k && random() < 0.04) word.glue = true;
		words.push(word);
		at += length + (random() < 0.75 ? between(0, 0.05) : between(0.2, 1.4));
	}
	return { words, duration: ms(at + 1) };
}

const cases = {
	constants: null,
	segments: many(200, () => {
		const duration = ms(between(2, 90));
		return { duration, cuts: cutsFor(duration) };
	}),
	subtitles: many(240, (k) => {
		const { words, duration } = wordsFor(k % 2 === 0);
		const look = ["clean", "highlight", "big", "two"][Math.floor(k / 2) % 4];
		return { words, duration, cuts: random() < 0.5 ? cutsFor(duration) : [], look, size: pick([70, 100, 100, 130]), spacing: pick([0, 0, 4]), splits: random() < 0.2 ? [ms(between(1, duration - 1))] : [] };
	}),
	zoom: many(80, () => {
		const segments = [];
		let from = 0;
		let trim = 0;
		for (let k = 0; k < Math.floor(between(1, 8)); k++) {
			trim += Math.floor(between(0, 40));
			const frames = Math.floor(between(5, 200));
			segments.push([from, trim, frames]);
			from += frames;
			trim += frames;
		}
		const end = trim / FPS;
		const span = () => {
			const start = ms(between(0, end * 0.9));
			return { start, end: ms(start + between(0.2, end / 2)) };
		};
		const parts = zoom.readZoomParts(many(Math.floor(between(0, 4)), () => ({ ...span(), zoom: pick(zoom.PART_ZOOMS), ...(random() < 0.4 && { amount: ms(between(1.04, 1.3)) }), ...(random() < 0.4 && { whole: true }) })), end + 10) ?? [];
		return { segments, noZoom: random() < 0.4 ? [span()] : [], parts, style: { zoom: pick(["off", "in", "out", "smooth", "cuts"]), zoomAmount: pick([1.04, 1.12, 1.3]), zoomPeriod: pick([6, 12, 24]) } };
	}),
	background: many(160, () => {
		const start = ms(between(0, 20));
		const end = ms(start + between(0.5, 12));
		const frames = [0, 1, Math.floor(((end - start) * FPS) / 3), Math.floor(((end - start) * FPS) / 2), Math.floor((end - start) * FPS) - 1];
		return { motion: pick(["in", "out", "panLeft", "panRight", "tiltUp", "tiltDown"]), amount: pick([-0.6, -0.2, 0.05, 0.2, 0.8, 1.2]), speed: pick([0.5, 1, 2, 7]), start, end, frames };
	}),
	layouts: many(80, () => {
		const list = [];
		let at = ms(between(0, 3));
		for (let k = 0; k < Math.floor(between(1, 4)); k++) {
			const end = ms(at + between(0.4, 4));
			list.push({ id: `l${k}`, start: at, end, kind: pick(["stack", "side"]), meFirst: random() < 0.5, split: ms(between(0.3, 0.7)), meX: ms(between(0, 1)), meY: ms(between(0, 1)), ...(random() < 0.6 && { meZoom: ms(between(0.4, 2.5)) }), color: "#000000", enter: pick(["slide", "slide", "flash", "cut"]) });
			at = random() < 0.5 ? end : ms(end + between(0.01, 1));
		}
		return { layouts: list, size: pick(SIZES), times: many(24, () => ms(between(0, at + 1))) };
	}),
	frames: many(80, () => ({ size: pick(SIZES), frame: { shape: pick(frame.FRAME_SHAPES).id, x: ms(between(-0.2, 1.2)), y: ms(between(-0.2, 1.2)), size: ms(between(0.15, 1.2)) } })),
	banners: many(120, () => {
		const lines = Math.floor(between(1, 21));
		const start = ms(between(0, 5));
		const end = ms(start + between(0.2, 5));
		const banner = { text: many(lines, (n) => `Line ${n}`).join("\n"), sub: random() < 0.3 ? "small" : "", start, end, anim: pick(["fade", "pop", "bounce", "slideUp", "slideSide", "pulse"]), ...(random() < 0.3 && { lineGap: Math.round(between(-60, 80)) }), ...(random() < 0.3 && { padding: Math.round(between(0, 60)) }), ...(random() < 0.2 && { fadeIn: false }), ...(random() < 0.2 && { fadeOut: false }) };
		return { banner, height: pick([1920, 1080]), times: [start, start + 0.05, start + 0.2, start + 0.4, (start + end) / 2, end - 0.1, end - 0.001, end + 0.1].map(ms) };
	}),
	behind: many(80, () => {
		const start = ms(between(0, 5));
		const end = ms(start + between(0.5, 6));
		const text = { id: "t", text: pick(["WOW", "NEW DROP", "สวัสดี", "One\nTwo"]), start, end, fx: pick(Object.keys(behind.BEHIND_FX)), speed: pick(["slow", "normal", "fast"]), size: Math.round(between(100, 300)), y: ms(between(0.1, 0.9)), color: "#FFFFFF", stroke: 0, strokeColor: "#000000", font: "kanit", ...(random() < 0.2 && { fadeIn: false }) };
		const [width, height] = pick(SIZES);
		return { text, width, height, times: many(10, (k) => ms(start + ((end - start) * k) / 10)) };
	}),
	framing: many(150, () => {
		const faces = random() < 0.15 ? null : { width: 960, height: 540, faces: many(Math.floor(between(1, 12)), (n) => [n * 0.5, ms(between(0, 1)), ms(between(0, 1)), ms(between(0.05, 0.4))]) };
		const start = ms(between(0, 5));
		return { faces, start, end: ms(start + between(0.1, 3)), aspect: pick([16 / 9, 9 / 16, 4 / 3, 1, 2.35]), zoom: ms(between(1, 1.3)), size: pick(SIZES) };
	}),
	logo: many(80, () => ({
		style: { logoEffect: pick(["still", "fade", "flash", "zoom"]), logoSpeed: pick([0.2, 0.5, 1, 2]), logoEvery: pick([0, 0, 3, 10, 60]) },
		start: ms(between(0, 40)),
		times: many(30, () => ms(between(0, 80))),
	})),
	words: many(300, () => ms(between(-20, 600))),
	layout_file: many(150, (k) => ({
		size: pick(SIZES),
		picture: [Math.round(between(300, 4000)), Math.round(between(300, 4000))],
		layout: { id: "l", start: 0, end: 2, kind: pick(["stack", "side"]), meFirst: random() < 0.5, split: ms(between(0.3, 0.7)), meX: 0.5, meY: 0.4, color: "#000000", enter: "cut", file: "p.png", media: "image", ...(k % 4 && { fileZoom: ms(between(1, 3)), fileX: ms(between(0, 1)), fileY: ms(between(0, 1)) }) },
	})),
	frame_back: many(80, (k) => ({
		size: pick(SIZES),
		frame: { id: "f", start: 0, end: 2, shape: "circle", x: 0.5, y: 0.5, size: 0.5, zoom: 0.7, meX: 0.5, meY: 0.4, border: 0, back: "file", backColor: "#000000", file: "p.png", media: "image", ...(k % 5 && { backSize: ms(between(0.1, 3)), backX: ms(between(-1, 1)), backY: ms(between(-1, 1)) }) },
	})),
	// A line's words as a cut can leave them: now and then out of order, before the line or after its end. Looked at half
	// way between frames' edges, never within a frame of one.
	bounce: many(200, () => {
		const start = Math.round(between(0, 90));
		const end = start + Math.round(between(12, 90));
		let at = start;
		const starts = many(Math.floor(between(1, 6)), (k) => {
			const from = k === 0 ? start : (at += Math.round(between(3, 22)));
			return random() < 0.15 && k ? Math.round(between(start - 8, end + 12)) : from;
		});
		const edges = [start, end, ...starts];
		return { start, end, starts, frames: many(end - start + 24, (k) => start - 8 + k + 0.5).filter((f) => edges.every((e) => Math.abs(f - e) >= 0.5)) };
	}),
};

// ---- the final video's side ----
let python = null;
for (const command of ["python", "python3", "py"]) {
	const run = spawnSync(command, [join(repo, "scripts/check/render_side.py")], { input: JSON.stringify(cases), encoding: "utf8", maxBuffer: 512 * 1024 * 1024, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
	if (run.error?.code === "ENOENT") continue;
	if (run.status !== 0) {
		console.error(`Python stopped:\n${run.stderr}`);
		process.exit(1);
	}
	python = JSON.parse(run.stdout);
	break;
}
if (!python) {
	console.error("Python was not found.");
	process.exit(1);
}

// ---- comparing ----
// Where two answers differ (the first place), else null. tolerance: how far numbers may be apart.
function differ(web, video, tolerance, at = "") {
	if (typeof web === "number" && typeof video === "number") return Math.abs(web - video) <= tolerance ? null : `${at || "value"}: web ${web} / video ${video}`;
	if (Array.isArray(web) && Array.isArray(video)) {
		if (web.length !== video.length) return `${at || "list"}: web has ${web.length} / video ${video.length}`;
		for (let i = 0; i < web.length; i++) {
			const found = differ(web[i], video[i], tolerance, `${at}[${i}]`);
			if (found) return found;
		}
		return null;
	}
	if (web && video && typeof web === "object" && typeof video === "object") {
		for (const key of Object.keys(web)) {
			const found = differ(web[key], video[key], tolerance, at ? `${at}.${key}` : key);
			if (found) return found;
		}
		return null;
	}
	return web === video ? null : `${at || "value"}: web ${JSON.stringify(web)} / video ${JSON.stringify(video)}`;
}
const box = (b) => [b.x, b.y, b.w, b.h];
const sorted = (o) => Object.fromEntries(Object.entries(o).sort());

const web = {
	constants: () => ({
		FPS,
		formats: Object.fromEntries(Object.entries(style.FORMATS).map(([k, f]) => [k, [f.width, f.height]])),
		fonts: Object.keys(style.FONTS).sort(),
		bannerTop: banners.BANNER_TOP,
		bannerAnims: Object.keys(banners.BANNER_ANIMS).sort(),
		bannerFit: banners.BANNER_FIT,
		frameFade: frame.FRAME.fade,
		frameRatio: sorted(Object.fromEntries(frame.FRAME_SHAPES.map((s) => [s.id, s.ratio]))),
		layoutSlide: layout.LAYOUT.slide,
		layoutFlash: layout.LAYOUT.flash,
		layoutJoin: layout.LAYOUT.join,
		layoutFill: layout.LAYOUT.fill,
		partHold: zoom.PART_HOLD,
		partGlide: zoom.PART_GLIDE,
		pop: motion.POP,
		bounce: motion.BOUNCE,
		bounceGap: motion.BOUNCE_WORD_GAP,
		logo: [logo.LOGO_MOTION.show, logo.LOGO_MOTION.zoomFrom, logo.LOGO_MOTION.flash, logo.LOGO_MOTION.glow],
	}),
	segments: (c) => timeline.keepSegments(c.duration, c.cuts).map((s) => [s.from, s.trim, s.frames]),
	subtitles: (c) =>
		timeline.subtitleLines(c.words, timeline.keepSegments(c.duration, c.cuts), c.look, c.size, c.spacing, c.splits).map((l) => ({ from: l.from / FPS, to: l.to / FPS, text: l.parts.map((p) => p.text).join("") })),
	zoom: (c) => {
		const segments = c.segments.map(([from, trim, frames]) => ({ from, trim, frames }));
		const at = zoom.zoomTrack(segments, c.noZoom, c.style, c.parts);
		return Array.from({ length: segments.reduce((n, s) => n + s.frames, 0) }, (_, f) => at(f));
	},
	background: (c) => c.frames.map((f) => bg.bgWindow(c.motion, c.amount, c.speed, c.start + f / FPS, c.start, c.end)),
	layouts: (c) => {
		const [W, H] = c.size;
		return c.layouts.map((l) => {
			const b = layout.layoutBoxes(l, W, H);
			return { other: box(b.other), me: box(b.me), picture: [b.picture.x, b.picture.y], zoom: b.zoom, progress: c.times.map((t) => layout.layoutProgress(l, t, c.layouts)) };
		});
	},
	frames: (c) => ({ rect: box(frame.frameRect(c.frame, ...c.size)), points: frame.framePoints(c.frame.shape) }),
	banners: (c) => ({
		fit: banners.bannerFit(c.banner, c.height),
		poses: c.times.map((t) => {
			const m = banners.bannerMotion(c.banner, t);
			return [m.opacity, m.scale, m.x, m.y];
		}),
	}),
	behind: (c) => c.times.map((t) => behind.behindMotion(c.text, t, c.width, c.height)),
	framing: (c) => {
		const focus = framing.focusFor(c.faces, c.start, c.end);
		const rect = framing.framePiece(c.aspect, focus, c.zoom, { width: c.size[0], height: c.size[1] });
		return { focus: focus ? [focus.x, focus.y] : null, rect: box(rect) };
	},
	logo: (c) => {
		const seen = c.times.map((t) => logo.logoIn(c.start + t, c.style.logoEffect, c.style.logoSpeed, c.style.logoEvery));
		return { sum: seen, ffmpeg: seen };
	},
	words: (t) => [motion.scaleAt(motion.POP, t), motion.scaleAt(motion.BOUNCE, t)],
	// As PlayerFrame shows a line: only inside its time, every word once, the last one that has started coloured.
	bounce: (c) =>
		c.frames.map((frame) => {
			const on = frame >= c.start && frame < c.end;
			const now = c.starts.findLastIndex((from) => from <= frame);
			return { drawn: c.starts.map(() => (on ? 1 : 0)), lit: on && now >= 0 ? [now] : [] };
		}),
	// The preview places the picture from its width / height; the final video scales it to even px, so up to 2 px apart.
	layout_file: (c) => {
		const [, , w, h] = box(layout.layoutBoxes(c.layout, ...c.size).other);
		const p = layout.layoutFilePlace(c.layout, w, h, c.picture[0] / c.picture[1]);
		return [p.x, p.y, p.w, p.h];
	},
	frame_back: (c) => {
		if (!frame.frameBackMoved(c.frame)) return { moved: false };
		const p = frame.frameBackPlace(c.frame, 1, c.size[0] / c.size[1]);
		return { moved: true, grow: c.frame.backSize ?? 1, dx: ((parseFloat(p.left) - 50) / 100) * c.size[0], dy: ((parseFloat(p.top) - 50) / 100) * c.size[1] };
	},
};

// Both sides' text without what only changes how it is drawn: letter case (the Big look) and where Two lines breaks.
// Times as the final video writes them (hundredths of a second), then lines too short to exist are left out of both.
const cs = (t) => Math.round(t * 100) / 100;
const plain = (lines, look) => lines.map((l) => ({ from: cs(l.from), to: cs(l.to), text: (look === "two" ? l.text.replace(/\s+/g, "") : l.text.replace(/\s+/g, " ").trim()).toLowerCase() })).filter((l) => l.to - l.from > 0.005);

const TOLERANCE = { constants: 1e-9, segments: 0, subtitles: 0.0101, zoom: 4e-4, background: 2e-3, layouts: 2e-3, frames: 1e-6, banners: 1e-6, behind: 1e-3, framing: 1e-6, logo: 2e-3, words: 1e-9, layout_file: 4.5, frame_back: 0.06, bounce: 0 };
let failed = 0;
for (const name of Object.keys(cases)) {
	const answer = python[name];
	if (!answer || answer.error) {
		console.log(`FAIL  ${name.padEnd(11)} the video side stopped: ${answer?.error ?? "no answer"}`);
		failed++;
		continue;
	}
	const list = name === "constants" ? [null] : cases[name];
	const problems = [];
	for (let k = 0; k < list.length; k++) {
		try {
			let ours = web[name](list[k]);
			let theirs = name === "constants" ? answer.ok : answer.ok[k];
			if (name === "constants") theirs = { ...theirs, frameRatio: sorted(theirs.frameRatio) };
			if (name === "subtitles") [ours, theirs] = [plain(ours, list[k].look), plain(theirs, list[k].look)];
			const found = differ(ours, theirs, TOLERANCE[name]);
			if (found) problems.push(`case ${k}: ${found}`);
			if (found && process.env.SHOW) console.log(JSON.stringify({ k, in: list[k], web: ours, video: theirs }));
		} catch (err) {
			problems.push(`case ${k}: the web side stopped: ${err.message}`);
		}
	}
	console.log(`${problems.length ? "FAIL" : "ok  "}  ${name.padEnd(11)} ${problems.length ? `${problems.length} of ${list.length} cases differ` : `${list.length} cases the same`}`);
	for (const p of problems.slice(0, 3)) console.log(`        ${p.slice(0, 300)}`);
	if (problems.length) failed++;
}
console.log(failed ? `\n${failed} section(s) differ between the preview and the final video.` : "\nThe preview and the final video agree.");
process.exit(failed ? 1 : 0);
