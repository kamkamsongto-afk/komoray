import { fetchObject } from "@/lib/r2";

// How long a video is, in seconds, read from its MP4/MOV header (the mvhd box) without downloading it.
// The minutes quota needs this before paying for speech-to-text. null = could not tell.
type ReadBytes = (start: number, length: number) => Promise<Uint8Array>;

const HEADER = 16; // enough for a box's size, its name and a 64-bit size
const MAX_BOXES = 64;

const name = (b: Uint8Array) => String.fromCharCode(b[4], b[5], b[6], b[7]);
const u32 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(at);
const u64 = (b: Uint8Array, at: number) => u32(b, at) * 2 ** 32 + u32(b, at + 4);

// Walks the boxes from start up to end. Calls found(box start, box size) for the box with this name.
async function findBox(read: ReadBytes, wanted: string, start: number, end: number) {
	let at = start;
	for (let i = 0; i < MAX_BOXES && at + 8 <= end; i++) {
		const head = await read(at, HEADER);
		if (head.length < 8) return null;
		let size = u32(head, 0);
		if (size === 1) {
			if (head.length < 16) return null;
			size = u64(head, 8);
		} else if (size === 0) {
			size = end - at; // runs to the end of the file
		}
		if (size < 8) return null;
		if (name(head) === wanted) return { at, size };
		at += size;
	}
	return null;
}

export async function readDuration(read: ReadBytes) {
	const moov = await findBox(read, "moov", 0, Number.MAX_SAFE_INTEGER);
	if (!moov) return null;
	const mvhd = await findBox(read, "mvhd", moov.at + 8, moov.at + moov.size);
	if (!mvhd) return null;
	const b = await read(mvhd.at, 40);
	if (b.length < 32) return null;
	const v1 = b[8] === 1; // version 1 uses 64-bit times
	if (v1 && b.length < 40) return null;
	const timescale = u32(b, v1 ? 28 : 20);
	const duration = v1 ? u64(b, 32) : u32(b, 24);
	if (!timescale || !duration) return null;
	return duration / timescale;
}

export async function videoDuration(key: string) {
	return readDuration(async (start, length) => {
		const res = await fetchObject(key, `bytes=${start}-${start + length - 1}`);
		if (res.status === 416) return new Uint8Array();
		if (!res.ok) throw new Error(`R2 read failed (${res.status})`);
		return new Uint8Array(await res.arrayBuffer()).slice(0, length);
	}).catch(() => null);
}
