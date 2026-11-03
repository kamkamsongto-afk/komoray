"use client";

import { Pause, Play } from "lucide-react";
import { Anton, Bebas_Neue, Chakra_Petch, Fira_Sans, Kanit, Mitr, Poppins, Prompt, Sarabun } from "next/font/google";
import { type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { BANNER, BANNER_SCALE, BANNER_TOP, type Banner, bannerInk, bannerMotion, cleanBannerText } from "@/lib/banners";
import type { OwnFont } from "@/lib/font-info";
import { CYRILLIC_FONT, type FontId, fontMetrics, hasCyrillic, LIMITS, outputSize, type SubtitleStyle } from "@/lib/subtitle-style";
import { motionScale } from "@/lib/motion";
import { FPS, type Line, ZOOM_ORIGIN } from "@/lib/timeline";

// Same fonts and weights as the final video (FONTS in modal_app/render.py), side margins 80px.
// latin-ext: the letters of Polish, Norwegian and the like. Only downloaded when a page uses them.
const kanit = Kanit({ weight: "500", subsets: ["thai", "latin", "latin-ext"] });
const prompt = Prompt({ weight: "500", subsets: ["thai", "latin", "latin-ext"] });
const mitr = Mitr({ weight: "500", subsets: ["thai", "latin", "latin-ext"] });
const sarabun = Sarabun({ weight: "600", subsets: ["thai", "latin", "latin-ext"] });
const chakra = Chakra_Petch({ weight: "600", subsets: ["thai", "latin", "latin-ext"] });
const poppins = Poppins({ weight: "600", subsets: ["latin", "latin-ext"] });
const anton = Anton({ weight: "400", subsets: ["latin", "latin-ext"] });
const bebas = Bebas_Neue({ weight: "400", subsets: ["latin", "latin-ext"] });
const fira = Fira_Sans({ weight: "500", subsets: ["cyrillic", "latin", "latin-ext"] }); // for Russian and the like (CYRILLIC_FONT)
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
const BOX_PADDING = 20; // the Box look: space around the letters (Outline of the box in render.py)
// The channel name in a corner (the Logo style in render.py).
const LOGO = { size: 52, outline: 4, side: 60, top: 110 };

// A black outline with round corners, like the final video's (a text stroke gives sharp spikes at
// thick sizes): copies of the letters shifted in a circle, plus the soft shadow under them.
function roundOutline(width: number, colour: string) {
	const shadows: string[] = [];
	for (const r of width > 2 ? [width, width / 2] : width ? [width] : []) {
		const steps = Math.max(8, Math.ceil((2 * Math.PI * r) / 3));
		for (let i = 0; i < steps; i++) {
			const a = (2 * Math.PI * i) / steps;
			shadows.push(`${(r * Math.cos(a)).toFixed(1)}px ${(r * Math.sin(a)).toFixed(1)}px 0 ${colour}`);
		}
	}
	shadows.push("2px 2px 0 rgba(0,0,0,0.4)");
	return shadows.join(",");
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const solid = (opacity: number) => Math.round(opacity * 255).toString(16).padStart(2, "0"); // as the end of a #RRGGBBAA colour
const SPEEDS = [1, 1.25, 1.5, 2]; // for skimming while fixing words; the final video is not affected

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
	onBannersChange?: (banners: Banner[]) => void; // dragged or resized on the video (while paused)
	speed?: number;
	onSpeedChange?: (speed: number) => void; // left out: this player can't change speed
};

// Everything around the picture that both preview players share: the 9:16 box, the subtitle
// (drawn at full 1080x1920 and shrunk, so sizes match the final video; drag it to move it),
// the play button and the time bar.
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
	onBannersChange,
	speed = 1,
	onSpeedChange,
}: Props) {
	const boxRef = useRef<HTMLDivElement>(null);

	// Move a banner (its middle follows the pointer) or resize it (by how far the pointer is from its
	// middle, compared with where the drag started). Changes are sent while dragging.
	function startBannerDrag(e: ReactPointerEvent<HTMLElement>, banner: Banner, mode: "move" | "size") {
		const box = boxRef.current;
		const target = (mode === "size" ? e.currentTarget.parentElement : e.currentTarget) as HTMLElement | null;
		if (!box || !target || !onBannersChange) return;
		e.stopPropagation();
		e.preventDefault();
		const frame = box.getBoundingClientRect();
		const rect = target.getBoundingClientRect();
		const middle = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
		const from = { x: (middle.x - frame.left) / frame.width, y: (middle.y - frame.top) / frame.height };
		const start = { x: e.clientX, y: e.clientY, reach: Math.max(8, Math.hypot(e.clientX - middle.x, e.clientY - middle.y)) };
		const scale0 = banner.scale ?? 1;
		const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
		const move = (ev: globalThis.PointerEvent) => {
			const patch =
				mode === "move"
					? {
							x: Math.round(clamp(from.x + (ev.clientX - start.x) / frame.width, 0.05, 0.95) * 1000) / 1000,
							y: Math.round(clamp(from.y + (ev.clientY - start.y) / frame.height, 0.03, 0.97) * 1000) / 1000,
						}
					: {
							x: banner.x ?? Math.round(from.x * 1000) / 1000,
							y: banner.y ?? Math.round(from.y * 1000) / 1000,
							scale:
								Math.round(clamp((scale0 * Math.hypot(ev.clientX - middle.x, ev.clientY - middle.y)) / start.reach, BANNER_SCALE.min, BANNER_SCALE.max) * 100) /
								100,
						};
			bannersRef.current = bannersRef.current.map((b) => (b.id === banner.id ? { ...b, ...patch } : b));
			onBannersChange(bannersRef.current);
		};
		const stop = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", stop);
			window.removeEventListener("pointercancel", stop);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", stop);
		window.addEventListener("pointercancel", stop);
	}
	const bannersRef = useRef(banners);
	useEffect(() => {
		bannersRef.current = banners;
	}, [banners]);
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
	const ownEm = fontMetrics(subtitle).height;
	// Text in Russian and the like uses a font that has its letters, as the final video does (font_tag in render.py).
	const textFace = (value: string) =>
		subtitle.font !== "own" && hasCyrillic(value)
			? { family: fira.style.fontFamily, weight: 500, em: CYRILLIC_FONT.height }
			: { ...face, em: ownEm };
	const lineFace = textFace(line?.text ?? "");
	const em = lineFace.em;
	const rowGap = line?.row2 !== undefined ? subtitle.lineSpacing : 0; // only a line split in two rows has a gap
	const boxed = subtitle.look === "box";
	// Box: letters on a box. Every other look: letters with an outline.
	const letters: CSSProperties = boxed
		? { background: `${subtitle.boxColor}${solid(subtitle.boxOpacity)}`, borderRadius: subtitle.boxRadius, padding: `${BOX_PADDING / 2}px ${BOX_PADDING}px`, boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }
		: { textShadow: roundOutline(subtitle.outline, subtitle.outlineColor) };
	// Highlight: the word being said is in the brand colour until the next one starts.
	const frame = outTime * FPS;
	const now = line ? line.parts.findLastIndex((p) => p.from <= frame) : -1;
	const said = subtitle.look === "highlight" ? now : -1;
	// Motion (lib/motion.ts): the line pops in, a word jumps out. Drawn bigger (not stretched) so the
	// words around it make room, as they do in the final video.
	const motion = line
		? motionScale(
				subtitle.motion,
				FPS,
				frame - line.from,
				line.parts.map((p) => p.from - line.from),
			)
		: { line: 1, word: 1, bounced: -1 };
	const text = line
		? line.parts.map((p, k) => (
				<span key={k}>
					{k === line.row2 && <br />}
					<span
						style={
							k === said || k === motion.bounced
								? { color: k === said ? subtitle.color : undefined, fontSize: k === motion.bounced ? `${motion.word}em` : undefined }
								: undefined
						}
					>
						{p.text}
					</span>
				</span>
			))
		: "Your subtitles";

	return (
		// As wide as fits, but never taller than --player-h (ScriptView keeps it clear of the timeline), else ~70% of the screen.
		<div className="mx-auto flex w-full flex-col gap-2" style={{ maxWidth: `calc(var(--player-h, 70vh) * ${W} / ${H})` }}>
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
								// The extra row gap goes half under the last row in a browser: the bottom row stays put, as in the final video.
								bottom: H * subtitle.position - rowGap / 2,
								textAlign: "center",
								fontFamily: lineFace.family,
								fontWeight: lineFace.weight,
								fontSize: (subtitle.size / em) * motion.line,
								lineHeight: em * (1 + rowGap / subtitle.size),
								letterSpacing: subtitle.letterSpacing,
								color: subtitle.textColor,
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
						const move = bannerMotion(b, outTime);
						const opacity = move.opacity;
						if (!opacity) return null;
						const size = b.scale ?? 1;
						const bannerFace = textFace(`${b.text} ${b.sub}`);
						const box: CSSProperties = {
							background: `${b.color ?? subtitle.color}${solid(b.opacity ?? 1)}`,
							borderRadius: (b.radius ?? 0) * size,
							padding: `${(BANNER.padding / 2) * size}px ${BANNER.padding * size}px`,
							boxDecorationBreak: "clone",
							WebkitBoxDecorationBreak: "clone",
						};
						const movable = Boolean(onBannersChange) && !playing;
						// Dragged somewhere: its middle sits there. Else the top of its place (top, middle, bottom).
						const spot: CSSProperties =
							b.x !== undefined && b.y !== undefined
								? { left: b.x * W, top: b.y * H, width: W - 2 * SIDE_MARGIN, transform: "translate(-50%, -50%)" }
								: { left: SIDE_MARGIN, right: SIDE_MARGIN, top: Math.round(BANNER_TOP[subtitle.format][b.place] * H) };
						return (
							<div
								key={b.id}
								style={{
									position: "absolute",
									...spot,
									textAlign: "center",
									fontFamily: bannerFace.family,
									fontWeight: bannerFace.weight,
									fontSize: (BANNER.size / bannerFace.em) * size,
									lineHeight: bannerFace.em,
									color: b.ink ?? bannerInk(b.color ?? subtitle.color),
									opacity,
								}}
							>
								<span
									className="relative inline-block"
									onClick={(e) => movable && e.stopPropagation()}
									onPointerDown={(e) => movable && startBannerDrag(e, b, "move")}
									style={{
										transform: `translate(${move.x}px, ${move.y}px) scale(${move.scale})`,
										...(movable && { pointerEvents: "auto", cursor: "move", touchAction: "none", outline: "4px dashed rgba(255,255,255,0.8)", outlineOffset: 8 }),
									}}
									title={movable ? "Drag to move. Drag the corner to make it bigger or smaller." : undefined}
								>
									<span style={box}>{cleanBannerText(b.text)}</span>
									{cleanBannerText(b.sub) && (
										<>
											<br />
											<span style={{ ...box, fontSize: (BANNER.subSize / bannerFace.em) * size }}>{cleanBannerText(b.sub)}</span>
										</>
									)}
									{movable && (
										<span
											onPointerDown={(e) => startBannerDrag(e, b, "size")}
											className="absolute rounded-full border-4 border-black bg-white"
											style={{ width: 44, height: 44, right: -30, bottom: -30, cursor: "nwse-resize" }}
										/>
									)}
								</span>
							</div>
						);
					})}
					{subtitle.logoImage ? (
						// The logo picture, logoSize px wide, in its corner (the overlay in render.py).
						// eslint-disable-next-line @next/next/no-img-element
						<img
							src={`/api/logo?v=${subtitle.logoImage.version}`}
							alt=""
							style={{
								position: "absolute",
								[subtitle.logoAt.startsWith("bottom") ? "bottom" : "top"]: LOGO.top,
								[subtitle.logoAt.endsWith("right") ? "right" : "left"]: LOGO.side,
								width: subtitle.logoSize,
								height: "auto",
								opacity: subtitle.logoOpacity,
							}}
						/>
					) : subtitle.logo && (
						<div
							style={{
								position: "absolute",
								[subtitle.logoAt.startsWith("bottom") ? "bottom" : "top"]: LOGO.top,
								[subtitle.logoAt.endsWith("right") ? "right" : "left"]: LOGO.side,
								fontFamily: textFace(subtitle.logo).family,
								fontWeight: textFace(subtitle.logo).weight,
								fontSize: LOGO.size / textFace(subtitle.logo).em,
								lineHeight: textFace(subtitle.logo).em,
								color: "white",
								WebkitTextStroke: `${LOGO.outline * 2}px black`,
								paintOrder: "stroke fill",
								whiteSpace: "nowrap",
							}}
						>
							{subtitle.logo}
						</div>
					)}
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
						<span className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center text-white/90 drop-shadow">
							<Play className="h-12 w-12 fill-current" aria-hidden />
						</span>
					)
				)}
			</div>
			<div className={`flex items-center gap-2 text-xs text-foreground/70 ${bare ? "hidden" : ""}`}>
				<button onClick={onToggle} className="flex w-8 justify-center rounded border border-foreground/20 py-1 hover:bg-foreground/5" aria-label={playing ? "Pause" : "Play"}>
					{playing ? <Pause className="h-3 w-3 fill-current" aria-hidden /> : <Play className="h-3 w-3 fill-current" aria-hidden />}
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
				<span className="whitespace-nowrap tabular-nums">
					{clock(outTime)} / {clock(total)}
				</span>
				{onSpeedChange && (
					<select
						value={speed}
						onChange={(e) => onSpeedChange(Number(e.target.value))}
						aria-label="Preview speed"
						title="Preview speed. The final video is not affected."
						className="rounded border border-foreground/20 bg-background py-0.5 text-foreground"
					>
						{SPEEDS.map((s) => (
							<option key={s} value={s}>
								{s}x
							</option>
						))}
					</select>
				)}
			</div>
		</div>
	);
}
