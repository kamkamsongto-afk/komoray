// Flight recorder for the editor's preview, on with ?debug=1 in the page address.
// Problems that only happen on someone's iPad can't be watched from here, so this writes down
// what the player does (events, positions, our own decisions) and sends it to logs/debug/ in R2
// every few seconds, where it can be read afterwards. Off: every call does nothing.
export type DebugEvent = { t: number; what: string; [detail: string]: unknown };

const SEND_EVERY_MS = 10000;
const MAX_EVENTS = 6000; // ~10 minutes of playback; later events are dropped

export type DebugLog = {
	on: boolean;
	log: (what: string, detail?: Record<string, unknown>) => void;
	send: (reason: string) => void;
	count: () => number;
	close: () => void; // send what is left and stop the timer
};

const OFF: DebugLog = { on: false, log: () => {}, send: () => {}, count: () => 0, close: () => {} };

export function createDebugLog(meta: Record<string, unknown>): DebugLog {
	if (typeof window === "undefined" || !new URLSearchParams(window.location.search).has("debug")) return OFF;
	const started = performance.now();
	const session = crypto.randomUUID().slice(0, 8);
	const events: DebugEvent[] = [];
	let sentUpTo = 0;
	let part = 0;

	const send = (reason: string) => {
		if (sentUpTo === events.length) return;
		const batch = events.slice(sentUpTo);
		sentUpTo = events.length;
		void fetch("/api/debug-log", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ session, part: part++, reason, meta, events: batch }),
			keepalive: batch.length < 400, // keepalive bodies are limited to 64 KB
		}).catch(() => {});
	};
	const timer = setInterval(() => send("timer"), SEND_EVERY_MS);
	const onHide = () => send("pagehide");
	window.addEventListener("pagehide", onHide);

	return {
		on: true,
		log: (what, detail) => {
			if (events.length < MAX_EVENTS) events.push({ t: Math.round(performance.now() - started), what, ...detail });
		},
		send,
		count: () => events.length,
		close: () => {
			send("closed");
			clearInterval(timer);
			window.removeEventListener("pagehide", onHide);
		},
	};
}

// The state of one <video>, short enough to log many times a second.
export function videoState(video: HTMLVideoElement | null) {
	if (!video) return null;
	return {
		at: Math.round(video.currentTime * 1000) / 1000,
		paused: video.paused,
		seeking: video.seeking,
		ready: video.readyState,
		muted: video.muted,
		rate: video.playbackRate,
		buffered: video.buffered.length ? Math.round(video.buffered.end(video.buffered.length - 1) * 10) / 10 : 0,
	};
}
