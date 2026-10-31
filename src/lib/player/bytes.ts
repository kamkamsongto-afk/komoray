// Reads a file over HTTP piece by piece (Range requests), in 1 MB blocks kept in memory for a
// while, so a long video never has to be downloaded or held whole (iPhones run out of memory).

export interface ByteSource {
	size(): Promise<number>;
	read(offset: number, length: number): Promise<Uint8Array>;
	prefetch(offset: number, length: number): void;
}

const BLOCK = 1 << 20;
const KEEP_BLOCKS = 48;
const TRIES = 3;

export class RangeSource implements ByteSource {
	private blocks = new Map<number, Promise<Uint8Array>>(); // in least-recently-used order
	private total: number | null = null;
	private totalKnown: Promise<number> | null = null;

	constructor(private url: string, private onFetch?: (info: { block: number; ms: number; bytes: number }) => void) {}

	size() {
		this.totalKnown ??= this.block(0).then(() => this.total ?? 0);
		return this.totalKnown;
	}

	async read(offset: number, length: number): Promise<Uint8Array> {
		const total = await this.size();
		const end = Math.min(offset + length, total);
		if (end <= offset) return new Uint8Array(0);
		const first = Math.floor(offset / BLOCK);
		const last = Math.floor((end - 1) / BLOCK);
		const parts = await Promise.all(Array.from({ length: last - first + 1 }, (_, i) => this.block(first + i)));
		if (parts.length === 1) return parts[0].subarray(offset - first * BLOCK, end - first * BLOCK);
		const out = new Uint8Array(end - offset);
		let at = 0;
		parts.forEach((part, i) => {
			const from = i === 0 ? offset - first * BLOCK : 0;
			const to = i === parts.length - 1 ? end - (first + i) * BLOCK : part.length;
			out.set(part.subarray(from, to), at);
			at += to - from;
		});
		return out;
	}

	prefetch(offset: number, length: number) {
		if (this.total !== null && offset >= this.total) return;
		const first = Math.floor(offset / BLOCK);
		const last = Math.floor((offset + Math.max(1, length) - 1) / BLOCK);
		for (let b = first; b <= last; b++) void this.block(b).catch(() => {});
	}

	private block(index: number): Promise<Uint8Array> {
		const cached = this.blocks.get(index);
		if (cached) {
			this.blocks.delete(index);
			this.blocks.set(index, cached);
			return cached;
		}
		const loading = this.fetchBlock(index);
		this.blocks.set(index, loading);
		loading.catch(() => this.blocks.delete(index)); // try again next time
		while (this.blocks.size > KEEP_BLOCKS) this.blocks.delete(this.blocks.keys().next().value!);
		return loading;
	}

	private async fetchBlock(index: number): Promise<Uint8Array> {
		const from = index * BLOCK;
		let lastError: unknown;
		for (let attempt = 0; attempt < TRIES; attempt++) {
			const started = performance.now();
			try {
				const res = await fetch(this.url, { headers: { Range: `bytes=${from}-${from + BLOCK - 1}` } });
				if (res.status === 416) return new Uint8Array(0);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const range = res.headers.get("Content-Range"); // "bytes 0-1048575/45688867"
				const whole = range ? Number(range.split("/")[1]) : Number(res.headers.get("Content-Length"));
				if (whole) this.total = whole;
				let bytes = new Uint8Array(await res.arrayBuffer());
				if (res.status === 200 && from > 0) bytes = bytes.subarray(from, from + BLOCK); // server ignored Range
				this.onFetch?.({ block: index, ms: Math.round(performance.now() - started), bytes: bytes.length });
				return bytes;
			} catch (err) {
				lastError = err;
				await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
			}
		}
		throw lastError instanceof Error ? lastError : new Error("Could not load the preview");
	}
}
