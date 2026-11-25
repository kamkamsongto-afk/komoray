"use client";

import Image from "next/image";
import { type PointerEvent, type ReactNode, useEffect, useId, useState } from "react";
import { CutoutVideo, LoopVideo } from "@/components/HomeMedia";
import { FRAME_SHAPES, type FrameShape, framePoints, shapePolygon } from "@/lib/frame-me";
import { LAYOUT_KINDS, type LayoutKind } from "@/lib/layout";

// The small things people can try on the home page. Nothing here touches a real video.

// A number that goes up every `ms`, or stays still for people who asked for less motion.
function useTick(ms: number) {
	const [tick, setTick] = useState(0);
	useEffect(() => {
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const timer = setInterval(() => setTick((t) => t + 1), ms);
		return () => clearInterval(timer);
	}, [ms]);
	return tick;
}

type Kind = "word" | "filler" | "repeat" | "silence";
const SCRIPT: [string, Kind, number][] = [
	["Um,", "filler", 0.7], ["1.4s", "silence", 1.4],
	["I", "repeat", 0.15], ["want", "repeat", 0.2], ["to", "repeat", 0.1], ["show", "repeat", 0.25], ["you", "repeat", 0.2], ["0.9s", "silence", 0.9],
	["I", "word", 0.15], ["want", "word", 0.2], ["to", "word", 0.1], ["show", "word", 0.25], ["you", "word", 0.2], ["why", "word", 0.25], ["your", "word", 0.2], ["first", "word", 0.3], ["cut", "word", 0.3], ["should", "word", 0.25], ["not", "word", 0.25], ["take", "word", 0.25], ["all", "word", 0.2], ["evening.", "word", 0.55], ["2.1s", "silence", 2.1],
	["Let's", "word", 0.25], ["make", "word", 0.25], ["it.", "word", 0.4],
];
const AUTO_CUT = SCRIPT.flatMap(([, kind], i) => (kind === "word" ? [] : [i]));
const TOK_CLASS: Record<Kind, string> = { word: "", filler: "k-tok-filler", repeat: "k-tok-repeat", silence: "k-tok-sil" };
const SEG_CLASS: Record<Kind, string> = { word: "", filler: "k-seg-mark", repeat: "k-seg-mark", silence: "k-seg-sil" };

// Tap a word and it leaves the sample video. Plays by itself until someone touches it.
export function ScriptDemo() {
	const [cut, setCut] = useState<number[]>([]);
	const [touched, setTouched] = useState(false);
	const tick = useTick(3200);
	const shown = touched ? cut : tick % 2 ? AUTO_CUT : [];

	const set = (next: number[]) => {
		setCut(next);
		setTouched(true);
	};
	const toggle = (i: number) => set(shown.includes(i) ? shown.filter((n) => n !== i) : [...shown, i]);

	const total = SCRIPT.reduce((sum, [, , seconds]) => sum + seconds, 0);
	const kept = SCRIPT.reduce((sum, [, , seconds], i) => (shown.includes(i) ? sum : sum + seconds), 0);
	const caption = SCRIPT.filter(([, kind], i) => kind !== "silence" && !shown.includes(i)).map(([text]) => text).join(" ");

	return (
		<div className="k-demo">
			<div>
				<div className="k-script">
					{SCRIPT.map(([text, kind], i) => {
						const isCut = shown.includes(i);
						return (
							<button key={i} type="button" aria-pressed={isCut} onClick={() => toggle(i)} className={`k-tok ${TOK_CLASS[kind]} ${isCut ? "k-tok-cut" : ""}`}>
								{text}
							</button>
						);
					})}
				</div>
				<div className="k-controls">
					<button type="button" className="k-btn" onClick={() => set(AUTO_CUT)}>
						Find silences
					</button>
					<button type="button" className="k-btn" onClick={() => set([])}>
						Restore all
					</button>
				</div>
			</div>
			<div className="k-player">
				<div className="k-screen">
					<LoopVideo name="words" />
					<div className="k-caption">{caption}</div>
				</div>
				<div className="k-playerbar">
					<div className="k-time k-mono">
						<span>Length {kept.toFixed(1)}s</span>
						<span>Cut {(total - kept).toFixed(1)}s</span>
					</div>
					<div className="k-segs" aria-hidden>
						{SCRIPT.map(([, kind, seconds], i) => {
							const isCut = shown.includes(i);
							return <div key={i} className={`k-seg ${SEG_CLASS[kind]} ${isCut ? "k-seg-cut" : ""}`} style={{ flexGrow: isCut ? 0 : seconds * 10 }} />;
						})}
					</div>
				</div>
			</div>
		</div>
	);
}

const WORD_ROWS = [
	{ before: "Welcome back to ", wrong: "Como Ray", right: "Komoray", after: ".", video: "Video 1", at: 1 },
	{ before: "Today on ", wrong: "Como Ray", right: "Komoray", after: ", we test it.", video: "Video 2", at: 2 },
	{ before: "", wrong: "ผูหญิง", right: "ผู้หญิง", after: " เล่าเรื่องนี้", video: "Video 3", at: 3 },
];

export function WordsDemo() {
	const step = useTick(2200) % 4;
	return (
		<div className="k-rows">
			{WORD_ROWS.map((row) => {
				const fixed = step >= row.at;
				const label = !fixed ? "Draft" : row.at === 1 ? "Fixed by you" : "Remembered";
				return (
					<div key={row.video} className={`k-row ${fixed ? "k-row-on" : ""}`}>
						<div className="k-rowtext">
							{row.before}
							<span className={`k-hit ${fixed ? "k-hit-good" : "k-hit-bad"}`}>{fixed ? row.right : row.wrong}</span>
							{row.after}
						</div>
						<div className="k-mono">
							{row.video} · {label}
						</div>
					</div>
				);
			})}
		</div>
	);
}

function Chips<T extends string>({ options, value, onPick }: { options: [T, string][]; value: T; onPick: (value: T) => void }) {
	return (
		<div className="k-chips">
			{options.map(([id, name]) => (
				<button key={id} type="button" aria-pressed={value === id} onClick={() => onPick(id)} className={`k-chip ${value === id ? "k-chip-on" : ""}`}>
					{name}
				</button>
			))}
		</div>
	);
}

type Look = "clean" | "box" | "highlight" | "big" | "two";
const LOOKS: [Look, string][] = [["clean", "Clean"], ["box", "Box"], ["highlight", "Highlight"], ["big", "Big"], ["two", "Two lines"]];

export function LooksCard() {
	const [look, setLook] = useState<Look>("box");
	return (
		<article className="k-card">
			<div className="k-vis">
				<div className={`k-look k-look-${look}`}>
					<span>
						Say it <b>your</b>
						<br />
						way
					</span>
				</div>
			</div>
			<h3>Subtitles in your style</h3>
			<p>Five looks. What you preview is what you get.</p>
			<Chips options={LOOKS} value={look} onPick={setLook} />
		</article>
	);
}

type Pace = "tight" | "natural" | "relaxed";
const PACES: [Pace, string][] = [["tight", "Tight"], ["natural", "Natural"], ["relaxed", "Relaxed"]];
// Measured on one of our own test clips (PROGRESS.md, 31 Oct): 55.6 s raw.
const RAW_SECONDS = 55.6;
const PACE_SECONDS: Record<Pace, number> = { tight: 29.2, natural: 31.2, relaxed: 33.6 };

export function PaceCard() {
	const [pace, setPace] = useState<Pace>("natural");
	const seconds = PACE_SECONDS[pace];
	return (
		<article className="k-card">
			<div className="k-vis">
				<div className="k-pacebars">
					<div className="k-mono">Raw take {RAW_SECONDS}s</div>
					<div className="k-pacetrack">
						<div className="k-pacefill" style={{ width: "100%" }} />
					</div>
					<div className="k-mono">
						{PACES.find(([id]) => id === pace)?.[1]} {seconds.toFixed(1)}s
					</div>
					<div className="k-pacetrack">
						<div className="k-pacefill k-pacefill-on" style={{ width: `${(seconds / RAW_SECONDS) * 100}%` }} />
					</div>
				</div>
			</div>
			<h3>Your pace</h3>
			<p>Measured on one of our own test clips. Yours will differ.</p>
			<Chips options={PACES} value={pace} onPick={setPace} />
		</article>
	);
}

type Shape = "9:16" | "1:1" | "16:9";
const SHAPES: [Shape, string][] = [["9:16", "9:16"], ["1:1", "1:1"], ["16:9", "16:9"]];
// Real proportions on any screen: 16:9 follows the card's width (cqw) and its height follows that.
// The picture is wide, so each shape is cropped around the face the way a wide video really is
// (framePiece in lib/framing.ts). A tall picture can't fill 16:9: it showed only the eyes.
const WIDE = "min(100cqw, 320px)";
const SHAPE_SIZE: Record<Shape, [string, string]> = { "9:16": ["126px", "224px"], "1:1": ["210px", "210px"], "16:9": [WIDE, `calc(${WIDE} * 9 / 16)`] };

export function ShapeCard() {
	const [shape, setShape] = useState<Shape>("9:16");
	const [width, height] = SHAPE_SIZE[shape];
	return (
		<article className="k-card">
			<div className="k-vis k-vis-shape">
				<div className="k-shape" style={{ width, height }}>
					<LoopVideo name="frame" />
				</div>
			</div>
			<h3>Every shape</h3>
			<p>Vertical, square or wide, framed around your face.</p>
			<Chips options={SHAPES} value={shape} onPick={setShape} />
		</article>
	);
}

const HELLO: [string, string][] = [["en", "Hello"], ["th", "สวัสดี"], ["es", "Hola"], ["fr", "Bonjour"], ["de", "Hallo"], ["pt", "Olá"], ["it", "Ciao"]];

export function HelloWord() {
	const [code, word] = HELLO[useTick(1800) % HELLO.length];
	return (
		<div className="k-lang" lang={code}>
			{word}
		</div>
	);
}

// ---- Step out of the rectangle: Frame Me, Cutout, Layout (the shapes and names are the studio's own) ----

// A card that leans toward the mouse, for a little depth. Touch screens and reduced motion: it stays flat.
function TiltCard({ children }: { children: ReactNode }) {
	const move = (e: PointerEvent<HTMLElement>) => {
		if (e.pointerType !== "mouse") return;
		const box = e.currentTarget.getBoundingClientRect();
		e.currentTarget.style.setProperty("--tx", ((e.clientX - box.left) / box.width - 0.5).toFixed(3));
		e.currentTarget.style.setProperty("--ty", ((e.clientY - box.top) / box.height - 0.5).toFixed(3));
	};
	const leave = (e: PointerEvent<HTMLElement>) => {
		e.currentTarget.style.setProperty("--tx", "0");
		e.currentTarget.style.setProperty("--ty", "0");
	};
	return (
		<article className="k-card k-tilt" onPointerMove={move} onPointerLeave={leave}>
			{children}
		</article>
	);
}

// Plays through the choices by itself until someone picks one.
function useAuto<T>(options: T[], ms: number): [T, (value: T) => void] {
	const [picked, setPicked] = useState<T | null>(null);
	const tick = useTick(ms);
	return [picked ?? options[tick % options.length], setPicked];
}

const FRAME_DEMO: FrameShape[] = ["circle", "heart", "star", "rounded"];
const FRAME_CHIPS = FRAME_DEMO.map((id): [FrameShape, string] => [id, FRAME_SHAPES.find((s) => s.id === id)?.name ?? id]);

export function FrameCard() {
	const [shape, setShape] = useAuto(FRAME_DEMO, 2400);
	const clip = useId();
	const w = 100;
	const h = w * (FRAME_SHAPES.find((s) => s.id === shape)?.ratio ?? 1);
	const points = shapePolygon(shape, w, h);
	// The coach's clip inside the shape (20 Nov), its still picture blurred behind, as Frame Me's blur does.
	const shapeClip = `polygon(${framePoints(shape).map(([x, y]) => `${((x + 0.5) * 100).toFixed(2)}% ${((y + 0.5) * 100).toFixed(2)}%`).join(", ")})`;
	return (
		<TiltCard>
			<div className="k-vis">
				<div className="k-frame k-stage">
					<Image className="k-frameback" src="/landing/frame-poster.webp" alt="" width={480} height={854} unoptimized />
					<div className="k-frameme" style={{ aspectRatio: `${w} / ${h}` }}>
						<div className="k-frameclip" style={{ clipPath: shapeClip }}>
							<LoopVideo name="frame" />
						</div>
						<svg key={shape} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
							<polygon id={clip} points={points} fill="none" stroke="#B9F36A" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
						</svg>
					</div>
				</div>
			</div>
			<h3>Frame Me</h3>
			<p>Step into a circle, a heart, a star. Seven shapes, your color on the edge, a blur, a picture or a clip behind.</p>
			<Chips options={FRAME_CHIPS} value={shape} onPick={setShape} />
		</TiltCard>
	);
}

type Behind = "run" | "slam" | "heartbeat";
const BEHINDS: [Behind, string][] = [["run", "Run"], ["slam", "Drop and slam"], ["heartbeat", "Heartbeat"]];
const BEHIND_DEMO: Behind[] = ["run", "slam", "heartbeat"];

export function CutoutCard() {
	const [motion, setMotion] = useAuto(BEHIND_DEMO, 4200);
	return (
		<TiltCard>
			<div className="k-vis">
				<div className="k-frame k-stage">
					<Image src="/landing/cutout-bg.webp" alt="" width={720} height={1080} unoptimized />
					<div key={motion} className={`k-behind k-behind-${motion}`} aria-hidden>
						{motion === "run" ? "NEW DROP · NEW DROP · NEW DROP · " : "WOW"}
					</div>
					<CutoutVideo className="k-cutme" />
				</div>
			</div>
			<h3>Cutout</h3>
			<p>Words, a picture or a clip that sit behind you. No green screen.</p>
			<Chips options={BEHINDS} value={motion} onPick={setMotion} />
		</TiltCard>
	);
}

const LAYOUT_CHIPS = LAYOUT_KINDS.map((k): [LayoutKind, string] => [k.id, k.name]);
const LAYOUT_DEMO: LayoutKind[] = ["stack", "side"];

export function LayoutCard() {
	const [kind, setKind] = useAuto(LAYOUT_DEMO, 6400);
	// Split for most of each turn, whole again for a moment, so the slide shows both ways.
	const split = useTick(1600) % 4 !== 3;
	return (
		<TiltCard>
			<div className="k-vis">
				<div className={`k-frame k-stage k-layout k-layout-${kind} ${split ? "k-layout-on" : ""}`}>
					<div className="k-layme">
						<LoopVideo name="layout" />
					</div>
					<div className="k-layother">
						<LoopVideo name="zoo" />
					</div>
				</div>
			</div>
			<h3>Layout</h3>
			<p>Split the screen with a picture or a clip. It slides in, flashes in, or cuts.</p>
			<Chips options={LAYOUT_CHIPS} value={kind} onPick={setKind} />
		</TiltCard>
	);
}
