"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

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
					<Image src="/landing/kitchen.webp" alt="" width={448} height={896} unoptimized />
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
					<Image src="/landing/mountain-wide.webp" alt="" width={870} height={490} unoptimized />
				</div>
			</div>
			<h3>Every shape</h3>
			<p>Vertical, square or wide, framed around your face.</p>
			<Chips options={SHAPES} value={shape} onPick={setShape} />
		</article>
	);
}

const HELLO: [string, string][] = [["en", "Hello"], ["th", "สวัสดี"], ["es", "Hola"], ["fr", "Bonjour"], ["de", "Hallo"], ["pt", "Olá"], ["ja", "こんにちは"]];

export function HelloWord() {
	const [code, word] = HELLO[useTick(1800) % HELLO.length];
	return (
		<div className="k-lang" lang={code}>
			{word}
		</div>
	);
}
