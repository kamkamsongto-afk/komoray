// The editor's own player: plays the kept pieces of the preview copy back to back without ever
// asking the browser's <video> to start or jump (Safari takes 0.5-1.6 s for each, which froze the
// picture at every cut). Instead:
//   sound   raw samples (proxy-audio.pcm) cut sample-exact and queued in Web Audio; it is the clock
//   picture frames of proxy.mp4 decoded ahead with WebCodecs and drawn on a canvas at their time
// At a cut the decoder is simply fed the frames of the next piece (from the keyframe before it,
// throwing away the frames before the cut), so nothing waits on the browser.
import { type ByteSource, RangeSource } from "./bytes";
import { type Frame, readVideoTrack, type VideoTrack } from "./mp4";

export type Piece = { start: number; end: number; out: number }; // play source [start, end) at final-video time `out`
export type StudioMedia = { videoUrl: string; audioUrl: string };

export type EngineEvents = {
	onTime: (out: number) => void; // every frame while playing, and after jumps
	onState: (state: { playing: boolean; busy: boolean }) => void;
	onError: (error: Error) => void;
	log: (what: string, detail?: Record<string, unknown>) => void;
};

const AUDIO_RATE = 24000; // samples per second in proxy-audio.pcm (PROXY_AUDIO_RATE in lib/proxy.ts)
const FADE_SAMPLES = 72; // 3 ms fade at every cut, so cuts don't click
const AUDIO_AHEAD = 2.5; // seconds of sound queued ahead
const AUDIO_SLICE = 2; // seconds per queued piece of sound
const FRAMES_AHEAD = 30; // decoded frames kept ready (~1 s)
const DECODE_QUEUE = 6;
const START_FRAMES = 4; // frames ready before starting (or restarting after running dry)
const START_DELAY = 0.06; // seconds between "go" and the first sound, to queue it in time
const EPS = 1e-3;

type Ready = { out: number; frame: VideoFrame };
type Feed = { piece: number; frame: number; firstShown: number }; // next frame to send to the decoder

export const studioSupported = () => typeof window !== "undefined" && "VideoDecoder" in window && "AudioContext" in window;

export class StudioEngine {
	private track: VideoTrack | null = null;
	private video: ByteSource;
	private audio: ByteSource;
	private decoder: VideoDecoder | null = null;
	private pieces: Piece[] = [];
	private total = 0;

	private generation = 0; // bumped on every jump; late results from before are thrown away
	private feed: Feed | null = null;
	private pending: { out: number | null; generation: number }[] = []; // sent to the decoder, in order
	private ready: Ready[] = [];
	private shownFrame: VideoFrame | null = null;
	private sizeLogged = false;
	private pumping = false;

	private ctx: AudioContext | null = null;
	private sources: AudioBufferSourceNode[] = [];
	private queuedUntil = 0; // final-video time the sound is queued up to
	private queueing = false;

	private position = 0; // final-video time while paused / waiting
	private playing = false; // the user wants it playing
	private running = false; // the clock is actually going (not waiting for data)
	private startCtx = 0;
	private startOut = 0;
	private frame = 0;
	private destroyed = false;

	constructor(
		media: StudioMedia,
		private canvas: HTMLCanvasElement,
		private events: EngineEvents,
	) {
		const onFetch = (kind: string) => (info: { block: number; ms: number; bytes: number }) => events.log("fetch", { kind, ...info });
		this.video = new RangeSource(media.videoUrl, onFetch("video"));
		this.audio = new RangeSource(media.audioUrl, onFetch("audio"));
	}

	async load(pieces: Piece[], at: number) {
		const started = performance.now();
		this.track = await readVideoTrack(this.video);
		const config: VideoDecoderConfig = { codec: this.track.codec, description: this.track.description, optimizeForLatency: true };
		const support = await VideoDecoder.isConfigSupported(config);
		if (!support.supported) throw new Error(`This browser can't decode ${this.track.codec}`);
		this.events.log("loaded", { ms: Math.round(performance.now() - started), frames: this.track.frames.length, codec: this.track.codec });
		this.pieces = pieces;
		this.total = this.totalOf(pieces);
		this.jump(at);
		this.loop();
	}

	// ---- final-video time ↔ source time ----

	private totalOf(pieces: Piece[]) {
		const last = pieces[pieces.length - 1];
		return last ? last.out + last.end - last.start : 0;
	}

	toSource(out: number, pieces = this.pieces) {
		const p = pieces.find((x) => out < x.out + x.end - x.start) ?? pieces[pieces.length - 1];
		return p ? p.start + Math.max(0, out - p.out) : 0;
	}

	toOut(source: number, pieces = this.pieces) {
		const p = pieces.find((x) => source < x.end - 0.01) ?? pieces[pieces.length - 1];
		return p ? p.out + Math.max(0, source - p.start) : 0;
	}

	now() {
		if (!this.running || !this.ctx) return this.position;
		const latency = (this.ctx as AudioContext & { outputLatency?: number }).outputLatency || this.ctx.baseLatency || 0;
		return Math.max(this.startOut, this.startOut + this.ctx.currentTime - this.startCtx - latency);
	}

	// ---- controls ----

	// Call from the tap/click itself: iPhone/iPad only allow sound to start inside a user gesture.
	play() {
		if (this.destroyed || !this.track) return;
		if (!this.ctx) {
			const session = (navigator as { audioSession?: { type: string } }).audioSession;
			if (session) session.type = "playback"; // play with the iPhone's silent switch on, like video does
			this.ctx = new AudioContext({ latencyHint: "interactive" });
		}
		void this.ctx.resume();
		if (this.position >= this.total - 0.05) this.jump(0);
		this.playing = true;
		this.events.log("play", { at: round(this.position) });
		this.emitState();
	}

	pause() {
		if (!this.playing) return;
		this.position = Math.min(this.now(), this.total);
		this.playing = false;
		this.stopClock();
		this.events.log("pause", { at: round(this.position) });
		this.emitState();
	}

	seek(out: number) {
		this.jump(Math.min(Math.max(0, out), this.total));
	}

	// Words deleted or restored: keep the same moment of the source, on the new cut list.
	setPieces(pieces: Piece[]) {
		const source = this.toSource(this.running ? this.now() : this.position);
		this.pieces = pieces;
		this.total = this.totalOf(pieces);
		this.jump(Math.min(this.toOut(source), this.total));
	}

	destroy() {
		this.destroyed = true;
		cancelAnimationFrame(this.frame);
		this.stopClock();
		this.resetDecoder();
		this.shownFrame?.close();
		this.shownFrame = null;
		void this.ctx?.close();
	}

	// ---- jumping ----

	private jump(out: number) {
		this.stopClock();
		this.position = out;
		this.generation++;
		this.resetDecoder();
		this.feed = this.feedAt(out);
		this.shownSinceJump = false;
		this.flushed = false;
		this.lastShownOut = out;
		this.primeAudio(out);
		this.events.log("jump", { at: round(out) });
		this.events.onTime(out);
		this.emitState();
	}

	private stopClock() {
		if (this.running) this.position = Math.min(this.now(), this.total);
		this.running = false;
		for (const s of this.sources) {
			try {
				s.stop();
			} catch {
				// already stopped
			}
		}
		this.sources = [];
		this.queuedUntil = this.position;
	}

	private resetDecoder() {
		for (const r of this.ready) r.frame.close();
		this.ready = [];
		this.pending = [];
		if (this.decoder && this.decoder.state !== "closed") this.decoder.close();
		this.decoder = null;
		if (this.destroyed || !this.track) return;
		const generation = this.generation;
		this.decoder = new VideoDecoder({
			output: (frame) => {
				const meta = this.pending.shift();
				if (!meta || meta.generation !== generation || meta.out === null || this.destroyed) return frame.close();
				this.ready.push({ out: meta.out, frame });
			},
			error: (e) => {
				if (generation === this.generation && !this.destroyed) this.events.onError(e instanceof Error ? e : new Error(String(e)));
			},
		});
		this.decoder.configure({ codec: this.track.codec, description: this.track.description, optimizeForLatency: true });
	}

	// ---- which frames to decode ----

	private frames(): Frame[] {
		return this.track?.frames ?? [];
	}

	// Index of the frame on screen at source time t.
	private frameAt(t: number) {
		const frames = this.frames();
		let lo = 0;
		let hi = frames.length - 1;
		let found = 0;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (frames[mid].time <= t + EPS) {
				found = mid;
				lo = mid + 1;
			} else hi = mid - 1;
		}
		return found;
	}

	private keyBefore(index: number) {
		const frames = this.frames();
		let k = index;
		while (k > 0 && !frames[k].key) k--;
		return k;
	}

	private feedAt(out: number): Feed | null {
		const piece = this.pieces.findIndex((p) => out < p.out + p.end - p.start - EPS);
		if (piece === -1) return null;
		const p = this.pieces[piece];
		const shown = this.frameAt(p.start + Math.max(0, out - p.out));
		return { piece, frame: this.keyBefore(shown), firstShown: shown };
	}

	// The next frame to decode, and when it shows in the final video (null: decode but don't show).
	private next(): { index: number; out: number | null } | null {
		const feed = this.feed;
		const frames = this.frames();
		while (feed && feed.piece < this.pieces.length) {
			const p = this.pieces[feed.piece];
			const f = frames[feed.frame];
			if (f && f.time < p.end - EPS) {
				feed.frame++;
				if (feed.frame - 1 < feed.firstShown) return { index: feed.frame - 1, out: null };
				return { index: feed.frame - 1, out: p.out + Math.max(0, f.time - p.start) };
			}
			// On to the next piece: carry on if its first frame is the next one, else restart at its keyframe.
			feed.piece++;
			const n = this.pieces[feed.piece];
			if (!n) break;
			const shown = this.frameAt(n.start);
			feed.firstShown = shown;
			feed.frame = shown === feed.frame ? shown : this.keyBefore(shown);
		}
		this.feed = null;
		return null;
	}

	private async pump() {
		if (this.pumping) return;
		this.pumping = true;
		const generation = this.generation;
		try {
			while (!this.destroyed && generation === this.generation && this.decoder && this.decoder.state === "configured") {
				if (this.decoder.decodeQueueSize >= DECODE_QUEUE || this.ready.length + this.pending.length >= FRAMES_AHEAD) break;
				const item = this.next();
				if (!item) {
					// Nothing left to send: make the decoder hand over the frames it still holds.
					if (this.pending.length && !this.flushed) {
						this.flushed = true;
						await this.decoder.flush().catch(() => {});
					}
					break;
				}
				const f = this.frames()[item.index];
				this.video.prefetch(f.offset, 2 << 20); // the next ~2 MB, so reading never waits for the network
				const data = await this.video.read(f.offset, f.size);
				if (generation !== this.generation || !this.decoder || this.decoder.state !== "configured") break;
				this.pending.push({ out: item.out, generation });
				this.decoder.decode(new EncodedVideoChunk({ type: f.key ? "key" : "delta", timestamp: Math.round(f.time * 1e6), duration: Math.round(f.duration * 1e6), data }));
			}
		} catch (err) {
			if (generation === this.generation && !this.destroyed) this.events.onError(err instanceof Error ? err : new Error(String(err)));
		} finally {
			this.pumping = false;
		}
	}

	// ---- sound ----

	// Load the first second of sound at `out` before the clock may start, else its start is skipped.
	private audioPrimed = false;
	private primeAudio(out: number) {
		this.audioPrimed = false;
		const generation = this.generation;
		const p = this.pieces.find((x) => out < x.out + x.end - x.start - EPS);
		if (!p) {
			this.audioPrimed = true;
			return;
		}
		const a0 = Math.round((p.start + out - p.out) * AUDIO_RATE);
		this.audio
			.read(a0 * 2, AUDIO_RATE * 2)
			.then(() => generation === this.generation && (this.audioPrimed = true))
			.catch((err: Error) => generation === this.generation && this.events.onError(err));
	}

	private async queueAudio() {
		if (this.queueing || !this.ctx || !this.running) return;
		this.queueing = true;
		const generation = this.generation;
		const ctx = this.ctx;
		try {
			const horizon = Math.min(this.now() + AUDIO_AHEAD, this.total);
			while (this.queuedUntil < horizon - EPS && generation === this.generation && this.running) {
				const out = this.queuedUntil;
				const p = this.pieces.find((x) => out < x.out + x.end - x.start - EPS);
				if (!p) break;
				const pieceEnd = p.out + p.end - p.start;
				const sliceEnd = Math.min(pieceEnd, out + AUDIO_SLICE);
				const a0 = Math.round((p.start + out - p.out) * AUDIO_RATE);
				const a1 = Math.round((p.start + sliceEnd - p.out) * AUDIO_RATE);
				this.queuedUntil = sliceEnd;
				if (a1 <= a0) continue;
				const raw = await this.audio.read(a0 * 2, (a1 - a0) * 2);
				if (generation !== this.generation || !this.running) break;
				const samples = new Int16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + (raw.byteLength & ~1)));
				const buffer = ctx.createBuffer(1, Math.max(1, samples.length), AUDIO_RATE);
				const data = buffer.getChannelData(0);
				for (let i = 0; i < samples.length; i++) data[i] = samples[i] / 32768;
				// Fade in at the start of a piece and out at its end, so the cut doesn't click.
				// (Also when starting in the middle of a piece.)
				if (Math.abs(out - p.out) < EPS || Math.abs(out - this.startOut) < EPS) {
					for (let i = 0; i < Math.min(FADE_SAMPLES, data.length); i++) data[i] *= i / FADE_SAMPLES;
				}
				if (Math.abs(sliceEnd - pieceEnd) < EPS) {
					for (let i = 0; i < Math.min(FADE_SAMPLES, data.length); i++) data[data.length - 1 - i] *= i / FADE_SAMPLES;
				}
				const source = ctx.createBufferSource();
				source.buffer = buffer;
				source.connect(ctx.destination);
				const when = this.startCtx + (out - this.startOut);
				const late = ctx.currentTime - when;
				if (late >= buffer.duration) continue;
				if (late > 0) this.events.log("audioLate", { at: round(out), ms: Math.round(late * 1000) });
				source.start(Math.max(when, ctx.currentTime), Math.max(0, late));
				this.sources.push(source);
				source.onended = () => (this.sources = this.sources.filter((s) => s !== source));
			}
		} catch (err) {
			if (generation === this.generation && !this.destroyed) this.events.onError(err instanceof Error ? err : new Error(String(err)));
		} finally {
			this.queueing = false;
		}
	}

	// ---- every frame ----

	private loop = () => {
		if (this.destroyed) return;
		this.frame = requestAnimationFrame(this.loop);
		void this.pump();

		// Waiting to start (or ran dry): go once a few frames are decoded and the first sound is in.
		if (this.playing && !this.running) {
			const enough = this.ready.length >= START_FRAMES || (!this.feed && !this.pending.length);
			if (enough && this.audioPrimed && this.ctx && this.ctx.state === "running") this.startClock();
		}

		const out = this.now();
		// Drop frames whose time is over; show the latest one that is due. After a jump, show the
		// first frame right away even while paused, so the picture matches the new spot.
		while (this.ready.length > 1 && this.ready[1].out <= out + EPS) {
			this.ready.shift()!.frame.close();
			this.counts.dropped++;
		}
		const due = this.ready[0];
		if (due && (due.out <= out + 0.02 || !this.shownSinceJump)) {
			this.ready.shift();
			this.shownSinceJump = true;
			this.counts.drawn++;
			this.counts.lateMs = Math.max(this.counts.lateMs, Math.round((out - due.out) * 1000));
			this.draw(due.frame);
		}

		if (this.running) {
			void this.queueAudio();
			this.events.onTime(out);
			if (out >= this.total - EPS) {
				this.position = this.total;
				this.playing = false;
				this.stopClock();
				this.events.log("end");
				this.emitState();
			} else if (!this.ready.length && (this.feed || this.pending.length) && out - this.lastShownOut > 0.15) {
				// The picture can't keep up (slow network): stop the clock and wait for it.
				this.events.log("stall", { at: round(out), pending: this.pending.length, queue: this.decoder?.decodeQueueSize });
				this.stopClock();
				this.emitState();
			}
		}
	};

	private lastShownOut = 0;
	private shownSinceJump = false;
	private flushed = false;

	private startClock() {
		if (!this.ctx) return;
		this.startCtx = this.ctx.currentTime + START_DELAY;
		this.startOut = this.position;
		this.queuedUntil = this.position;
		this.lastShownOut = this.position;
		this.running = true;
		this.events.log("start", { at: round(this.position), ready: this.ready.length });
		void this.queueAudio();
		this.emitState();
	}

	private draw(frame: VideoFrame) {
		const ctx2d = this.canvas.getContext("2d");
		if (!ctx2d) return frame.close();
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		const w = Math.round(this.canvas.clientWidth * dpr);
		const h = Math.round(this.canvas.clientHeight * dpr);
		if (w && h && (this.canvas.width !== w || this.canvas.height !== h)) {
			this.canvas.width = w;
			this.canvas.height = h;
		}
		// Fill the 9:16 box, cropping the middle, like the final video does. The whole frame is drawn
		// scaled and centred and the canvas edge cuts off the rest: Safari squashes the frame instead
		// of cropping when drawImage is given a source rectangle.
		const fw = frame.displayWidth;
		const fh = frame.displayHeight;
		const cw = this.canvas.width;
		const ch = this.canvas.height;
		const scale = Math.max(cw / fw, ch / fh);
		const dw = fw * scale;
		const dh = fh * scale;
		if (!this.sizeLogged) {
			this.sizeLogged = true;
			this.events.log("size", { fw, fh, coded: `${frame.codedWidth}x${frame.codedHeight}`, cw, ch });
		}
		ctx2d.drawImage(frame, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
		this.shownFrame?.close();
		this.shownFrame = frame;
		this.lastShownOut = this.now();
	}

	private emitState() {
		this.events.onState({ playing: this.playing, busy: this.playing && !this.running });
	}

	// For the debug recorder: frames drawn / thrown away (too late) and the latest draw since the last call.
	private counts = { drawn: 0, dropped: 0, lateMs: 0 };

	stats() {
		const counts = this.counts;
		this.counts = { drawn: 0, dropped: 0, lateMs: 0 };
		return {
			...counts,
			at: round(this.now()),
			playing: this.playing,
			running: this.running,
			ready: this.ready.length,
			pending: this.pending.length,
			queue: this.decoder?.decodeQueueSize ?? -1,
			audioQueued: round(this.queuedUntil),
			sources: this.sources.length,
			ctx: this.ctx?.state ?? "none",
		};
	}
}

const round = (n: number) => Math.round(n * 1000) / 1000;
