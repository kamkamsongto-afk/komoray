"use client";

import { Kanit } from "next/font/google";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { LIMITS, type SubtitleStyle } from "@/lib/subtitle-style";
import { HEIGHT, WIDTH } from "@/lib/timeline";

// Same look as the final video (Kanit Medium, side margins 80px in modal_app/render.py).
const kanit = Kanit({ weight: "500", subsets: ["thai", "latin"] });
const SIDE_MARGIN = 80;

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

type Props = {
	children: ReactNode; // the picture: <video> elements or a <canvas>, filling the 9:16 box
	playing: boolean;
	outTime: number; // seconds into the final video
	total: number;
	line: string | null; // the subtitle being said now
	subtitle: SubtitleStyle;
	onSubtitleChange: (style: SubtitleStyle) => void;
	onToggle: () => void;
	onScrub: (outSeconds: number) => void;
	debugCount: number | null; // debug mode: events recorded so far
	busy?: boolean; // waiting for the picture or sound to load
};

// Everything around the picture that both preview players share: the 9:16 box, the subtitle
// (drawn at full 1080x1920 and shrunk, so sizes match the final video; drag it to move it),
// the watermark, the play button and the time bar.
export function PlayerFrame({ children, playing, outTime, total, line, subtitle, onSubtitleChange, onToggle, onScrub, debugCount, busy }: Props) {
	const boxRef = useRef<HTMLDivElement>(null);
	const [scale, setScale] = useState(0.3);
	const dragRef = useRef<{ y: number; position: number } | null>(null);

	useEffect(() => {
		const box = boxRef.current;
		if (!box) return;
		const observer = new ResizeObserver(() => setScale(box.clientWidth / WIDTH));
		observer.observe(box);
		return () => observer.disconnect();
	}, []);

	return (
		// As wide as fits, but never taller than ~70% of the screen.
		<div className="mx-auto flex w-full flex-col gap-2" style={{ maxWidth: "calc(70vh * 9 / 16)" }}>
			<div
				ref={boxRef}
				onClick={onToggle}
				className="relative w-full cursor-pointer overflow-hidden rounded-lg bg-black"
				style={{ aspectRatio: `${WIDTH} / ${HEIGHT}` }}
			>
				{children}
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
							{line ?? "Your subtitles"}
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
				{debugCount !== null && (
					<span className="pointer-events-none absolute top-2 left-2 z-[2] rounded bg-red-600 px-2 py-0.5 text-xs text-white">
						Recording · {debugCount}
					</span>
				)}
				{busy ? (
					<span className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center">
						<span className="h-10 w-10 animate-spin rounded-full border-4 border-white/30 border-t-white" />
					</span>
				) : (
					!playing && (
						<span className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center text-5xl text-white/90 drop-shadow">▶</span>
					)
				)}
			</div>
			<div className="flex items-center gap-2 text-xs text-foreground/70">
				<button onClick={onToggle} className="w-8 rounded border border-foreground/20 py-0.5" aria-label={playing ? "Pause" : "Play"}>
					{playing ? "❚❚" : "▶"}
				</button>
				<input
					type="range"
					min={0}
					max={total || 1}
					step={0.05}
					value={outTime}
					onChange={(e) => onScrub(Number(e.target.value))}
					className="flex-1"
					aria-label="Position in the final video"
				/>
				<span className="tabular-nums">
					{clock(outTime)} / {clock(total)}
				</span>
			</div>
		</div>
	);
}
