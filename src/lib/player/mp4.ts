// Reads the frame table of the preview copy (proxy.mp4): where each video frame sits in the file,
// when it is shown and whether it is a full picture (keyframe). Only what our own Modal proxy
// writes is needed: H.264 video, moov at the front (+faststart), no B-frames.
import type { ByteSource } from "./bytes";

export type Frame = { time: number; duration: number; offset: number; size: number; key: boolean };
export type VideoTrack = { codec: string; description: Uint8Array; width: number; height: number; frames: Frame[] };

type Box = { type: string; start: number; end: number; body: number }; // body = where the contents begin

function boxes(view: DataView, from: number, to: number): Box[] {
	const list: Box[] = [];
	let at = from;
	while (at + 8 <= to) {
		let size = view.getUint32(at);
		const type = String.fromCharCode(view.getUint8(at + 4), view.getUint8(at + 5), view.getUint8(at + 6), view.getUint8(at + 7));
		let body = at + 8;
		if (size === 1) {
			size = Number(view.getBigUint64(at + 8));
			body = at + 16;
		} else if (size === 0) size = to - at;
		if (size < 8) break;
		list.push({ type, start: at, end: Math.min(at + size, to), body });
		at += size;
	}
	return list;
}

const child = (view: DataView, box: Box, type: string, skip = 0) => boxes(view, box.body + skip, box.end).find((b) => b.type === type);

function path(view: DataView, box: Box, ...types: string[]): Box | undefined {
	let current: Box | undefined = box;
	for (const type of types) current = current && child(view, current, type);
	return current;
}

// Find moov at the top level, fetching more of the file until all of it is in hand.
async function readMoov(source: ByteSource): Promise<{ view: DataView; moov: Box }> {
	let at = 0;
	for (let guard = 0; guard < 64; guard++) {
		const raw = await source.read(at, 16);
		const head = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
		let size = head.getUint32(0);
		const type = String.fromCharCode(head.getUint8(4), head.getUint8(5), head.getUint8(6), head.getUint8(7));
		if (size === 1) size = Number(head.getBigUint64(8));
		if (size === 0) size = (await source.size()) - at;
		if (type === "moov") {
			const bytes = await source.read(at, size);
			const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
			return { view, moov: { type, start: 0, end: size, body: 8 } };
		}
		if (size < 8) break;
		at += size;
	}
	throw new Error("No moov box in the preview file");
}

function u32s(view: DataView, from: number, count: number, step = 4) {
	const out = new Array<number>(count);
	for (let i = 0; i < count; i++) out[i] = view.getUint32(from + i * step);
	return out;
}

export async function readVideoTrack(source: ByteSource): Promise<VideoTrack> {
	const { view, moov } = await readMoov(source);
	const trak = boxes(view, moov.body, moov.end)
		.filter((b) => b.type === "trak")
		.find((t) => {
			const hdlr = path(view, t, "mdia", "hdlr");
			if (!hdlr) return false;
			const at = hdlr.body + 8; // version/flags, pre_defined
			return String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3)) === "vide";
		});
	if (!trak) throw new Error("No video track in the preview file");

	const mdhd = path(view, trak, "mdia", "mdhd")!;
	const timescale = view.getUint8(mdhd.body) === 1 ? view.getUint32(mdhd.body + 20) : view.getUint32(mdhd.body + 12);
	const stbl = path(view, trak, "mdia", "minf", "stbl")!;

	// Sample description: avc1 → avcC (the decoder's setup bytes) and the picture size.
	const stsd = child(view, stbl, "stsd")!;
	const entry = boxes(view, stsd.body + 8, stsd.end)[0];
	if (!entry || entry.type !== "avc1") throw new Error(`Unsupported video format ${entry?.type}`);
	const width = view.getUint16(entry.body + 24);
	const height = view.getUint16(entry.body + 26);
	const avcC = boxes(view, entry.body + 78, entry.end).find((b) => b.type === "avcC");
	if (!avcC) throw new Error("No avcC in the preview file");
	const description = new Uint8Array(view.buffer.slice(view.byteOffset + avcC.body, view.byteOffset + avcC.end));
	const hex = (n: number) => n.toString(16).padStart(2, "0");
	const codec = `avc1.${hex(description[1])}${hex(description[2])}${hex(description[3])}`;

	// Decode times (stts), sizes (stsz), which chunk each frame is in (stsc) and where chunks are (stco/co64).
	const stts = child(view, stbl, "stts")!;
	const deltas: number[] = [];
	for (let i = 0, n = view.getUint32(stts.body + 4); i < n; i++) {
		const count = view.getUint32(stts.body + 8 + i * 8);
		const delta = view.getUint32(stts.body + 12 + i * 8);
		for (let k = 0; k < count; k++) deltas.push(delta);
	}
	const stsz = child(view, stbl, "stsz")!;
	const fixedSize = view.getUint32(stsz.body + 4);
	const count = view.getUint32(stsz.body + 8);
	const sizes = fixedSize ? new Array<number>(count).fill(fixedSize) : u32s(view, stsz.body + 12, count);
	const stsc = child(view, stbl, "stsc")!;
	const runs = Array.from({ length: view.getUint32(stsc.body + 4) }, (_, i) => ({
		firstChunk: view.getUint32(stsc.body + 8 + i * 12),
		perChunk: view.getUint32(stsc.body + 12 + i * 12),
	}));
	const stco = child(view, stbl, "stco");
	const co64 = child(view, stbl, "co64");
	const chunks = stco
		? u32s(view, stco.body + 8, view.getUint32(stco.body + 4))
		: Array.from({ length: view.getUint32(co64!.body + 4) }, (_, i) => Number(view.getBigUint64(co64!.body + 8 + i * 8)));
	const stss = child(view, stbl, "stss");
	const keys = stss ? new Set(u32s(view, stss.body + 8, view.getUint32(stss.body + 4))) : null;
	// Composition offsets (ctts) are zero without B-frames, but read them anyway to be safe.
	const ctts = child(view, stbl, "ctts");
	const offsets: number[] = [];
	if (ctts) {
		const signed = view.getUint8(ctts.body) === 1;
		for (let i = 0, n = view.getUint32(ctts.body + 4); i < n; i++) {
			const c = view.getUint32(ctts.body + 8 + i * 8);
			const o = signed ? view.getInt32(ctts.body + 12 + i * 8) : view.getUint32(ctts.body + 12 + i * 8);
			for (let k = 0; k < c; k++) offsets.push(o);
		}
	}
	// An edit list can shift the whole track (browsers apply it, so do we).
	const elst = path(view, trak, "edts", "elst");
	let shift = 0;
	if (elst) {
		const v1 = view.getUint8(elst.body) === 1;
		const n = view.getUint32(elst.body + 4);
		for (let i = 0; i < n; i++) {
			const at = elst.body + 8 + i * (v1 ? 20 : 12);
			const mediaTime = v1 ? Number(view.getBigInt64(at + 8)) : view.getInt32(at + 4);
			if (mediaTime >= 0) {
				shift = mediaTime;
				break;
			}
		}
	}

	const frames: Frame[] = [];
	let sample = 0;
	let dts = 0;
	for (let r = 0; r < runs.length; r++) {
		const lastChunk = r + 1 < runs.length ? runs[r + 1].firstChunk - 1 : chunks.length;
		for (let c = runs[r].firstChunk; c <= lastChunk; c++) {
			let offset = chunks[c - 1];
			for (let k = 0; k < runs[r].perChunk && sample < count; k++, sample++) {
				const cts = dts + (offsets[sample] ?? 0) - shift;
				frames.push({ time: cts / timescale, duration: deltas[sample] / timescale, offset, size: sizes[sample], key: keys ? keys.has(sample + 1) : true });
				offset += sizes[sample];
				dts += deltas[sample];
			}
		}
	}
	frames.sort((a, b) => a.time - b.time);
	return { codec, description, width, height, frames };
}
