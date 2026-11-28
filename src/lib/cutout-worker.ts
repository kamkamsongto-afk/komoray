// One of several workers that cut the speaker out of their own stretch of the video at the same time (Fast only), so a long
// clip uses more than one processor core (coach 23 Nov: on a 12-core computer the model took 84% of the time, on one core).
// A classic worker, not a module one: Google's MediaPipe needs importScripts, which module workers don't have. The page
// (cutout-local.ts) sends the job and joins the matte pieces; it falls back to cutting alone if a worker can't start.
import { fastModelFrom, matteEncoder, matteStretch, matteSize, newTimes, type Times, VISION_ROOT, type Vision } from "./cutout-core";
import { RangeSource } from "./player/bytes";
import type { Frame } from "./player/mp4";

export type CutoutJob = {
	url: string;
	codec: string;
	description: Uint8Array;
	frames: Frame[]; // the whole video's frame table
	runs: [number, number][]; // inside the windows, within this worker's stretch
	from: number;
	to: number; // past the last
	width: number;
	height: number;
	side: number;
	bitrate: number;
};
// Sent to a worker after its job: work on, or wait (the preview is playing and another worker is carrying on).
export type CutoutPace = { pace: "go" | "wait" };
export type CutoutMessage = { type: "progress"; frames: number } | { type: "done"; blob: Blob; times: Times } | { type: "error"; message: string };

type Scope = { importScripts: (url: string) => void; postMessage: (m: CutoutMessage) => void; onmessage: ((e: MessageEvent<CutoutJob | CutoutPace>) => void) | null; exports?: unknown };
const scope = self as unknown as Scope;

// jsDelivr sends .cjs as a type importScripts refuses, so it is fetched and handed over as JavaScript.
async function loadVision(): Promise<Vision> {
	scope.exports = {};
	const code = await (await fetch(`${VISION_ROOT}/vision_bundle.cjs`)).text();
	scope.importScripts(URL.createObjectURL(new Blob([code], { type: "text/javascript" })));
	return scope.exports as Vision;
}

let waiting = false;
let goOn: (() => void) | null = null;
const hold = () => (waiting ? new Promise<void>((resolve) => (goOn = resolve)) : undefined);

scope.onmessage = async (e) => {
	if ("pace" in e.data) {
		waiting = e.data.pace === "wait";
		if (!waiting) {
			goOn?.();
			goOn = null;
		}
		return;
	}
	const job = e.data;
	let failure: Error | null = null;
	const fail = (error: Error) => {
		failure = error;
	};
	try {
		const { w, h } = matteSize(job.width, job.height, job.side);
		const model = await fastModelFrom(await loadVision(), job.width, job.height, w, h);
		const encoder = await matteEncoder(w, h, job.bitrate, fail);
		const times = newTimes();
		let done = 0;
		try {
			await matteStretch({
				source: new RangeSource(job.url),
				codec: job.codec,
				description: job.description,
				frames: job.frames,
				runs: job.runs,
				from: job.from,
				to: job.to,
				model,
				encoder,
				every: 1,
				check: () => {
					if (failure) throw failure;
				},
				onFrame: () => {
					if (++done % 8 === 0) scope.postMessage({ type: "progress", frames: 8 });
				},
				hold,
				times,
				fail,
			});
			scope.postMessage({ type: "progress", frames: done % 8 });
			scope.postMessage({ type: "done", blob: await encoder.finish(), times });
		} finally {
			encoder.close();
			model.close();
		}
	} catch (error) {
		scope.postMessage({ type: "error", message: error instanceof Error && error.message ? error.message : "The cutout stopped." });
	}
};
