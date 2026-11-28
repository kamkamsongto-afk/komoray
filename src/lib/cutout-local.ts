// Cutout Fast and Balanced: the speaker is cut out on the customer's own computer, so it costs us no GPU.
// Reads the preview copy frame by frame, runs a small model on each frame and writes the matte
// (white = person) as a plain H.264 stream, one frame for every frame of the video, black outside the
// windows. /api/cutout/finish then turns that stream into the same files Best makes (modal_app/cutout.py),
// so the player and Make video don't know the difference.
//   Fast      Google's selfie model, on the processor, every frame (40 fps on a plain Intel laptop), in Web Workers
//             (cutout-worker.ts), off the thread that draws the screen. On a computer with several cores the video is cut
//             into stretches done at the same time; while the preview plays only one of them works (setWatching)
//   Balanced  MODNet (Apache 2.0, code and weights) on the graphics card, every second frame, the ones
//             between blended (2.8 fps on the same laptop: every frame would take twice as long)
// Tested 9 Nov on a real clip against BiRefNet: both agree with it on 98% of the person, Balanced has the cleaner edge.
import type { Window } from "./cutout";
import {
	fastModelFrom,
	type LocalTier,
	matteEncoder,
	matteSize,
	type Model,
	matteStretch,
	newTimes,
	runsOf,
	scaler,
	SETTINGS,
	type Times,
	VISION_ROOT,
	type Vision,
} from "./cutout-core";
import type { CutoutJob, CutoutMessage, CutoutPace } from "./cutout-worker";
import { RangeSource } from "./player/bytes";
import { readVideoTrack } from "./player/mp4";

export type { LocalTier };

// Is the creator watching the preview? Cutting takes the processor the picture and the sound need: they stuttered while
// it ran (coach 28 Nov). While watched, one worker carries on and the rest wait; cutting on the page itself (the last
// resort) stops until the playing does. Set by the AI studio (ScriptView).
let watching = false;
const watchers = new Set<() => void>();
export function setWatching(now: boolean) {
	if (now === watching) return;
	watching = now;
	watchers.forEach((tell) => tell());
}
function onWatching(tell: () => void) {
	watchers.add(tell);
	return () => void watchers.delete(tell);
}
// For cutting on the page itself: wait until the playing stops (or the cut is stopped).
function heldWhileWatched(signal: AbortSignal) {
	if (!watching || signal.aborted) return undefined;
	return new Promise<void>((resolve) => {
		const done = () => {
			if (watching && !signal.aborted) return;
			off();
			signal.removeEventListener("abort", done);
			resolve();
		};
		const off = onWatching(done);
		signal.addEventListener("abort", done);
	});
}
class Stalled extends Error {}

// ort.all, not the smaller ort.webgpu: with that one MODNet gave a ragged matte (agreement with BiRefNet 79% instead of 97%).
const ORT_ROOT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/";
const MODNET_MODEL = "https://huggingface.co/Xenova/modnet/resolve/fa2fa546052fba4c08921230a26cc69a333fca12/onnx/model_fp16.onnx";
const MODEL_SIDE = 512; // Balanced: the picture MODNet sees, short side (a multiple of 32)

// What this browser can do, to grey out the rest.
export async function localSupport(): Promise<Record<LocalTier, boolean>> {
	if (typeof VideoDecoder === "undefined" || typeof VideoEncoder === "undefined" || typeof OffscreenCanvas === "undefined") return { fast: false, balanced: false };
	const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
	const adapter = await gpu?.requestAdapter().catch(() => null);
	return { fast: true, balanced: Boolean(adapter) };
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

export type MatteTimes = { setup: number; modelLoad: number; read: number; decodeWait: number; model: number; encode: number; breathe: number; frames: number; modelFrames: number; total: number; size: string; workers: number };

// Workers: half of the cores, at most 3 (the computer stays usable, memory stays small), and one for a short video.
const MIN_PARALLEL_FRAMES = 120;
const STALL_MS = 180_000; // no word from any worker for this long: give up on them (start-up downloads the model, slow connections take minutes)
const MAX_WORKERS = 3; // measured 23 Nov on a 12-core computer: 3 workers 1.65x, more gave little (each frame got slower when more ran at once)
export const workersFor = (frames: number) => {
	const cores = typeof navigator === "undefined" ? 1 : navigator.hardwareConcurrency || 1;
	if (typeof Worker === "undefined" || frames < MIN_PARALLEL_FRAMES) return 1;
	return Math.max(1, Math.min(MAX_WORKERS, Math.floor(cores / 2), Math.floor(frames / 60)));
};

export type LocalOptions = {
	workers?: number; // how many workers (default workersFor); 0 = none, on the page itself
	every?: number; // the model on one frame in this many (default SETTINGS)
	makeWorker?: () => Worker; // how a worker is made (the test page has its own)
};

const defaultWorker = () => new Worker(new URL("./cutout-worker.ts", import.meta.url));

export async function makeLocalMatte(tier: LocalTier, videoUrl: string, windows: Window[], onProgress: (part: number) => void, signal: AbortSignal, onTimes?: (times: MatteTimes) => void, options: LocalOptions = {}): Promise<Blob> {
	const t0 = performance.now();
	const source = new RangeSource(videoUrl);
	const track = await readVideoTrack(source);
	const { frames } = track;
	// On trial (coach 28 Nov): ?every=1, 2 or 3 on the AI studio's address, to compare speed and edges on a real clip.
	const asked = typeof location === "undefined" ? 0 : Number(new URLSearchParams(location.search).get("every"));
	const settings = { ...SETTINGS[tier], ...(tier === "fast" && [1, 2, 3, 4].includes(asked) && { every: asked }), ...(options.every && { every: options.every }) };
	const { w, h } = matteSize(track.width, track.height, settings.side);
	const runs = runsOf(frames, windows);
	const total = runs.reduce((sum, [a, b]) => sum + b - a, 0);
	const size = `${track.width}x${track.height} -> ${w}x${h}`;
	const ms = (n: number) => Math.round(n);

	const wanted = tier === "fast" && typeof Worker !== "undefined" ? (options.workers ?? workersFor(total)) : 0;
	// Several workers, then one on its own, and only then on the page: there it takes the screen's thread.
	for (const n of wanted > 1 ? [wanted, 1] : wanted === 1 ? [1] : []) {
		try {
			const result = await parallelMatte({ n, track, runs, total, settings, url: videoUrl, onProgress, signal, makeWorker: options.makeWorker ?? defaultWorker });
			onTimes?.({ setup: ms(result.setup - t0), modelLoad: 0, read: ms(result.times.read), decodeWait: ms(result.times.decodeWait), model: ms(result.times.model), encode: ms(result.times.encode), breathe: ms(result.times.breathe), frames: total, modelFrames: result.times.modelFrames, total: ms(performance.now() - t0), size, workers: n });
			return result.blob;
		} catch (error) {
			if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
			console.warn(`Cutting in ${n} worker(s) did not work:`, error);
			onProgress(0);
			if (error instanceof Stalled) break; // gone quiet: another worker would be another three minutes of waiting
		}
	}

	const times = newTimes();
	const t1 = performance.now();
	const model = await (tier === "fast"
		? (async () => fastModelFrom((await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ `${VISION_ROOT}/vision_bundle.mjs`)) as Vision, track.width, track.height, w, h))()
		: balancedModel(track.width, track.height, w, h));
	const t2 = performance.now();
	let failure: Error | null = null;
	const fail = (error: Error) => {
		failure = error;
	};
	const encoder = await matteEncoder(w, h, settings.bitrate, fail);
	let done = 0;
	try {
		await matteStretch({
			source,
			codec: track.codec,
			description: track.description,
			frames,
			runs,
			from: 0,
			to: frames.length,
			model,
			encoder,
			every: settings.every,
			check: () => {
				if (signal.aborted) throw new DOMException("Stopped", "AbortError");
				if (failure) throw failure;
			},
			onFrame: () => onProgress(++done / total),
			hold: () => heldWhileWatched(signal),
			times,
			fail,
		});
		const blob = await encoder.finish();
		onTimes?.({ setup: ms(t1 - t0), modelLoad: ms(t2 - t1), read: ms(times.read), decodeWait: ms(times.decodeWait), model: ms(times.model), encode: ms(times.encode), breathe: ms(times.breathe), frames: done, modelFrames: times.modelFrames, total: ms(performance.now() - t0), size, workers: 0 });
		return blob;
	} finally {
		encoder.close();
		model.close();
	}
}

// The matte cut in n stretches of about the same number of frames to cut out, one worker each, then joined end to end: every
// stretch starts with a key frame and the same settings, so the pieces make one stream.
async function parallelMatte(o: {
	n: number;
	track: Awaited<ReturnType<typeof readVideoTrack>>;
	runs: [number, number][];
	total: number;
	settings: (typeof SETTINGS)["fast"];
	url: string;
	onProgress: (part: number) => void;
	signal: AbortSignal;
	makeWorker: () => Worker;
}) {
	const { track, runs, total } = o;
	// Where each stretch ends, in frames of the whole video: after about total / n frames inside the runs.
	const cuts: number[] = [0];
	let seen = 0;
	let nextCut = total / o.n;
	for (const [first, past] of runs) {
		for (let i = first; i < past; i++) {
			if (seen >= nextCut && cuts.length < o.n) {
				cuts.push(i);
				nextCut = (total * cuts.length) / o.n;
			}
			seen++;
		}
	}
	cuts.push(track.frames.length);
	const jobs: CutoutJob[] = [];
	for (let k = 0; k + 1 < cuts.length; k++) {
		const [from, to] = [cuts[k], cuts[k + 1]];
		const inside = runs.map(([a, b]): [number, number] => [Math.max(a, from), Math.min(b, to)]).filter(([a, b]) => b > a);
		jobs.push({ url: o.url, codec: track.codec, description: track.description, frames: track.frames, runs: inside, from, to, width: track.width, height: track.height, side: o.settings.side, every: o.settings.every, bitrate: o.settings.bitrate });
	}

	const workers: Worker[] = [];
	const finished: boolean[] = [];
	// While watched, only the first stretch still to be done works; when it is done the next one takes over.
	const pace = () => {
		let carrying = false;
		workers.forEach((worker, k) => {
			if (finished[k]) return;
			const go = !watching || !carrying;
			carrying = true;
			worker.postMessage({ pace: go ? "go" : "wait" } satisfies CutoutPace);
		});
	};
	let stopPacing = () => {};
	const stop = () => workers.forEach((worker) => worker.terminate());
	const onAbort = () => {
		stop();
		stalled(new DOMException("Stopped", "AbortError")); // Stop answers at once, not after the stall timer
	};
	o.signal.addEventListener("abort", onAbort, { once: true });
	const setup = performance.now();
	let done = 0;
	// A worker that goes quiet (a browser that can't run it, a codec that stopped) must not hang the page: no message for this long
	// and the pieces are given up, and the video is cut alone instead.
	let alarm: ReturnType<typeof setTimeout> | undefined;
	let stalled: (error: Error) => void = () => {};
	const stall = new Promise<never>((_, reject) => (stalled = reject));
	stall.catch(() => {}); // nobody is waiting on it once the pieces are in
	const wake = () => {
		clearTimeout(alarm);
		alarm = setTimeout(() => stalled(new Stalled("The workers stopped answering.")), STALL_MS);
	};
	wake();
	try {
		const all = Promise.all(
			jobs.map(
				(job, k) =>
					new Promise<{ blob: Blob; times: Times }>((resolve, reject) => {
						const worker = o.makeWorker();
						workers.push(worker);
						worker.onmessage = (e: MessageEvent<CutoutMessage>) => {
							wake();
							const m = e.data;
							if (m.type === "progress") {
								done += m.frames;
								o.onProgress(Math.min(1, done / total));
							} else if (m.type === "done") {
								finished[k] = true;
								pace();
								resolve({ blob: m.blob, times: m.times });
							} else reject(new Error(m.message));
						};
						worker.onerror = (e) => reject(new Error(e.message || "A worker could not start."));
						worker.onmessageerror = () => reject(new Error("A worker sent something unreadable."));
						worker.postMessage(job);
					}),
			),
		);
		stopPacing = onWatching(pace); // every worker is made by now
		pace();
		const pieces = await Promise.race([stall, all]);
		if (o.signal.aborted) throw new DOMException("Stopped", "AbortError");
		const times = newTimes();
		for (const p of pieces) (Object.keys(times) as (keyof Times)[]).forEach((key) => (times[key] += p.times[key]));
		return { blob: new Blob(pieces.map((p) => p.blob), { type: "video/h264" }), times, setup };
	} catch (error) {
		if (o.signal.aborted) throw new DOMException("Stopped", "AbortError");
		throw error;
	} finally {
		clearTimeout(alarm);
		stopPacing();
		stop();
		o.signal.removeEventListener("abort", onAbort);
	}
}
