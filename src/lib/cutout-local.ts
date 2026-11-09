// Cutout Fast and Balanced: the speaker is cut out on the customer's own computer, so it costs us no GPU.
// Reads the preview copy frame by frame, runs a small model on each frame and writes the matte
// (white = person) as a plain H.264 stream, one frame for every frame of the video, black outside the
// windows. /api/cutout/finish then turns that stream into the same files Best makes (modal_app/cutout.py),
// so the player and Make video don't know the difference.
//   Fast      Google's selfie model, on the processor, every frame (40 fps on a plain Intel laptop)
//   Balanced  MODNet (Apache 2.0, code and weights) on the graphics card, every second frame, the ones
//             between blended (2.8 fps on the same laptop: every frame would take twice as long)
// Tested 9 Nov on a real clip against BiRefNet: both agree with it on 98% of the person, Balanced has the cleaner edge.
import type { Window } from "./cutout";
import { RangeSource } from "./player/bytes";
import { type Frame, readVideoTrack } from "./player/mp4";

export type LocalTier = "fast" | "balanced";

// Pinned, and only the program and the model come from these: the customer's video never leaves their computer here.
const VISION_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2";
const SELFIE_MODEL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite";
// ort.all, not the smaller ort.webgpu: with that one MODNet gave a ragged matte (agreement with BiRefNet 79% instead of 97%).
const ORT_ROOT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/";
const MODNET_MODEL = "https://huggingface.co/Xenova/modnet/resolve/fa2fa546052fba4c08921230a26cc69a333fca12/onnx/model_fp16.onnx";

const FPS = 30;
const SETTINGS: Record<LocalTier, { side: number; every: number; bitrate: number }> = {
	fast: { side: 288, every: 1, bitrate: 1_500_000 }, // matte's short side, px
	balanced: { side: 540, every: 2, bitrate: 3_000_000 },
};
const MODEL_SIDE = 512; // Balanced: the picture MODNet sees, short side (a multiple of 32)
const FAST_SIDE = 256; // Fast: what Google's model is made for

// What this browser can do, to grey out the rest.
export async function localSupport(): Promise<Record<LocalTier, boolean>> {
	if (typeof VideoDecoder === "undefined" || typeof VideoEncoder === "undefined" || typeof OffscreenCanvas === "undefined") return { fast: false, balanced: false };
	const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
	const adapter = await gpu?.requestAdapter().catch(() => null);
	return { fast: true, balanced: Boolean(adapter) };
}

// A pause between frames that the browser doesn't slow down when the tab is in the background (timers it does).
function breathe() {
	return new Promise<void>((resolve) => {
		const channel = new MessageChannel();
		channel.port1.onmessage = () => resolve();
		channel.port2.postMessage(0);
	});
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

function matteSize(width: number, height: number, side: number) {
	const k = Math.min(1, side / Math.min(width, height));
	return { w: even(width * k), h: even(height * k) };
}

function scaler(w: number, h: number) {
	const from = document.createElement("canvas");
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

type Model = { run: (frame: VideoFrame) => Promise<Uint8Array>; close: () => void };

type MaskResult = { confidenceMasks: { width: number; height: number; getAsFloat32Array: () => Float32Array; close: () => void }[] };
type Segmenter = { segmentForVideo: (image: OffscreenCanvas, at: number, done: (result: MaskResult) => void) => void; close: () => void };
type Vision = {
	FilesetResolver: { forVisionTasks: (root: string) => Promise<unknown> };
	ImageSegmenter: { createFromOptions: (files: unknown, options: unknown) => Promise<Segmenter> };
};

async function fastModel(width: number, height: number, w: number, h: number): Promise<Model> {
	const vision = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ `${VISION_ROOT}/vision_bundle.mjs`)) as Vision;
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

type Tensor = { data: Float32Array; dispose?: () => void };
type Session = { inputNames: string[]; outputNames: string[]; run: (feeds: Record<string, unknown>) => Promise<Record<string, Tensor>>; release: () => Promise<void> };
type Ort = {
	env: { wasm: { wasmPaths: string; numThreads: number } };
	InferenceSession: { create: (model: Uint8Array, options: unknown) => Promise<Session> };
	Tensor: new (kind: string, data: Float32Array, dims: number[]) => unknown;
};

const to32 = (n: number) => Math.max(32, Math.round(n / 32) * 32);

async function balancedModel(width: number, height: number, w: number, h: number): Promise<Model> {
	const ort = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ `${ORT_ROOT}ort.all.min.mjs`)) as Ort;
	ort.env.wasm.wasmPaths = ORT_ROOT;
	ort.env.wasm.numThreads = 1;
	const file = await fetch(MODNET_MODEL);
	if (!file.ok) throw new Error("Could not download the cutout model. Please try again.");
	const session = await ort.InferenceSession.create(new Uint8Array(await file.arrayBuffer()), { executionProviders: ["webgpu"] });
	const k = MODEL_SIDE / Math.min(width, height);
	const iw = to32(width * k);
	const ih = to32(height * k);
	const input = new OffscreenCanvas(iw, ih);
	const ctx = input.getContext("2d", { willReadFrequently: true });
	if (!ctx) throw new Error("This browser can't draw the cutout.");
	const scale = scaler(w, h);
	const pixels = new Float32Array(3 * iw * ih);
	const n = iw * ih;
	return {
		async run(frame) {
			ctx.drawImage(frame, 0, 0, iw, ih);
			const data = ctx.getImageData(0, 0, iw, ih).data;
			for (let i = 0; i < n; i++) {
				pixels[i] = data[i * 4] / 127.5 - 1;
				pixels[i + n] = data[i * 4 + 1] / 127.5 - 1;
				pixels[i + 2 * n] = data[i * 4 + 2] / 127.5 - 1;
			}
			const result = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", pixels, [1, 3, ih, iw]) });
			const output = result[session.outputNames[0]];
			const bytes = new Uint8ClampedArray(n);
			for (let i = 0; i < n; i++) bytes[i] = output.data[i] * 255;
			output.dispose?.();
			return scale(bytes, iw, ih);
		},
		close: () => void session.release().catch(() => {}),
	};
}

const CODECS = ["avc1.42E01F", "avc1.4D401F", "avc1.640028"];

async function matteEncoder(w: number, h: number, bitrate: number, fail: (error: Error) => void) {
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
					encoder.encode(frame, { keyFrame: index % FPS === 0 });
					frame.close();
					index++;
					while (encoder.encodeQueueSize > 8) await new Promise((resolve) => encoder.addEventListener("dequeue", resolve, { once: true }));
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

// The runs of frames inside the windows: [first, past the last).
function runsOf(frames: Frame[], windows: Window[]) {
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

export async function makeLocalMatte(tier: LocalTier, videoUrl: string, windows: Window[], onProgress: (part: number) => void, signal: AbortSignal): Promise<Blob> {
	const source = new RangeSource(videoUrl);
	const track = await readVideoTrack(source);
	const { frames } = track;
	const settings = SETTINGS[tier];
	const { w, h } = matteSize(track.width, track.height, settings.side);
	const model = await (tier === "fast" ? fastModel : balancedModel)(track.width, track.height, w, h);
	let failure: Error | null = null;
	const fail = (error: Error) => {
		failure = error;
	};
	const encoder = await matteEncoder(w, h, settings.bitrate, fail);
	const runs = runsOf(frames, windows);
	const total = runs.reduce((sum, [a, b]) => sum + b - a, 0);
	let done = 0;
	const check = () => {
		if (signal.aborted) throw new DOMException("Stopped", "AbortError");
		if (failure) throw failure;
	};

	const decoded: VideoFrame[] = [];
	const decoder = new VideoDecoder({ output: (frame) => decoded.push(frame), error: fail });
	decoder.configure({ codec: track.codec, description: track.description, hardwareAcceleration: "prefer-hardware" });
	try {
		let written = 0;
		for (const [first, past] of runs) {
			for (; written < first; written++) await encoder.add(null); // black outside the windows
			check();
			let start = first;
			while (start > 0 && !frames[start].key) start--;
			let next = start; // which frame the decoder gives next (no B-frames: in order)
			let previous: Uint8Array | null = null;
			let between = -1; // Balanced: a frame waiting for the next model result, to blend

			const take = async () => {
				while (decoded.length) {
					const frame = decoded.shift() as VideoFrame;
					const at = next++;
					if (at < first || at >= past) {
						frame.close();
						continue;
					}
					check();
					if ((at - first) % settings.every !== 0) {
						frame.close();
						between = at;
					} else {
						const matte: Uint8Array = await model.run(frame);
						frame.close();
						if (between >= 0 && previous) {
							const middle = new Uint8Array(matte.length);
							for (let i = 0; i < matte.length; i++) middle[i] = (matte[i] + previous[i]) / 2;
							await encoder.add(middle);
							between = -1;
						}
						await encoder.add(matte);
						previous = matte;
					}
					done++;
					onProgress(done / total);
					await breathe();
				}
			};

			for (let i = start; i < past; i++) {
				const frame = frames[i];
				const data = await source.read(frame.offset, frame.size);
				check();
				decoder.decode(new EncodedVideoChunk({ type: frame.key ? "key" : "delta", timestamp: Math.round(frame.time * 1e6), data }));
				while (decoder.decodeQueueSize > 4) await new Promise((resolve) => decoder.addEventListener("dequeue", resolve, { once: true }));
				await take();
			}
			await decoder.flush();
			await take();
			if (between >= 0) await encoder.add(previous); // the run ended on a frame with nothing after it
			written = past;
		}
		for (; written < frames.length; written++) await encoder.add(null);
		check();
		return await encoder.finish();
	} finally {
		decoded.forEach((frame) => frame.close());
		if (decoder.state !== "closed") decoder.close();
		encoder.close();
		model.close();
	}
}
