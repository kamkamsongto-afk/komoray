// How loud the video is, moment by moment, for the timeline's waveform. Read from the preview's
// sound (proxy-audio.pcm: mono, 16-bit, 24 kHz, no header), a couple of MB at a time.

const AUDIO_RATE = 24000; // AUDIO_RATE in lib/player/engine.ts
export const PEAKS_PER_SECOND = 100;
const SAMPLES_PER_PEAK = AUDIO_RATE / PEAKS_PER_SECOND;
const CHUNK = SAMPLES_PER_PEAK * 2 * 4096; // bytes per request: a whole number of peaks (~2 MB)

// Calls onProgress with the peaks so far (0..1, loudest sample in each 1/100 s) after every chunk.
export async function loadPeaks(url: string, onProgress: (peaks: Float32Array) => void, signal: AbortSignal) {
	let peaks: Float32Array | null = null;
	for (let from = 0; ; from += CHUNK) {
		const res = await fetch(url, { headers: { Range: `bytes=${from}-${from + CHUNK - 1}` }, signal });
		if (res.status === 416) break;
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const total = Number(res.headers.get("Content-Range")?.split("/")[1] ?? res.headers.get("Content-Length"));
		peaks ??= new Float32Array(Math.ceil(total / 2 / SAMPLES_PER_PEAK));
		const raw = await res.arrayBuffer();
		// A server that ignores Range sends the whole file at once.
		const start = res.status === 200 ? 0 : from;
		const samples = new Int16Array(raw, 0, raw.byteLength >> 1);
		const first = start / 2 / SAMPLES_PER_PEAK;
		for (let p = 0; p * SAMPLES_PER_PEAK < samples.length && first + p < peaks.length; p++) {
			let max = 0;
			const end = Math.min(samples.length, (p + 1) * SAMPLES_PER_PEAK);
			for (let i = p * SAMPLES_PER_PEAK; i < end; i++) {
				const v = Math.abs(samples[i]);
				if (v > max) max = v;
			}
			peaks[first + p] = max / 32768;
		}
		onProgress(peaks);
		if (res.status === 200 || start + raw.byteLength >= total) break;
	}
}
