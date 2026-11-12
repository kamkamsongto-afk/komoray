"use client";

import { Pause, Play } from "lucide-react";
import { Anton, Bebas_Neue, Chakra_Petch, Fira_Sans, Kanit, Mitr, Poppins, Prompt, Sarabun, Itim, Sriracha, Pattaya, Chonburi, Charm, Mali, Bai_Jamjuree, K2D, Krub, Kodchasan, Trirong, Maitree, Bangers, Pacifico, Lobster, Abril_Fatface, Alfa_Slab_One, Righteous, Archivo_Black, Titan_One } from "next/font/google";
import { type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { BANNER, BANNER_FILE, BANNER_SCALE, BANNER_TOP, type Banner, bannerFileSrc, bannerInk, bannerMotion, bannerRows } from "@/lib/banners";
import { behindMotion, type CutoutLayers, INSERT, type Insert, insertShown, picMoved, picturePlace, pictureZoom, runText, speakerTransform } from "@/lib/behind";
import { clipGain } from "@/lib/clip-sound";
import type { OwnFont } from "@/lib/font-info";
import { CYRILLIC_FONT, FONTS, type FontId, fontMetrics, hasCyrillic, LIMITS, outputSize, type SubtitleStyle } from "@/lib/subtitle-style";
import { BOUNCE_WORD_GAP, motionScale } from "@/lib/motion";
import { FPS, type Line, setSpot, ZOOM_ORIGIN } from "@/lib/timeline";

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
// Downloaded only when picked: 20 fonts on every page that has a player would be slow.
const itim = Itim({ weight: "400", subsets: ["thai", "latin", "latin-ext"], preload: false });
const sriracha = Sriracha({ weight: "400", subsets: ["thai", "latin", "latin-ext"], preload: false });
const pattaya = Pattaya({ weight: "400", subsets: ["thai", "latin", "latin-ext"], preload: false });
const chonburi = Chonburi({ weight: "400", subsets: ["thai", "latin", "latin-ext"], preload: false });
const charm = Charm({ weight: "700", subsets: ["thai", "latin", "latin-ext"], preload: false });
const mali = Mali({ weight: "600", subsets: ["thai", "latin", "latin-ext"], preload: false });
const baijam = Bai_Jamjuree({ weight: "600", subsets: ["thai", "latin", "latin-ext"], preload: false });
const k2d = K2D({ weight: "600", subsets: ["thai", "latin", "latin-ext"], preload: false });
const krub = Krub({ weight: "600", subsets: ["thai", "latin", "latin-ext"], preload: false });
const kodchasan = Kodchasan({ weight: "600", subsets: ["thai", "latin", "latin-ext"], preload: false });
const trirong = Trirong({ weight: "600", subsets: ["thai", "latin", "latin-ext"], preload: false });
const maitree = Maitree({ weight: "600", subsets: ["thai", "latin", "latin-ext"], preload: false });
const bangers = Bangers({ weight: "400", subsets: ["latin", "latin-ext"], preload: false });
const pacifico = Pacifico({ weight: "400", subsets: ["latin", "latin-ext"], preload: false });
const lobster = Lobster({ weight: "400", subsets: ["latin", "latin-ext"], preload: false });
const abril = Abril_Fatface({ weight: "400", subsets: ["latin", "latin-ext"], preload: false });
const alfaslab = Alfa_Slab_One({ weight: "400", subsets: ["latin", "latin-ext"], preload: false });
const righteous = Righteous({ weight: "400", subsets: ["latin", "latin-ext"], preload: false });
const archivo = Archivo_Black({ weight: "400", subsets: ["latin", "latin-ext"], preload: false });
const titan = Titan_One({ weight: "400", subsets: ["latin", "latin-ext"], preload: false });
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
	itim: { family: itim.style.fontFamily, weight: 400 },
	sriracha: { family: sriracha.style.fontFamily, weight: 400 },
	pattaya: { family: pattaya.style.fontFamily, weight: 400 },
	chonburi: { family: chonburi.style.fontFamily, weight: 400 },
	charm: { family: charm.style.fontFamily, weight: 700 },
	mali: { family: mali.style.fontFamily, weight: 600 },
	baijam: { family: baijam.style.fontFamily, weight: 600 },
	k2d: { family: k2d.style.fontFamily, weight: 600 },
	krub: { family: krub.style.fontFamily, weight: 600 },
	kodchasan: { family: kodchasan.style.fontFamily, weight: 600 },
	trirong: { family: trirong.style.fontFamily, weight: 600 },
	maitree: { family: maitree.style.fontFamily, weight: 600 },
	bangers: { family: bangers.style.fontFamily, weight: 400 },
	pacifico: { family: pacifico.style.fontFamily, weight: 400 },
	lobster: { family: lobster.style.fontFamily, weight: 400 },
	abril: { family: abril.style.fontFamily, weight: 400 },
	alfaslab: { family: alfaslab.style.fontFamily, weight: 400 },
	righteous: { family: righteous.style.fontFamily, weight: 400 },
	archivo: { family: archivo.style.fontFamily, weight: 400 },
	titan: { family: titan.style.fontFamily, weight: 400 },
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
const LOGO = { size: 52, outline: 4, side: 40, top: 40 }; // the same small gap from both edges of a corner (coach, 10 Nov). Same in render.py

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
	// Cutout (lib/behind.ts): text behind the speaker, pictures and clips behind a smaller speaker.
	// person: the canvas the cut-out speaker is drawn on; files: a link to each inserted picture or clip.
	// onInsert: the speaker dragged or resized on the video, while paused.
	cutout?: { layers: CutoutLayers; files: Record<string, string>; person: ReactNode; onInsert?: (id: string, patch: Partial<Insert>) => void };
};

// An inserted clip, kept at the final video's time: it plays with the preview, and jumps when it is far off.
// volume / length: its own sound, faded at the edges of the time it shows (clipGain, same as mix_clip_sounds in render.py).
function InsertClip({ src, at, playing, style, onRatio, volume, length }: { src: string; at: number; playing: boolean; style: CSSProperties; onRatio: (ratio: number) => void; volume?: number; length: number }) {
	const ref = useRef<HTMLVideoElement>(null);
	useEffect(() => {
		const video = ref.current;
		if (!video) return;
		const want = Math.min(at, Math.max(0, (video.duration || at + 1) - 0.05)); // past its end: its last picture
		if (Math.abs(video.currentTime - want) > 0.25) video.currentTime = want;
		const gain = clipGain(volume, at, length);
		video.muted = gain <= 0;
		video.volume = Math.min(1, gain); // iPhone and iPad ignore this: there a clip with sound plays at full volume
		if (playing && want < (video.duration || Infinity) - 0.05)
			void video.play().catch(() => {
				// A browser that won't play sound without a tap: the picture still plays, silent.
				video.muted = true;
				void video.play().catch(() => {});
			});
		else video.pause();
	}, [at, playing, volume, length]);
	return <video ref={ref} src={src} muted playsInline preload="auto" style={style} onLoadedMetadata={(e) => e.currentTarget.videoHeight && onRatio(e.currentTarget.videoWidth / e.currentTarget.videoHeight)} />;
}

// Everything around the picture that both preview players share: the 9:16 box, the subtitle
// (drawn at full 1080x1920 and shrunk, so sizes match the final video; drag it to move it),
// the play button and the time bar.
export function PlayerFrame({
	children,
	playing,
	outTime,
	total,
	line: saying,
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
	cutout,
}: Props) {
	const line = subtitle.subtitles ? saying : null; // subtitles turned off: none drawn, like the final video (build_subtitles)
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
	const [ratios, setRatios] = useState<Record<string, number>>({}); // each inserted picture or clip's width / height
	const dragRef = useRef<{ y: number; position: number; piece?: [number, number] } | null>(null);
	const speakerDrag = useRef<{ corner: boolean; x: number; y: number; ax: number; ay: number; from: number; scale: number; speakerX: number; lift: number } | null>(null);
	const speakerMoved = useRef(false); // a drag that ends on the speaker must not also press play
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
	// A banner with its own font (banner_events in render.py): Russian-style letters still use the font that has them,
	// except in the user's own font. Its own font that isn't there falls back to Kanit, on both sides.
	const bannerOwn = banners.find((b) => b.font === "own" && b.ownFont)?.ownFont;
	useOwnFont(bannerOwn);
	const bannerFace = (b: Banner, value: string) => {
		if (!b.font) return textFace(value);
		if (b.font === "own") return b.ownFont ? { family: `"${ownFamily(b.ownFont.version)}", ${kanit.style.fontFamily}`, weight: 400, em: b.ownFont.height } : { ...FONT_FACES.kanit, em: FONTS.kanit.height };
		if (hasCyrillic(value)) return { family: fira.style.fontFamily, weight: 500, em: CYRILLIC_FONT.height };
		return { ...(FONT_FACES[b.font] ?? FONT_FACES.kanit), em: (FONTS[b.font] ?? FONTS.kanit).height };
	};
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
	// Motion (lib/motion.ts): the line pops in, every word jumps out. A jumping word grows around its own
	// middle and never pushes the others: pushing made the whole line shake, like a seizure. Same in
	// bounce_events in render.py.
	const motion = motionScale(
		subtitle.motion,
		FPS,
		line ? frame - line.from : 0,
		line ? line.parts.map((p) => p.from - line.from) : [],
	);
	const text = line
		? line.parts.map((p, k) => {
				if (subtitle.motion !== "bounce") {
					return (
						<span key={k}>
							{k === line.row2 && <br />}
							<span style={k === said ? { color: subtitle.color } : undefined}>{p.text}</span>
						</span>
					);
				}
				const word = p.text.trimStart();
				const { scale: wordScale, jumping } = motion.words[k];
				return (
					<span key={k}>
						{k === line.row2 && <br />}
						{p.text.slice(0, p.text.length - word.length)}
						<span
							style={{
								display: "inline-block",
								position: "relative",
								whiteSpace: "pre",
								marginLeft: k > 0 && k !== line.row2 ? subtitle.size * BOUNCE_WORD_GAP : undefined,
								transform: `scale(${wordScale})`,
								zIndex: jumping ? 1 : undefined,
								color: k === said ? subtitle.color : undefined,
							}}
						>
							{word}
						</span>
					</span>
				);
			})
		: "Your subtitles";

	// Under the subtitles, in this order: text behind the speaker, an inserted picture or clip (fading in
	// over the whole picture), then the cut-out speaker: full size over the text, or smaller in front of an
	// insert (or hidden). Same order and sizes as the final video (render.py).
	function cutoutLayers({ layers, files, person, onInsert }: NonNullable<Props["cutout"]>) {
		// Two at once: the speaker goes by the one on top, the later in the list (lib/layers.ts), as the final video does
		// (cutout_filters only draws a smaller speaker while no later picture shows, Codex review 12 Nov).
		const insert = layers.inserts.findLast((i) => insertShown(i, outTime) > 0) as Insert | undefined;
		const shown = insert ? insertShown(insert, outTime) : 0;
		const soft = (insert?.soft ?? INSERT.edgeFade) * 100;
		// Soft edges: melting at the left, right and bottom, clear towards the top. Same as cutout_filters in render.py.
		const edges = `linear-gradient(to right, transparent 0%, #000 ${soft}%, #000 ${100 - soft}%, transparent 100%), linear-gradient(to top, transparent 0%, #000 ${soft}%)`;
		const personStyle: CSSProperties = insert
			? {
					...(soft > 0 ? { maskImage: edges, WebkitMaskImage: edges, maskComposite: "intersect", WebkitMaskComposite: "source-in" } : {}),
					transformOrigin: "50% 100%",
					transform: speakerTransform(insert, boxWidth),
					opacity: insert.hidden ? 0 : shown,
				}
			: {};
		return (
			<>
				<div className="pointer-events-none absolute top-0 left-0" style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: "top left", zIndex: 1 }}>
					{layers.texts.flatMap((t) => {
						const face = FONT_FACES[t.font] ?? FONT_FACES.kanit;
						const em = FONTS[t.font]?.height ?? FONTS.kanit.height;
						const words = t.fx === "runLeft" || t.fx === "runRight" ? runText(t, W) : t.text;
						return behindMotion(t, outTime, W, H).map((pose, k) => (
							<div
								key={`${t.id}-${k}`}
								style={{
									position: "absolute",
									left: pose.x,
									top: pose.y,
									transform: `translate(${pose.align === "center" ? "-50%" : pose.align === "right" ? "-100%" : "0"}, -50%) scale(${pose.sx}, ${pose.sy})`,
									transformOrigin: pose.align === "center" ? "50% 50%" : pose.align === "right" ? "100% 50%" : "0 50%",
									whiteSpace: "pre",
									textAlign: "center",
									fontFamily: face.family,
									fontWeight: face.weight,
									fontSize: t.size / em,
									lineHeight: `${t.size + (t.lineGap ?? 0)}px`, // rows as far apart as build_behind in render.py puts them
									color: t.color,
									textShadow: roundOutline(t.stroke, t.strokeColor),
									opacity: pose.opacity,
								}}
							>
								{words}
							</div>
						));
					})}
				</div>
				{layers.inserts.map((i) => {
					const show = insertShown(i, outTime);
					const src = files[i.file];
					if (!show || !src) return null;
					const moved = picMoved(i);
					const ratio = ratios[i.file];
					const seen = (r: number) => setRatios((all) => (all[i.file] === r ? all : { ...all, [i.file]: r }));
					const fill: CSSProperties = moved && ratio ? { position: "absolute", maxWidth: "none", objectFit: "fill", ...picturePlace(i, ratio, W / H) } : { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" };
					return (
						<div key={i.id} className="absolute inset-0 overflow-hidden" style={{ opacity: show, zIndex: 1, background: moved && !i.seeThrough ? "#000" : undefined }}>
							<div className="absolute inset-0" style={{ transform: `scale(${pictureZoom(i, outTime)})` }}>
								{i.kind === "video" ? (
									<InsertClip src={src} at={outTime - i.start} playing={playing} style={fill} onRatio={seen} volume={i.volume} length={i.end - i.start} />
								) : (
									// eslint-disable-next-line @next/next/no-img-element
									<img src={src} alt="" style={fill} onLoad={(e) => e.currentTarget.naturalHeight && seen(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)} />
								)}
							</div>
						</div>
					);
				})}
				<div className="pointer-events-none absolute inset-0" style={{ zIndex: 1, ...personStyle }}>
					{person}
				</div>
				{/* While paused: drag the speaker to move them, a top corner to resize them. Writes the same numbers as the sliders. */}
				{insert && !insert.hidden && !insert.seeThrough && !playing && onInsert && (
					<div
						title="Drag to move yourself. Drag a corner to resize."
						onClick={(e) => speakerMoved.current && e.stopPropagation()}
						onPointerDown={(e) => {
							e.stopPropagation();
							e.currentTarget.setPointerCapture(e.pointerId);
							speakerMoved.current = false;
							const r = e.currentTarget.getBoundingClientRect();
							const corner = (e.target as HTMLElement).dataset.corner !== undefined;
							const ax = r.left + r.width / 2;
							speakerDrag.current = { corner, x: e.clientX, y: e.clientY, ax, ay: r.bottom, from: Math.hypot(e.clientX - ax, e.clientY - r.bottom), scale: insert.speakerScale, speakerX: insert.speakerX, lift: insert.speakerLift ?? 0 };
						}}
						onPointerMove={(e) => {
							const d = speakerDrag.current;
							const box = boxRef.current;
							if (!d || !box) return;
							speakerMoved.current = true;
							if (d.corner) {
								const scale = d.scale * (Math.hypot(e.clientX - d.ax, e.clientY - d.ay) / Math.max(1, d.from));
								onInsert(insert.id, { speakerScale: Math.round(Math.min(INSERT.scale.max, Math.max(INSERT.scale.min, scale)) * 100) / 100 });
							} else {
								const speakerX = d.speakerX + (e.clientX - d.x) / box.clientWidth;
								const speakerLift = d.lift - (e.clientY - d.y) / box.clientHeight;
								onInsert(insert.id, { speakerX: Math.round(Math.min(1, Math.max(0, speakerX)) * 1000) / 1000, speakerLift: Math.round(Math.min(INSERT.lift.max, Math.max(0, speakerLift)) * 1000) / 1000 });
							}
						}}
						onPointerUp={() => (speakerDrag.current = null)}
						className="absolute inset-0 cursor-move outline-2 -outline-offset-2 outline-blue-400 outline-dashed"
						style={{ zIndex: 1, touchAction: "none", transformOrigin: "50% 100%", transform: speakerTransform(insert, boxWidth) }}
					>
						{["top-0 left-0", "top-0 right-0"].map((at) => (
							<span key={at} data-corner="" className={`absolute ${at} h-4 w-4 cursor-nwse-resize rounded-sm bg-blue-400`} style={{ transform: `scale(${1 / insert.speakerScale})` }} />
						))}
					</div>
				)}
			</>
		);
	}

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
				{cutout && cutoutLayers(cutout)}
				<div
					className="pointer-events-none absolute top-0 left-0"
					style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: "top left", zIndex: 2 }}
				>
					{/* Uploaded banners (a picture, GIF or clip): over the speaker, under the subtitles, word banners and logo.
					    Same place, size and fades as banner_file_filters in render.py. */}
					{banners.map((b) => {
						if (b.kind !== "file" || !b.file) return null;
						const move = bannerMotion(b, outTime);
						const opacity = move.opacity * (b.opacity ?? 1);
						const src = bannerFileSrc(b.file);
						if (!opacity || !src) return null;
						const movable = Boolean(onBannersChange) && !playing;
						const fit: CSSProperties = { display: "block", width: "100%", height: "auto" };
						return (
							<div
								key={b.id}
								style={{ position: "absolute", left: (b.x ?? BANNER_FILE.x) * W, top: (b.y ?? BANNER_FILE.y) * H, width: W * BANNER_FILE.width * (b.scale ?? 1), transform: "translate(-50%, -50%)", opacity }}
							>
								<span
									className="relative block"
									onClick={(e) => movable && e.stopPropagation()}
									onPointerDown={(e) => movable && startBannerDrag(e, b, "move")}
									style={{
										// Arrives as picked, around its middle (banner_file_filters in render.py).
										transform: `translate(${move.x}px, ${move.y}px) scale(${move.scale})`,
										...(movable && { pointerEvents: "auto", cursor: "move", touchAction: "none", outline: "4px dashed rgba(255,255,255,0.8)", outlineOffset: 8 }),
									}}
									title={movable ? "Drag to move. Drag the corner to make it bigger or smaller." : undefined}
								>
									{b.media === "video" ? (
										<InsertClip src={src} at={outTime - b.start} playing={playing} style={fit} onRatio={() => {}} volume={b.volume} length={b.end - b.start} />
									) : (
										// eslint-disable-next-line @next/next/no-img-element -- a private link to the customer's own upload
										<img src={src} alt="" draggable={false} style={fit} />
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
					{(line || !playing) && (
						// Drag the subtitle up or down to move it. While paused with nothing being said,
						// a faded sample shows where subtitles will sit.
						<div
							onClick={(e) => e.stopPropagation()}
							onPointerDown={(e) => {
								e.stopPropagation();
								e.currentTarget.setPointerCapture(e.pointerId);
								dragRef.current = { y: e.clientY, position: line?.position ?? subtitle.position, piece: line?.piece };
							}}
							onPointerMove={(e) => {
								const drag = dragRef.current;
								const box = boxRef.current;
								if (!drag || !box) return;
								const { min, max } = LIMITS.position;
								const moved = drag.position - (e.clientY - drag.y) / box.clientHeight;
								const position = Math.round(Math.min(max, Math.max(min, moved)) * 1000) / 1000;
								// Once the video is Split, a drag moves only the piece this line is in (coach, 10 Nov).
								onSubtitleChange(drag.piece ? { ...subtitle, spots: setSpot(subtitle.spots, drag.piece[0], drag.piece[1], position) } : { ...subtitle, position });
							}}
							onPointerUp={() => (dragRef.current = null)}
							title="Drag to move the subtitles"
							style={{
								position: "absolute",
								left: SIDE_MARGIN,
								right: SIDE_MARGIN,
								// The extra row gap goes half under the last row in a browser: the bottom row stays put, as in the final video.
								bottom: H * (line?.position ?? subtitle.position) - rowGap / 2,
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
						if (b.kind === "file") return null; // drawn under the subtitles, above
						const move = bannerMotion(b, outTime);
						const opacity = move.opacity;
						if (!opacity) return null;
						const size = b.scale ?? 1;
						const padY = (BANNER.padding / 2) * size;
						const rows = bannerRows(b);
						// One box around all its rows (coach, 11 Nov: two lines were two boxes), as banner_events draws it: rows
						// row-size tall, lineGap apart, inside the padding; never shorter than its tallest row. It arrives as one
						// piece, around the box's middle (render.py works that out frame by frame for the growing kinds).
						const box: CSSProperties = {
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							boxSizing: "content-box",
							minHeight: Math.max(...rows.map((row) => row.size)) * size,
							background: b.noBox ? "transparent" : `${b.color ?? subtitle.color}${solid(b.opacity ?? 1)}`,
							borderRadius: (b.radius ?? 0) * size,
							padding: `${padY}px ${BANNER.padding * size}px`,
							transform: `translate(${move.x}px, ${move.y}px) scale(${move.scale})`,
						};
						const movable = Boolean(onBannersChange) && !playing;
						// Dragged somewhere: its middle sits there. Else its first row's letters start at the top of its place.
						const spot: CSSProperties =
							b.x !== undefined && b.y !== undefined
								? { left: b.x * W, top: b.y * H, width: W - 2 * SIDE_MARGIN, transform: "translate(-50%, -50%)" }
								: { left: SIDE_MARGIN, right: SIDE_MARGIN, top: Math.round(BANNER_TOP[subtitle.format][b.place] * H) - padY };
						return (
							<div
								key={b.id}
								style={{
									position: "absolute",
									...spot,
									display: "flex",
									flexDirection: "column",
									alignItems: "center",
									color: b.ink ?? bannerInk(b.color ?? subtitle.color),
									opacity,
								}}
							>
								<span
									className="relative flex flex-col items-center"
									onClick={(e) => movable && e.stopPropagation()}
									onPointerDown={(e) => movable && startBannerDrag(e, b, "move")}
									style={movable ? { pointerEvents: "auto", cursor: "move", touchAction: "none", outline: "4px dashed rgba(255,255,255,0.8)", outlineOffset: 8 } : undefined}
									title={movable ? "Drag to move. Drag the corner to make it bigger or smaller." : undefined}
								>
									<span style={box}>
										{rows.map((row, r) => {
											const rowFace = bannerFace(b, row.text);
											return (
												<span
													key={r}
													style={{
														display: "block",
														whiteSpace: "pre",
														flexShrink: 0,
														marginTop: r ? (b.lineGap ?? 0) * size : 0,
														height: row.size * size,
														fontFamily: rowFace.family,
														fontWeight: rowFace.weight,
														fontSize: (row.size / rowFace.em) * size,
														lineHeight: `${row.size * size}px`,
													}}
												>
													{row.text}
												</span>
											);
										})}
									</span>
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
