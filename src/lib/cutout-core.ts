// What Cut me out on the customer's computer (cutout-local.ts) and its helpers in Web Workers (cutout-worker.ts) share:
// the matte's size, the matte encoder, and the loop that decodes the frames of a stretch, runs the model on each and
// encodes the matte. Nothing here touches the page (no `document`), so it runs the same in a worker.
import type { Window } from "./cutout";
import type { ByteSource } from "./player/bytes";
import type { Frame } from "./player/mp4";

export type LocalTier = "fast" | "balanced";
export const FPS = 30;
// every: the model looks at one frame in this many; the mattes between are blended from the two around them.
export const SETTINGS: Record<LocalTier, { side: number; every: number; bitrate: number }> = {
	fast: { side: 288, every: 3, bitrate: 1_500_000 }, // side: matte's short side, px. every: 3, on trial (coach 28 Nov)
	balanced: { side: 540, every: 2, bitrate: 3_000_000 },
};
export const FAST_SIDE = 256; // Fast: what Google's model is made for

export type Model = { run: (frame: VideoFrame) => Promise<Uint8Array>; close: () => void };

// Where the time goes (ms), for the flight recorder (?debug=1): coach 22 Nov asked to measure before changing how it runs.
export type Times = { read: number; decodeWait: number; model: number; encode: number; breathe: number; modelFrames: number };
export const newTimes = (): Times => ({ read: 0, decodeWait: 0, model: 0, encode: 0, breathe: 0, modelFrames: 0 });
async function timed<T>(times: Times, key: Exclude<keyof Times, "modelFrames">, work: () => Promise<T>) {
	const at = performance.now();
	try {
		return await work();
	} finally {
		times[key] += performance.now() - at;
	}
}

// A pause between frames that the browser doesn't slow down when the tab is in the background (timers it does).
export function breathe() {
	return new Promise<void>((resolve) => {
		const channel = new MessageChannel();
		channel.port1.onmessage = () => resolve();
		channel.port2.postMessage(0);
	});
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export function matteSize(width: number, height: number, side: number) {
	const k = Math.min(1, side / Math.min(width, height));
	return { w: even(width * k), h: even(height * k) };
}

// Mask bytes (the model's size) to the matte's size, as one plane. Two small canvases that are not on the page, so it also works in a worker.
export function scaler(w: number, h: number) {
	const from = new OffscreenCanvas(1, 1);
	const to = new OffscreenCanvas(w, h);
	const out = to.getContext("2d", { willReadFrequently: true });
	if (!out) throw new Error("This browser can't draw the cutout.");
	out.imageSmoothingQuality = "high";
	return (mask: Uint8ClampedArray, mw: number, mh: number) => {
		from.width = mw;
		from.height = mh;
		const ctx = from.getContext("2d", { willReadFrequently: true });
		if (!ctx) throw new Error("This browser can't draw the cutout.");
		const image = ctx.createImageData(mw, mh);
		for (let i = 0; i < mw * mh; i++) {
			image.data[i * 4] = mask[i];
			image.data[i * 4 + 3] = 255;
		}
		ctx.putImageData(image, 0, 0);
		out.drawImage(from, 0, 0, w, h);
		const data = out.getImageData(0, 0, w, h).data;
		const y = new Uint8Array(w * h);
		for (let i = 0; i < y.length; i++) y[i] = data[i * 4];
		return y;
	};
}

const CODECS = ["avc1.42E01F", "avc1.4D401F", "avc1.640028"];

// Waits for the next 'dequeue' of a codec, but looks up every quarter second: a codec that failed never sends one, and a wait
// without this would hang for good (found in review 23 Nov, before workers made it a silent hang).
export const nextDequeue = (codec: { addEventListener: (type: "dequeue", listener: () => void, options: { once: boolean }) => void }) =>
	new Promise<void>((resolve) => {
		codec.addEventListener("dequeue", () => resolve(), { once: true });
		setTimeout(resolve, 250);
	});

export async function matteEncoder(w: number, h: number, bitrate: number, failOut: (error: Error) => void) {
	let broken: Error | null = null;
	const fail = (error: Error) => {
		broken = error;
		failOut(error);
	};
	const pieces: Uint8Array<ArrayBuffer>[] = [];
	const encoder = new VideoEncoder({
		output: (chunk) => {
			const bytes = new Uint8Array(chunk.byteLength);
			chunk.copyTo(bytes);
			pieces.push(bytes);
		},
		error: fail,
	});
	for (const codec of CODECS) {
		const config = { codec, width: w, height: h, bitrate, framerate: FPS, latencyMode: "quality", avc: { format: "annexb" } } as VideoEncoderConfig;
		if ((await VideoEncoder.isConfigSupported(config).catch(() => null))?.supported) {
			encoder.configure(config);
			const buffer = new Uint8Array((w * h * 3) / 2);
			buffer.fill(128, w * h); // no colour
			let index = 0;
			return {
				async add(y: Uint8Array | null) {
					if (y) buffer.set(y);
					else buffer.fill(0, 0, w * h);
					const frame = new VideoFrame(buffer, { format: "I420", codedWidth: w, codedHeight: h, timestamp: Math.round((index * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
					// A key frame every second, and the first of a stretch always: stretches made apart (in workers) are joined end to end.
					encoder.encode(frame, { keyFrame: index % FPS === 0 });
					frame.close();
					index++;
					while (encoder.encodeQueueSize > 8) {
						if (broken) throw broken;
						await nextDequeue(encoder);
					}
				},
				async finish() {
					await encoder.flush();
					encoder.close();
					return new Blob(pieces, { type: "video/h264" });
				},
				close() {
					if (encoder.state !== "closed") encoder.close();
				},
			};
		}
	}
	throw new Error("This browser can't save the cutout. Please choose Slow.");
}
export type MatteEncoder = Awaited<ReturnType<typeof matteEncoder>>;

// The runs of frames inside the windows: [first, past the last).
export function runsOf(frames: Frame[], windows: Window[]) {
	const inside = (t: number) => windows.some(([a, b]) => a <= t && t < b);
	const runs: [number, number][] = [];
	frames.forEach((frame, i) => {
		if (!inside(frame.time)) return;
		const last = runs.at(-1);
		if (last && last[1] === i) last[1] = i + 1;
		else runs.push([i, i + 1]);
	});
	return runs;
}

// Frames from..to (past the last) of the matte: the model on every frame inside the runs, black for the rest. Decoding starts
// at the key frame before each run. `check` throws when stopped or failed; `onFrame` is told after each frame inside a run.
export async function matteStretch(o: {
	source: ByteSource;
	codec: string;
	description: Uint8Array;
	frames: Frame[];
	runs: [number, number][]; // inside from..to
	from: number;
	to: number;
	model: Model;
	encoder: MatteEncoder;
	every: number;
	check: () => void;
	onFrame: () => void;
	hold?: () => Promise<void> | undefined; // asked after every frame: a promise = wait for it (the preview is playing)
	times: Times;
	fail: (error: Error) => void;
}) {
	const { source, frames, model, encoder, times, check, onFrame } = o;
	const decoded: VideoFrame[] = [];
	const decoder = new VideoDecoder({ output: (frame) => decoded.push(frame), error: o.fail });
	decoder.configure({ codec: o.codec, description: o.description, hardwareAcceleration: "prefer-hardware" });
	try {
		let written = o.from;
		for (const [first, past] of o.runs) {
			for (; written < first; written++) await timed(times, "encode", () => encoder.add(null)); // black outside the windows
			check();
			let start = first;
			while (start > 0 && !frames[start].key) start--;
			let next = start; // which frame the decoder gives next (no B-frames: in order)
			let previous: Uint8Array | null = null;
			let skipped = 0; // frames waiting for the next model result, to be blended

			const take = async () => {
				while (decoded.length) {
					const frame = decoded.shift() as VideoFrame;
					const at = next++;
					if (at < first || at >= past) {
						frame.close();
						continue;
					}
					check();
					if ((at - first) % o.every !== 0) {
						frame.close();
						skipped++;
					} else {
						const matte: Uint8Array = await timed(times, "model", () => model.run(frame));
						times.modelFrames++;
						frame.close();
						// Each skipped frame a step of the way from the matte before to this one.
						for (let k = 1; previous && k <= skipped; k++) {
							const share = k / (skipped + 1);
							const middle = new Uint8Array(matte.length);
							for (let i = 0; i < matte.length; i++) middle[i] = previous[i] + (matte[i] - previous[i]) * share + 0.5;
							await timed(times, "encode", () => encoder.add(middle));
						}
						skipped = 0;
						await timed(times, "encode", () => encoder.add(matte));
						previous = matte;
					}
					onFrame();
					await timed(times, "breathe", breathe);
					await o.hold?.();
				}
			};

			for (let i = start; i < past; i++) {
				const frame = frames[i];
				const data = await timed(times, "read", () => source.read(frame.offset, frame.size));
				check();
				decoder.decode(new EncodedVideoChunk({ type: frame.key ? "key" : "delta", timestamp: Math.round(frame.time * 1e6), data }));
				await timed(times, "decodeWait", async () => {
					while (decoder.decodeQueueSize > 4) {
						check(); // a decoder that failed never sends 'dequeue'
						await nextDequeue(decoder);
					}
				});
				await take();
			}
			await timed(times, "decodeWait", () => decoder.flush());
			await take();
			for (; skipped > 0; skipped--) await timed(times, "encode", () => encoder.add(previous)); // the run ended on frames with nothing after them
			written = past;
		}
		for (; written < o.to; written++) await timed(times, "encode", () => encoder.add(null));
		check();
	} finally {
		decoded.forEach((frame) => frame.close());
		if (decoder.state !== "closed") decoder.close();
	}
}

// ---- Fast: Google's selfie model, on the processor, every frame (40 fps on a plain Intel laptop) ----

// Pinned, and only the program and the model come from these: the customer's video never leaves their computer here.
export const VISION_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2";
const SELFIE_MODEL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite";

type MaskResult = { confidenceMasks: { width: number; height: number; getAsFloat32Array: () => Float32Array; close: () => void }[] };
type Segmenter = { segmentForVideo: (image: OffscreenCanvas, at: number, done: (result: MaskResult) => void) => void; close: () => void };
export type Vision = {
	FilesetResolver: { forVisionTasks: (root: string) => Promise<unknown> };
	ImageSegmenter: { createFromOptions: (files: unknown, options: unknown) => Promise<Segmenter> };
};

// `vision` comes from the page (an import of vision_bundle.mjs) or from a worker (importScripts of vision_bundle.cjs).
export async function fastModelFrom(vision: Vision, width: number, height: number, w: number, h: number): Promise<Model> {
	const files = await vision.FilesetResolver.forVisionTasks(`${VISION_ROOT}/wasm`);
	// The processor: on the plain Intel laptop it tested faster than the graphics card, and it works everywhere.
	const model = await vision.ImageSegmenter.createFromOptions(files, {
		baseOptions: { modelAssetPath: SELFIE_MODEL, delegate: "CPU" },
		runningMode: "VIDEO",
		outputCategoryMask: false,
		outputConfidenceMasks: true,
	});
	const k = FAST_SIDE / Math.min(width, height);
	const input = new OffscreenCanvas(Math.round(width * k), Math.round(height * k));
	const ctx = input.getContext("2d", { willReadFrequently: true });
	if (!ctx) throw new Error("This browser can't draw the cutout.");
	const scale = scaler(w, h);
	let at = 1;
	return {
		async run(frame) {
			ctx.drawImage(frame, 0, 0, input.width, input.height);
			let out: Uint8Array | null = null;
			model.segmentForVideo(input, (at += 33), (result) => {
				const masks = result.confidenceMasks;
				const mask = masks[masks.length - 1];
				const values = mask.getAsFloat32Array();
				const bytes = new Uint8ClampedArray(values.length);
				for (let i = 0; i < values.length; i++) bytes[i] = values[i] * 255;
				out = scale(bytes, mask.width, mask.height);
				masks.forEach((m) => m.close());
			});
			if (!out) throw new Error("The cutout model gave no result.");
			return out;
		},
		close: () => model.close(),
	};
}
