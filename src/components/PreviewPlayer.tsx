"use client";

import { Kanit } from "next/font/google";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { LIMITS, type SubtitleStyle } from "@/lib/subtitle-style";
import { FPS, HEIGHT, type Line, type Segment, WIDTH } from "@/lib/timeline";

// Same look as the final video (Kanit Medium, side margins 80px in modal_app/render.py).
const kanit = Kanit({ weight: "500", subsets: ["thai", "latin"] });
const SIDE_MARGIN = 80;

export type PreviewHandle = { seek: (sourceSeconds: number) => void; play: () => void };

type Props = {
	src: string;
	segments: Segment[];
	lines: Line[];
	subtitle: SubtitleStyle;
	onSubtitleChange: (style: SubtitleStyle) => void; // dragged up or down on the video
	onTime: (sourceSeconds: number) => void; // where we are in the original video, every frame
	onPlayingChange: (playing: boolean) => void;
};

// Kept pieces in seconds: play source [start, end) at output time `out`.
type Piece = { start: number; end: number; out: number };

const LEAD = 0.5;

// Every browser on iPhone/iPad is Safari underneath; their names say CriOS, FxiOS, EdgiOS, not Chrome.
const isSafari = () => /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Android/.test(navigator.userAgent);

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// The final video, played live: the kept pieces back to back, cropped to 9:16, with subtitles.
// Two <video> elements take turns: while one plays a piece, the other waits just before the next
// piece, so every cut is a swap instead of a seek (which would stutter). The waiting one starts
// LEAD seconds early, muted and underneath, and is nudged faster or slower to hit the cut on time:
// Safari takes a moment to start a video, which showed as a freeze and a black flash at each cut.
// Only on Safari: Chrome starts instantly, and decoding two videos at once made it drop frames.
export const PreviewPlayer = forwardRef<PreviewHandle, Props>(function PreviewPlayer(
	{ src, segments, lines, subtitle, onSubtitleChange, onTime, onPlayingChange },
	ref,
) {
	const pieces = useMemo<Piece[]>(
		() => segments.map((s) => ({ start: s.trim / FPS, end: (s.trim + s.frames) / FPS, out: s.from / FPS })),
		[segments],
	);
	const last = pieces[pieces.length - 1];
	const total = last ? last.out + last.end - last.start : 0;

	const videoA = useRef<HTMLVideoElement>(null);
	const videoB = useRef<HTMLVideoElement>(null);
	const videos = [videoA, videoB];
	const boxRef = useRef<HTMLDivElement>(null);
	const [active, setActive] = useState(0); // which <video> is showing
	const activeRef = useRef(0);
	const pieceRef = useRef(0); // which piece is playing
	const cutRef = useRef(false); // shown video stopped at a cut, the other one not there yet
	const [lead, setLead] = useState(0); // seconds the waiting video starts early (Safari only)
	const leadRef = useRef(0);
	const [playing, setPlaying] = useState(false);
	const [outTime, setOutTime] = useState(0);
	const [scale, setScale] = useState(0.3);
	const dragRef = useRef<{ y: number; position: number } | null>(null);

	const shown = () => (activeRef.current === 0 ? videoA : videoB).current;
	const waiting = () => (activeRef.current === 0 ? videoB : videoA).current;

	// The subtitle layer is drawn at full 1080x1920 and shrunk to fit, so sizes match the final video.
	useEffect(() => {
		const box = boxRef.current;
		if (!box) return;
		const observer = new ResizeObserver(() => setScale(box.clientWidth / WIDTH));
		observer.observe(box);
		return () => observer.disconnect();
	}, []);

	// Only the video on screen is heard (set directly, not through React, so it changes on the exact frame).
	useEffect(() => {
		if (videoA.current) videoA.current.muted = false;
		if (videoB.current) videoB.current.muted = true;
		leadRef.current = isSafari() ? LEAD : 0;
		setLead(leadRef.current);
	}, []);

	// Stop the waiting <video> and park it `lead` seconds before the piece after `index`.
	const prepareNext = useCallback(
		(index: number) => {
			const video = waiting();
			const next = pieces[index + 1];
			if (!video) return;
			if (!video.paused) video.pause();
			video.playbackRate = 1;
			const at = next ? Math.max(0, next.start - leadRef.current) : 0;
			if (next && Math.abs(video.currentTime - at) > 0.02) video.currentTime = at;
		},
		[pieces],
	);

	const seek = useCallback(
		(t: number) => {
			const video = shown();
			if (!video || !pieces.length) return;
			cutRef.current = false;
			let i = pieces.findIndex((p) => t < p.end - 0.01);
			if (i === -1) i = pieces.length - 1;
			pieceRef.current = i;
			const at = Math.max(t, pieces[i].start); // a moment that was cut lands on the next kept frame
			video.currentTime = at;
			setOutTime(pieces[i].out + at - pieces[i].start);
			onTime(at);
			prepareNext(i);
		},
		[pieces, prepareNext, onTime],
	);

	const play = useCallback(() => {
		const video = shown();
		if (!video || !last) return;
		// Finished? Start again from the top.
		if (pieceRef.current === pieces.length - 1 && video.currentTime >= last.end - 0.05) seek(pieces[0].start);
		void video.play();
		// iPhone/iPad only let a video be unmuted later if it was played from a tap, so tap the waiting one too.
		const other = waiting();
		if (other?.paused) {
			other.play().catch(() => {});
			other.pause();
		}
	}, [pieces, last, seek]);

	// Both videos, since the waiting one may already be running ahead of a cut.
	const pause = useCallback(() => {
		cutRef.current = false;
		shown()?.pause();
		prepareNext(pieceRef.current);
		setPlaying(false);
	}, [prepareNext]);

	useImperativeHandle(ref, () => ({ seek, play }), [seek, play]);

	// Words deleted or restored: stay at the same moment of the source, re-aim the waiting video.
	// (Not on first load: the page tells us where to start.)
	const loadedRef = useRef(false);
	useEffect(() => {
		const video = shown();
		if (video && loadedRef.current) seek(video.currentTime);
		loadedRef.current = true;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pieces]);

	useEffect(() => onPlayingChange(playing), [playing, onPlayingChange]);

	// While playing: follow the clock every frame and swap videos at each cut.
	useEffect(() => {
		if (!playing) return;
		let frame = 0;
		const tick = () => {
			const video = shown();
			const other = waiting();
			const piece = pieces[pieceRef.current];
			const next = pieces[pieceRef.current + 1];
			if (video && piece) {
				const left = piece.end - video.currentTime; // seconds of this piece still to show
				if (next && other) {
					if (left <= leadRef.current + 0.02 && other.paused) other.play().catch(() => {});
					if (!other.paused) {
						// Where it should be so it reaches the next piece exactly when this one ends.
						// Only change speed when clearly off: every change makes Chrome rebuild its audio and drop frames.
						const behind = next.start - Math.max(0, left) - other.currentTime;
						const rate = behind > 0.15 ? 2 : behind > 0.04 ? 1.25 : behind < -0.04 ? 0.8 : 1;
						if (other.playbackRate !== rate) other.playbackRate = rate;
					}
				}
				if (left <= 0.02 && !video.paused) {
					// Hold the last frame on screen (not black) until the other video arrives.
					cutRef.current = !!next;
					video.pause();
				}
				if (next && other && !other.paused && other.currentTime >= next.start - 0.01) {
					other.playbackRate = 1;
					other.muted = false;
					video.muted = true;
					activeRef.current = 1 - activeRef.current;
					setActive(activeRef.current);
					if (!video.paused) video.pause();
					cutRef.current = false;
					pieceRef.current += 1;
					prepareNext(pieceRef.current);
				}
				const now = shown()!;
				const p = pieces[pieceRef.current];
				setOutTime(p.out + Math.max(0, now.currentTime - p.start));
				onTime(now.currentTime);
			}
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [playing, pieces, prepareNext, onTime]);

	const line = lines.find((l) => outTime * FPS >= l.from && outTime * FPS < l.to);
	const toggle = () => (playing ? pause() : play());

	// Dragging the bar: final-video time → source time.
	function scrub(out: number) {
		const p = pieces.find((x) => out < x.out + x.end - x.start) ?? last;
		if (p) seek(p.start + Math.max(0, out - p.out));
	}

	return (
		// As wide as fits, but never taller than ~70% of the screen.
		<div className="mx-auto flex w-full flex-col gap-2" style={{ maxWidth: "calc(70vh * 9 / 16)" }}>
			<div
				ref={boxRef}
				onClick={toggle}
				className="relative w-full cursor-pointer overflow-hidden rounded-lg bg-black"
				style={{ aspectRatio: `${WIDTH} / ${HEIGHT}` }}
			>
				{videos.map((r, i) => (
					<video
						key={i}
						ref={r}
						src={src}
						playsInline
						preload="auto"
						// The hidden video pauses on every swap; only the one on screen speaks for the player.
						onPlay={() => i === activeRef.current && setPlaying(true)}
						onPause={() => i === activeRef.current && !cutRef.current && setPlaying(false)}
						// On Safari both stay drawn (it may not paint a hidden video), the one on screen on top.
						className="absolute inset-0 h-full w-full object-cover"
						style={{ zIndex: i === active ? 1 : 0, visibility: i === active || lead ? "visible" : "hidden" }}
					/>
				))}
				<div
					className="pointer-events-none absolute top-0 left-0"
					style={{ width: WIDTH, height: HEIGHT, transform: `scale(${scale})`, transformOrigin: "top left", zIndex: 2 }}
				>
					{(line || !playing) && (
						// Drag the subtitle up or down to move it. While paused with nothing being said,
						// a faded sample shows where subtitles will sit.
						<div
							onClick={(e) => e.stopPropagation()}
							onPointerDown={(e) => {
								e.stopPropagation();
								e.currentTarget.setPointerCapture(e.pointerId);
								dragRef.current = { y: e.clientY, position: subtitle.position };
							}}
							onPointerMove={(e) => {
								const drag = dragRef.current;
								const box = boxRef.current;
								if (!drag || !box) return;
								const { min, max } = LIMITS.position;
								const position = drag.position - (e.clientY - drag.y) / box.clientHeight;
								onSubtitleChange({ ...subtitle, position: Math.round(Math.min(max, Math.max(min, position)) * 1000) / 1000 });
							}}
							onPointerUp={() => (dragRef.current = null)}
							title="Drag to move the subtitles"
							style={{
								position: "absolute",
								left: SIDE_MARGIN,
								right: SIDE_MARGIN,
								bottom: HEIGHT * subtitle.position,
								textAlign: "center",
								fontFamily: kanit.style.fontFamily,
								fontWeight: 500,
								fontSize: subtitle.size,
								lineHeight: 1.25,
								color: "white",
								// The stroke is drawn half inside the letters; paint-order puts it behind them.
								WebkitTextStroke: subtitle.outline ? `${subtitle.outline * 2}px black` : undefined,
								paintOrder: "stroke fill",
								textShadow: "2px 2px 0 rgba(0,0,0,0.4)",
								opacity: line ? 1 : 0.5,
								cursor: "ns-resize",
								pointerEvents: "auto",
								touchAction: "none",
								userSelect: "none",
							}}
						>
							{line ? line.text : "Your subtitles"}
						</div>
					)}
					<div
						style={{
							position: "absolute",
							right: 48,
							bottom: 260,
							fontFamily: "sans-serif",
							fontWeight: 700,
							fontSize: 40,
							color: "rgba(255,255,255,0.7)",
							textShadow: "2px 2px 0 rgba(0,0,0,0.5)",
						}}
					>
						komoray.com
					</div>
				</div>
				{!playing && (
					<span className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center text-5xl text-white/90 drop-shadow">▶</span>
				)}
			</div>
			<div className="flex items-center gap-2 text-xs text-foreground/70">
				<button onClick={toggle} className="w-8 rounded border border-foreground/20 py-0.5" aria-label={playing ? "Pause" : "Play"}>
					{playing ? "❚❚" : "▶"}
				</button>
				<input
					type="range"
					min={0}
					max={total || 1}
					step={0.05}
					value={outTime}
					onChange={(e) => scrub(Number(e.target.value))}
					className="flex-1"
					aria-label="Position in the final video"
				/>
				<span className="tabular-nums">
					{clock(outTime)} / {clock(total)}
				</span>
			</div>
		</div>
	);
});
