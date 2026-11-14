"use client";

import { Pause, Play } from "lucide-react";
import { Anton, Bebas_Neue, Chakra_Petch, Fira_Sans, Kanit, Mitr, Poppins, Prompt, Sarabun, Itim, Sriracha, Pattaya, Chonburi, Charm, Mali, Bai_Jamjuree, K2D, Krub, Kodchasan, Trirong, Maitree, Bangers, Pacifico, Lobster, Abril_Fatface, Alfa_Slab_One, Righteous, Archivo_Black, Titan_One } from "next/font/google";
import { type CSSProperties, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { BANNER, BANNER_FILE, BANNER_SCALE, BANNER_TOP, type Banner, bannerFileSrc, bannerInk, bannerMotion, bannerRows } from "@/lib/banners";
import { backdropShown, behindMotion, type CutoutLayers, INSERT, type Insert, insertShown, picMoved, picturePlace, pictureZoom, runText, speakerTransform } from "@/lib/behind";
import { clipGain, soundOf } from "@/lib/clip-sound";
import { type FrameMe, FRAME, frameAt, frameShown, framePicture, frameRect, shapeMask, shapePolygon } from "@/lib/frame-me";
import { LAYOUT_DRAG, type LayoutDrop, layoutAt, layoutFlash, layoutPose, layoutProgress, type VideoLayout } from "@/lib/layout";
import { projectFileSrc } from "@/lib/media-library";
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
	// Frame Me (lib/frame-me.ts): the picture and the cutout layers inside a shape, over a background.
	// onFrameChange: the frame dragged or resized on the video, while paused (left out: it can't be moved here).
	frames?: FrameMe[];
	onFrameChange?: (id: string, patch: Partial<FrameMe>) => void;
	// Layout (lib/layout.ts): the screen split, the speaker in one part and a picture, clip or colour in the other.
	// onLayoutChange: the speaker dragged inside their part, while paused (left out: they can't be moved here).
	layouts?: VideoLayout[];
	onLayoutChange?: (id: string, patch: Partial<VideoLayout>) => void;
	// A picture or clip dropped on the video (from the computer, or from the Layout box): into the other part of the
	// layout showing now (its id), or a new layout here (null). Left out: nothing can be dropped here.
	onLayoutDrop?: (drop: LayoutDrop, id: string | null) => void;
};

// Frame Me's Blur background: the picture as it is drawn now, copied small on every screen refresh and blurred by CSS
// (Safari's canvas has no blur of its own). Blown up a little, so the blur's see-through edge stays off the screen,
// as gblur in frame_filters (render.py) keeps its edges. dim: black laid over it, as drawbox does there.
// ratio: the video's width / height. The copy has the same shape, so 1:1 and 16:9 aren't stretched (Codex review 12 Nov).
// side: the copy's longer side, px (blurred, a small copy is enough; the plain copy under a fading frame is sharper).
function BlurBack({ source, blur, dim, ratio, side = 320 }: { source: RefObject<HTMLDivElement | null>; blur: number; dim: number; ratio: number; side?: number }) {
	const ref = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		let next = 0;
		const draw = () => {
			const out = ref.current;
			const box = source.current;
			// The engine's canvas, or (the <video> player) the video on screen.
			const videos = [...(box?.querySelectorAll("video") ?? [])];
			const from = box?.querySelector("canvas") ?? videos.find((v) => v.style.zIndex === "1") ?? videos[0];
			const pen = out?.getContext("2d");
			if (out && from && pen) {
				try {
					pen.drawImage(from, 0, 0, out.width, out.height);
				} catch {
					// nothing to draw yet (a video still loading): try again next time
				}
			}
			next = requestAnimationFrame(draw);
		};
		draw();
		return () => cancelAnimationFrame(next);
	}, [source]);
	const grow = 1 + (4 * blur) / 100; // blur is screen px here: about two blur widths more on each side of a ~300px box
	return (
		<>
			<canvas ref={ref} width={Math.round(side * Math.min(1, ratio))} height={Math.round(side * Math.min(1, 1 / ratio))} className="absolute inset-0 h-full w-full" style={{ filter: blur ? `blur(${blur}px)` : undefined, transform: `scale(${grow})` }} />
			{dim > 0 && <div className="absolute inset-0" style={{ background: `rgba(0,0,0,${dim})` }} />}
		</>
	);
}

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

// Frame Me's border, as thick on both sides of the shape's edge as frame_filters draws it (render.py), and, while paused
// with its box open (onChange), the handles: drag the frame to move it, its corner to resize it, the dot in its middle
// to move the speaker inside it. W x H: the final video, laid out at full size and shrunk by scale.
function FrameEdge({ f, W, H, scale, box, onChange }: { f: FrameMe; W: number; H: number; scale: number; box: RefObject<HTMLDivElement | null>; onChange?: (id: string, patch: Partial<FrameMe>) => void }) {
	const drag = useRef<{ mode: "move" | "size" | "me"; x: number; y: number; from: FrameMe; reach: number } | null>(null);
	const moved = useRef(false); // a drag that ends on the frame must not also press play
	const r = frameRect(f, W, H);
	const [x, y, w, h] = [r.x * scale, r.y * scale, r.w * scale, r.h * scale];
	const middleOf = (g: FrameMe) => {
		const rect = box.current?.getBoundingClientRect();
		return { x: (rect?.left ?? 0) + g.x * W * scale, y: (rect?.top ?? 0) + g.y * H * scale };
	};
	const start = (e: ReactPointerEvent<HTMLElement>, mode: "move" | "size" | "me") => {
		e.stopPropagation();
		e.preventDefault();
		e.currentTarget.setPointerCapture(e.pointerId);
		const middle = middleOf(f);
		drag.current = { mode, x: e.clientX, y: e.clientY, from: f, reach: Math.max(8, Math.hypot(e.clientX - middle.x, e.clientY - middle.y)) };
		moved.current = false;
	};
	const move = (e: ReactPointerEvent<HTMLElement>) => {
		const d = drag.current;
		if (!d || !onChange) return;
		e.stopPropagation();
		moved.current = true;
		const dx = (e.clientX - d.x) / (W * scale);
		const dy = (e.clientY - d.y) / (H * scale);
		const clamp = (n: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, n)) * 1000) / 1000;
		if (d.mode === "move") onChange(f.id, { x: clamp(d.from.x + dx, FRAME.move.min, FRAME.move.max), y: clamp(d.from.y + dy, FRAME.move.min, FRAME.move.max) });
		// The point of the speaker in the frame's middle: dragging right brings a point further left there.
		else if (d.mode === "me") onChange(f.id, { meX: clamp(d.from.meX - dx / d.from.zoom, 0, 1), meY: clamp(d.from.meY - dy / d.from.zoom, 0, 1) });
		else {
			const middle = middleOf(d.from);
			onChange(f.id, { size: clamp((d.from.size * Math.hypot(e.clientX - middle.x, e.clientY - middle.y)) / d.reach, FRAME.size.min, FRAME.size.max) });
		}
	};
	const stop = () => (drag.current = null);
	const handle = { onPointerMove: move, onPointerUp: stop, onPointerCancel: stop };
	return (
		<>
			{f.border > 0 && (
				<svg className="pointer-events-none absolute overflow-visible" style={{ left: x, top: y, width: w, height: h }} viewBox={`0 0 ${w} ${h}`}>
					<polygon points={shapePolygon(f.shape, w, h)} fill="none" stroke={f.borderColor} strokeWidth={f.border * scale} strokeLinejoin="round" />
				</svg>
			)}
			{onChange && (
				<div
					title="Drag to move the frame. Drag the corner to resize it. Drag the dot to move yourself inside it."
					onClick={(e) => moved.current && e.stopPropagation()}
					onPointerDown={(e) => start(e, "move")}
					{...handle}
					className="absolute cursor-move outline-2 outline-blue-400 outline-dashed"
					style={{ left: x, top: y, width: w, height: h, touchAction: "none" }}
				>
					<span onPointerDown={(e) => start(e, "size")} {...handle} className="absolute -right-2 -bottom-2 h-4 w-4 cursor-nwse-resize rounded-sm bg-blue-400" />
					<span
						title="Drag to move yourself inside the frame"
						onPointerDown={(e) => start(e, "me")}
						{...handle}
						className="absolute top-1/2 left-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-white bg-blue-500/80"
					/>
				</div>
			)}
		</>
	);
}

// Layout, while paused with its box open: drag yourself inside your part (meX side by side, meY top / bottom).
// box: the speaker's part on the full-size video; W x H: the final video, shrunk by scale.
function LayoutHandle({ l, box, W, H, scale, onChange }: { l: VideoLayout; box: { x: number; y: number; w: number; h: number }; W: number; H: number; scale: number; onChange: (id: string, patch: Partial<VideoLayout>) => void }) {
	const drag = useRef<{ x: number; y: number; meX: number; meY: number } | null>(null);
	const moved = useRef(false); // a drag that ends on it must not also press play
	return (
		<div
			title="Drag to move yourself inside your part"
			onClick={(e) => moved.current && e.stopPropagation()}
			onPointerDown={(e) => {
				e.stopPropagation();
				e.currentTarget.setPointerCapture(e.pointerId);
				moved.current = false;
				drag.current = { x: e.clientX, y: e.clientY, meX: l.meX, meY: l.meY };
			}}
			onPointerMove={(e) => {
				const d = drag.current;
				if (!d) return;
				moved.current = true;
				// Dragging right brings a point further left into the middle of the part.
				const clamp = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;
				if (l.kind === "side") onChange(l.id, { meX: clamp(d.meX - (e.clientX - d.x) / (W * scale)) });
				else onChange(l.id, { meY: clamp(d.meY - (e.clientY - d.y) / (H * scale)) });
			}}
			onPointerUp={() => (drag.current = null)}
			className={`absolute outline-2 -outline-offset-2 outline-blue-400 outline-dashed ${l.kind === "side" ? "cursor-ew-resize" : "cursor-ns-resize"}`}
			style={{ left: box.x * scale, top: box.y * scale, width: box.w * scale, height: box.h * scale, touchAction: "none" }}
		/>
	);
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
	frames,
	onFrameChange,
	layouts,
	onLayoutChange,
	onLayoutDrop,
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
	const pictureRef = useRef<HTMLDivElement>(null); // the picture, for Frame Me's Blur background
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
				{/* Darken / Blur background while a text shows (BehindText dim, blur), under the text and the speaker. Blur in
				    screen px (the video's px times scale), as gblur's sigma in cutout_filters is the video's px. */}
				{layers.texts.map((t) => {
					const show = backdropShown(t, outTime);
					if (!show) return null;
					const blur = t.blur ? `blur(${(t.blur * scale).toFixed(2)}px)` : undefined;
					return <div key={`backdrop-${t.id}`} className="pointer-events-none absolute inset-0" style={{ zIndex: 1, opacity: show, background: t.dim ? `rgba(0,0,0,${t.dim})` : undefined, backdropFilter: blur, WebkitBackdropFilter: blur }} />;
				})}
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
									<InsertClip src={src} at={outTime - i.start} playing={playing} style={fill} onRatio={seen} volume={soundOf(i)} length={i.end - i.start} />
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

	// Frame Me: the one showing now (the later one in the list when two overlap), laid out on the 1080-wide video
	// (frameRect, framePicture) and shrunk by scale, as frame_filters puts it on the final video (render.py).
	const framed = frameAt(frames, outTime);
	const fade = framed ? frameShown(framed, outTime) : 0;
	const frameMask = (f: FrameMe): CSSProperties => {
		const r = frameRect(f, W, H);
		const [image, size, at] = [shapeMask(f.shape), `${r.w * scale}px ${r.h * scale}px`, `${r.x * scale}px ${r.y * scale}px`];
		return { maskImage: image, maskSize: size, maskPosition: at, maskRepeat: "no-repeat", WebkitMaskImage: image, WebkitMaskSize: size, WebkitMaskPosition: at, WebkitMaskRepeat: "no-repeat" };
	};
	const framePlace = (f: FrameMe): CSSProperties => {
		const p = framePicture(f, W, H);
		return { transformOrigin: "0 0", transform: `translate(${p.x * scale}px, ${p.y * scale}px) scale(${p.scale})` };
	};
	function frameBack(f: FrameMe) {
		const src = f.back === "file" && f.file ? projectFileSrc(f.file) : "";
		const fill: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" };
		return (
			<div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ background: f.back === "color" ? f.backColor : "#000" }}>
				{f.back === "blur" && <BlurBack source={pictureRef} blur={f.blur * scale} dim={f.dim} ratio={W / H} />}
				{src &&
					(f.media === "video" ? (
						<InsertClip src={src} at={outTime - f.start} playing={playing} style={fill} onRatio={() => {}} volume={soundOf(f)} length={f.end - f.start} />
					) : (
						// eslint-disable-next-line @next/next/no-img-element -- a private link to the customer's own upload
						<img src={src} alt="" style={fill} />
					))}
			</div>
		);
	}
	// Layout: the one showing now (the later one in the list when two overlap), laid out on the full-size video
	// (layoutPose) and shrunk by scale, as layout_filters puts it on the final video (render.py). Under Frame Me there,
	// so here it is inside Frame Me's shape: a frame over a split screen frames all of it.
	const split = layoutAt(layouts, outTime);
	const pose = split ? layoutPose(split, layoutProgress(split, outTime), W, H) : null;
	const flash = layoutFlash(layouts, outTime);
	const [dropping, setDropping] = useState(false); // a file is being dragged over the video
	const canDrop = (e: ReactDragEvent) => Boolean(onLayoutDrop) && (e.dataTransfer.types.includes("Files") || e.dataTransfer.types.includes(LAYOUT_DRAG));
	const dropProps = onLayoutDrop
		? {
				onDragOver: (e: ReactDragEvent) => {
					if (!canDrop(e)) return;
					e.preventDefault();
					e.dataTransfer.dropEffect = "copy";
					setDropping(true);
				},
				onDragLeave: (e: ReactDragEvent) => {
					if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
				},
				onDrop: (e: ReactDragEvent) => {
					if (!canDrop(e)) return;
					e.preventDefault();
					setDropping(false);
					const file = e.dataTransfer.files[0];
					let item: LayoutDrop["item"];
					try {
						item = JSON.parse(e.dataTransfer.getData(LAYOUT_DRAG) || "null") ?? undefined;
					} catch {
						item = undefined;
					}
					if (file || item) onLayoutDrop?.({ file, item }, split?.id ?? null);
				},
			}
		: {};
	const at = (b: { x: number; y: number; w: number; h: number }): CSSProperties => ({ position: "absolute", left: b.x * scale, top: b.y * scale, width: b.w * scale, height: b.h * scale });
	function layoutOther(l: VideoLayout, box: { x: number; y: number; w: number; h: number }) {
		const src = l.file ? projectFileSrc(l.file) : "";
		const fill: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" };
		return (
			<div className="pointer-events-none overflow-hidden" style={{ ...at(box), background: l.color }}>
				{src &&
					(l.media === "video" ? (
						<InsertClip src={src} at={outTime - l.start} playing={playing} style={fill} onRatio={() => {}} volume={soundOf(l)} length={l.end - l.start} />
					) : (
						// eslint-disable-next-line @next/next/no-img-element -- a private link to the customer's own upload
						<img src={src} alt="" style={fill} />
					))}
			</div>
		);
	}
	return (
		// As wide as fits, but never taller than --player-h (ScriptView keeps it clear of the timeline), else ~70% of the screen.
		<div className="mx-auto flex w-full flex-col gap-2" style={{ maxWidth: `calc(var(--player-h, 70vh) * ${W} / ${H})` }}>
			<div
				ref={boxRef}
				onClick={onToggle}
				{...dropProps}
				className="relative w-full cursor-pointer overflow-hidden rounded-lg bg-black"
				style={{ aspectRatio: `${W} / ${H}` }}
			>
				{/* Fading in or out (frameShown): the plain picture, copied, under the framed one, as frame_filters fades the frame over it. */}
				{framed && fade < 1 && <BlurBack source={pictureRef} blur={0} dim={0} ratio={W / H} side={720} />}
				<div className="absolute inset-0" style={framed && fade < 1 ? { opacity: fade } : undefined}>
					{framed && frameBack(framed)}
					{/* Always the same elements, with or without a frame: a new canvas would lose the picture the engine draws on. */}
					<div className="absolute inset-0" style={framed ? frameMask(framed) : undefined}>
						<div className="absolute inset-0" style={framed ? framePlace(framed) : undefined}>
							{/* Layout moves the speaker (and the Cutout layers with them) into their part: always this element, moved or not. */}
							<div className="absolute inset-0" style={pose ? { transform: `translate(${pose.picture.x * scale}px, ${pose.picture.y * scale}px)` } : undefined}>
								<div
									ref={pictureRef}
									className="absolute inset-0"
									style={zoom !== 1 ? { transform: `scale(${zoom})`, transformOrigin: `${ZOOM_ORIGIN.x * 100}% ${ZOOM_ORIGIN.y * 100}%` } : undefined}
								>
									{children}
								</div>
								{cutout && cutoutLayers(cutout)}
							</div>
							{split && pose && layoutOther(split, pose.other)}
							{/* Flash: white over the picture at the edges of a Flash layout, as layout_flashes (render.py). */}
							{flash > 0 && <div className="pointer-events-none absolute inset-0 bg-white" style={{ opacity: flash }} />}
							{split && pose && onLayoutChange && !playing && <LayoutHandle l={split} box={pose.me} W={W} H={H} scale={scale} onChange={onLayoutChange} />}
						</div>
					</div>
					{framed && <FrameEdge f={framed} W={W} H={H} scale={scale} box={boxRef} onChange={playing ? undefined : onFrameChange} />}
				</div>
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
										<InsertClip src={src} at={outTime - b.start} playing={playing} style={fit} onRatio={() => {}} volume={soundOf(b)} length={b.end - b.start} />
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
				{dropping && (
					// Where it will go: the other part of the layout showing now, else a new layout here.
					<div className="pointer-events-none absolute z-[3] flex items-center justify-center bg-blue-500/30 text-center text-sm font-medium text-white outline-4 -outline-offset-4 outline-blue-400 outline-dashed" style={pose ? at(pose.other) : { inset: 0 }}>
						<span className="rounded bg-black/60 px-2 py-1">{pose ? "Drop to put it here" : "Drop to split the screen with it"}</span>
					</div>
				)}
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
