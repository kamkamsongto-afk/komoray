"use client";

import { Anton, Bebas_Neue, Chakra_Petch, Kanit, Mitr, Poppins, Prompt, Sarabun } from "next/font/google";
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { BANNER, BANNER_TOP, type Banner, bannerInk, bannerOpacity, cleanBannerText } from "@/lib/banners";
import type { OwnFont } from "@/lib/font-info";
import { type FontId, fontMetrics, LIMITS, outputSize, type SubtitleStyle } from "@/lib/subtitle-style";
import { FPS, type Line, ZOOM_ORIGIN } from "@/lib/timeline";

// Same fonts and weights as the final video (FONTS in modal_app/render.py), side margins 80px.
const kanit = Kanit({ weight: "500", subsets: ["thai", "latin"] });
const prompt = Prompt({ weight: "500", subsets: ["thai", "latin"] });
const mitr = Mitr({ weight: "500", subsets: ["thai", "latin"] });
const sarabun = Sarabun({ weight: "600", subsets: ["thai", "latin"] });
const chakra = Chakra_Petch({ weight: "600", subsets: ["thai", "latin"] });
const poppins = Poppins({ weight: "600", subsets: ["latin"] });
const anton = Anton({ weight: "400", subsets: ["latin"] });
const bebas = Bebas_Neue({ weight: "400", subsets: ["latin"] });
const FONT_FACES: Record<FontId, { family: string; weight: number }> = {
	kanit: { family: kanit.style.fontFamily, weight: 500 },
	prompt: { family: prompt.style.fontFamily, weight: 500 },
	mitr: { family: mitr.style.fontFamily, weight: 500 },
	sarabun: { family: sarabun.style.fontFamily, weight: 600 },
	chakra: { family: chakra.style.fontFamily, weight: 600 },
	poppins: { family: poppins.style.fontFamily, weight: 600 },
	anton: { family: anton.style.fontFamily, weight: 400 },
	bebas: { family: bebas.style.fontFamily, weight: 400 },
};
// The user's own font: loaded once per upload (version) from /api/font, under its own name.
const ownFamily = (version: number) => `komoray-own-${version}`;
const ownLoaded = new Set<number>();
function useOwnFont(font: OwnFont | undefined) {
	const [, setReady] = useState(0);
	useEffect(() => {
		if (!font || ownLoaded.has(font.version) || typeof FontFace === "undefined") return;
		ownLoaded.add(font.version);
		const face = new FontFace(ownFamily(font.version), `url(/api/font?file=1&v=${font.version})`);
		face
			.load()
			.then((loaded) => {
				document.fonts.add(loaded);
				setReady((n) => n + 1);
			})
			.catch(() => ownLoaded.delete(font.version));
	}, [font]);
}

const SIDE_MARGIN = 80;
const WATERMARK_BOTTOM = 0.135; // the watermark's gap to the bottom edge, share of the height (render.py)
const BOX_PADDING = 20; // the Box look: space around the letters (Outline of the box in render.py)
// The channel name in a corner (the Logo style in render.py).
const LOGO = { size: 52, outline: 4, side: 60, top: 110 };

// A black outline with round corners, like the final video's (a text stroke gives sharp spikes at
// thick sizes): copies of the letters shifted in a circle, plus the soft shadow under them.
function roundOutline(width: number) {
	const shadows: string[] = [];
	for (const r of width > 2 ? [width, width / 2] : width ? [width] : []) {
		const steps = Math.max(8, Math.ceil((2 * Math.PI * r) / 3));
		for (let i = 0; i < steps; i++) {
			const a = (2 * Math.PI * i) / steps;
			shadows.push(`${(r * Math.cos(a)).toFixed(1)}px ${(r * Math.sin(a)).toFixed(1)}px 0 black`);
		}
	}
	shadows.push("2px 2px 0 rgba(0,0,0,0.4)");
	return shadows.join(",");
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

type Props = {
	children: ReactNode; // the picture: <video> elements or a <canvas>, filling the 9:16 box
	playing: boolean;
	outTime: number; // seconds into the final video
	total: number;
	line: Line | null; // the subtitle being said now
	subtitle: SubtitleStyle;
	onSubtitleChange: (style: SubtitleStyle) => void;
	onToggle: () => void;
	onScrub: (outSeconds: number) => void;
	debugCount: number | null; // debug mode: events recorded so far
	busy?: boolean; // waiting for the picture or sound to load
	bare?: boolean; // a still sample (Brand Kit page): no play button or time bar
	zoom?: number; // Auto zoom for pictures that don't zoom themselves (the <video> player)
	banners?: Banner[];
};

// Everything around the picture that both preview players share: the 9:16 box, the subtitle
// (drawn at full 1080x1920 and shrunk, so sizes match the final video; drag it to move it),
// the watermark, the play button and the time bar.
export function PlayerFrame({
	children,
	playing,
	outTime,
	total,
	line,
	subtitle,
	onSubtitleChange,
	onToggle,
	onScrub,
	debugCount,
	busy,
	bare,
	zoom = 1,
	banners = [],
}: Props) {
	const boxRef = useRef<HTMLDivElement>(null);
	const [boxWidth, setBoxWidth] = useState(324);
	const dragRef = useRef<{ y: number; position: number } | null>(null);
	// The final video's size (9:16, 1:1 or 16:9); everything on it is laid out at full size and shrunk.
	const { width: W, height: H } = outputSize(subtitle);
	const scale = boxWidth / W;

	useEffect(() => {
		const box = boxRef.current;
		if (!box) return;
		const observer = new ResizeObserver(() => setBoxWidth(box.clientWidth));
		observer.observe(box);
		return () => observer.disconnect();
	}, []);

	useOwnFont(subtitle.font === "own" ? subtitle.ownFont : undefined);
	const face =
		subtitle.font === "own" && subtitle.ownFont
			? { family: `"${ownFamily(subtitle.ownFont.version)}", ${kanit.style.fontFamily}`, weight: 400 }
			: (FONT_FACES[subtitle.font as FontId] ?? FONT_FACES.kanit);
	// Letters as big as the final video draws them (see FONTS[].height), rows as far apart.
	const em = fontMetrics(subtitle).height;
	const boxed = subtitle.look === "box";
	// Box: letters on a dark box. Every other look: white letters with a black outline.
	const letters: CSSProperties = boxed
		? { background: "rgba(0,0,0,0.75)", padding: `${BOX_PADDING / 2}px ${BOX_PADDING}px`, boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }
		: { textShadow: roundOutline(subtitle.outline) };
	// Highlight: the word being said is in the brand colour until the next one starts.
	const frame = outTime * FPS;
	const said = line && subtitle.look === "highlight" ? line.parts.findLastIndex((p) => p.from <= frame) : -1;
	const text = line
		? line.parts.map((p, k) => (
				<span key={k}>
					{k === line.row2 && <br />}
					<span style={k === said ? { color: subtitle.color } : undefined}>{p.text}</span>
				</span>
			))
		: "Your subtitles";

	return (
		// As wide as fits, but never taller than ~70% of the screen.
		<div className="mx-auto flex w-full flex-col gap-2" style={{ maxWidth: `calc(70vh * ${W} / ${H})` }}>
			<div
				ref={boxRef}
				onClick={onToggle}
				className="relative w-full cursor-pointer overflow-hidden rounded-lg bg-black"
				style={{ aspectRatio: `${W} / ${H}` }}
			>
				<div
					className="absolute inset-0"
					style={zoom !== 1 ? { transform: `scale(${zoom})`, transformOrigin: `${ZOOM_ORIGIN.x * 100}% ${ZOOM_ORIGIN.y * 100}%` } : undefined}
				>
					{children}
				</div>
				<div
					className="pointer-events-none absolute top-0 left-0"
					style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: "top left", zIndex: 2 }}
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
								bottom: H * subtitle.position,
								textAlign: "center",
								fontFamily: face.family,
								fontWeight: face.weight,
								fontSize: subtitle.size / em,
								lineHeight: em,
								color: "white",
								opacity: line ? 1 : 0.5,
								cursor: "ns-resize",
								pointerEvents: "auto",
								touchAction: "none",
								userSelect: "none",
							}}
						>
							<span style={letters}>{text}</span>
						</div>
					)}
					{banners.map((b) => {
						const opacity = bannerOpacity(b, outTime);
						if (!opacity) return null;
						const box: CSSProperties = {
							background: subtitle.color,
							padding: `${BANNER.padding / 2}px ${BANNER.padding}px`,
							boxDecorationBreak: "clone",
							WebkitBoxDecorationBreak: "clone",
						};
						return (
							<div
								key={b.id}
								style={{
									position: "absolute",
									top: Math.round(BANNER_TOP[subtitle.format][b.place] * H),
									left: SIDE_MARGIN,
									right: SIDE_MARGIN,
									textAlign: "center",
									fontFamily: face.family,
									fontWeight: face.weight,
									fontSize: BANNER.size / em,
									lineHeight: em,
									color: bannerInk(subtitle.color),
									opacity,
								}}
							>
								<span style={box}>{cleanBannerText(b.text)}</span>
								{cleanBannerText(b.sub) && (
									<>
										<br />
										<span style={{ ...box, fontSize: BANNER.subSize / em }}>{cleanBannerText(b.sub)}</span>
									</>
								)}
							</div>
						);
					})}
					{subtitle.logo && (
						<div
							style={{
								position: "absolute",
								top: LOGO.top,
								[subtitle.logoAt === "top-right" ? "right" : "left"]: LOGO.side,
								fontFamily: face.family,
								fontWeight: face.weight,
								fontSize: LOGO.size / em,
								lineHeight: em,
								color: "white",
								WebkitTextStroke: `${LOGO.outline * 2}px black`,
								paintOrder: "stroke fill",
								whiteSpace: "nowrap",
							}}
						>
							{subtitle.logo}
						</div>
					)}
					<div
						style={{
							position: "absolute",
							right: 48,
							bottom: Math.round(H * WATERMARK_BOTTOM),
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
					!playing &&
					!bare && (
						<span className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center text-5xl text-white/90 drop-shadow">▶</span>
					)
				)}
			</div>
			<div className={`flex items-center gap-2 text-xs text-foreground/70 ${bare ? "hidden" : ""}`}>
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
