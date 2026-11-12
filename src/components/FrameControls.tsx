"use client";

import { ArrowLeft, ChevronRight, Film, Image as ImageIcon, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { BACK_COLORS, BORDER_COLORS, FRAME, type FrameBack, type FrameMe, frameName, FRAME_SHAPES, type FrameShape, NEW_FRAME, shapePolygon } from "@/lib/frame-me";
import { layerPlace, moveLayer } from "@/lib/layers";
import { type LibraryItem, projectFileSrc } from "@/lib/media-library";
import { newClipSound } from "@/lib/clip-sound";
import { ClipSound } from "./ClipSound";
import { ConfirmDelete } from "./ConfirmDelete";
import { LayerTools } from "./LayerTools";

type Props = {
	frames: FrameMe[];
	onChange: (frames: FrameMe[]) => void;
	now: () => number; // where the preview is, seconds of the final video
	total: number; // length of the final video, seconds
	focus: string | null; // a frame to open here
	onReveal?: (id: string, start: number) => void; // the blue line to its start
};

const round = (n: number) => Math.round(n * 10) / 10;
const BACKS: [FrameBack, string][] = [
	["blur", "Blur"],
	["color", "Color"],
	["file", "Picture or clip"],
];

// The shape as a small picture, for its button.
function ShapeIcon({ shape, size = 22 }: { shape: FrameShape; size?: number }) {
	const ratio = FRAME_SHAPES.find((s) => s.id === shape)?.ratio ?? 1;
	const [w, h] = ratio > 1 ? [size / ratio, size] : [size, size * ratio];
	return (
		<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
			<g transform={`translate(${(size - w) / 2} ${(size - h) / 2})`}>
				<polygon points={shapePolygon(shape, w, h)} fill="currentColor" opacity={0.85} />
			</g>
		</svg>
	);
}

// The editor's Frame Me box (coach, 12 Nov): for a stretch of the video, you show inside a shape over a background,
// like an alpha mask in OBS. Nothing is cut out, so it shows at once. Drawn by PlayerFrame, made by frame_filters.
export function FrameControls({ frames, onChange, now, total, focus, onReveal }: Props) {
	const [open, setOpen] = useState<string | null>(focus);
	const [focused, setFocused] = useState(focus);
	if (focus !== focused) {
		setFocused(focus);
		setOpen(focus);
	}
	const [removing, setRemoving] = useState<{ name: string; remove: () => void } | null>(null);
	const closeRemoving = useCallback(() => setRemoving(null), []);
	// The project's pictures and clips (Import), for a background. Asked for once the box opens.
	const [library, setLibrary] = useState<LibraryItem[] | null>(null);
	useEffect(() => {
		const key = new URLSearchParams(window.location.search).get("key");
		if (!key) return;
		let gone = false;
		fetch(`/api/library?key=${encodeURIComponent(key)}`)
			.then((r) => (r.ok ? (r.json() as Promise<{ items?: LibraryItem[] }>) : null))
			.then((data) => !gone && setLibrary(data?.items ?? []))
			.catch(() => !gone && setLibrary([]));
		return () => {
			gone = true;
		};
	}, []);

	const update = (id: string, patch: Partial<FrameMe>) => onChange(frames.map((f) => (f.id === id ? { ...f, ...patch } : f)));
	// A clip background: quietly on at first, so people hear it plays (coach, 12 Nov). A picture has no sound.
	const pickFile = (f: FrameMe, item: LibraryItem) => update(f.id, { back: "file", file: item.file, media: item.media, ...(item.media === "video" && f.volume === undefined && !f.muted ? newClipSound("video") : {}) });
	const add = (shape: FrameShape) => {
		const start = round(Math.min(now(), Math.max(0, total - 1)));
		const frame = NEW_FRAME(start, round(Math.min(total, start + FRAME.seconds)), shape);
		onChange([...frames, frame]); // on top of the others (lib/layers.ts)
		setOpen(frame.id);
		onReveal?.(frame.id, start);
	};
	const pick = (f: FrameMe) => {
		setOpen(f.id);
		onReveal?.(f.id, f.start);
	};
	const moveHere = (f: FrameMe) => {
		const seconds = f.end - f.start;
		const start = round(Math.max(0, Math.min(now(), total - seconds)));
		update(f.id, { start, end: round(Math.min(total, start + seconds)) });
		onReveal?.(f.id, start);
	};
	const remove = (f: FrameMe) => setRemoving({ name: frameName(f), remove: () => onChange(frames.filter((x) => x.id !== f.id)) });

	const row = (label: string, control: React.ReactNode) => (
		<label className="flex items-center gap-2 text-xs text-foreground/70">
			<span className="w-16 shrink-0">{label}</span>
			{control}
		</label>
	);
	const range = (value: number, min: number, max: number, step: number, show: string, set: (n: number) => void) => (
		<>
			<input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} className="min-w-0 flex-1 accent-blue-600" />
			<span className="w-12 tabular-nums">{show}</span>
		</>
	);
	const swatches = (colours: string[], value: string, set: (c: string) => void, label: string) => (
		<div className="flex flex-wrap items-center gap-1">
			{colours.map((c) => (
				<button key={c} onClick={() => set(c)} aria-label={`${label} ${c}`} className={`h-5 w-5 rounded-full border-2 ${value === c ? "border-blue-600" : "border-foreground/20"}`} style={{ background: c }} />
			))}
			<input type="color" value={value} onChange={(e) => set(e.target.value.toUpperCase())} aria-label={`Any ${label.toLowerCase()}`} className="h-5 w-7 cursor-pointer rounded border border-foreground/20 bg-transparent" />
		</div>
	);
	const percent = (n: number) => `${Math.round(n * 100)}%`;
	const trash = (f: FrameMe) => (
		<button onClick={() => remove(f)} aria-label={`Delete ${frameName(f)}`} title="Delete" className="rounded p-1 text-foreground/50 hover:bg-red-500/10 hover:text-red-600">
			<Trash2 className="h-3.5 w-3.5" aria-hidden />
		</button>
	);
	const shapes = (value: FrameShape | null, set: (shape: FrameShape) => void, disabled = false) => (
		<div className="grid grid-cols-7 gap-1">
			{FRAME_SHAPES.map((s) => (
				<button
					key={s.id}
					onClick={() => set(s.id)}
					disabled={disabled}
					title={s.name}
					aria-label={s.name}
					aria-pressed={value === s.id}
					className={`flex flex-col items-center gap-0.5 rounded-md border px-0.5 py-1 text-[10px] disabled:opacity-40 ${value === s.id ? "border-blue-600 bg-blue-600/10" : "border-foreground/20 hover:bg-foreground/5"}`}
				>
					<ShapeIcon shape={s.id} />
					{s.name}
				</button>
			))}
		</div>
	);

	const openFrame = frames.find((f) => f.id === open);
	const files = (library ?? []).filter((i) => i.media === "image" || /\.mp4$/.test(i.file));

	return (
		<div className="flex flex-col gap-2 p-3 pt-1">
			{!openFrame && (
				<>
					<p className="text-xs text-foreground/60">Show yourself inside a shape, over a blurred video, a color or your own picture. Nothing is cut out, so it&apos;s ready right away.</p>
					<span className="text-xs font-medium text-foreground/80">Add a frame where the video is now</span>
					{shapes(null, add, frames.length >= FRAME.maxItems)}
					{frames.length >= FRAME.maxItems && <p className="text-xs text-foreground/60">That&apos;s the most frames one video can have.</p>}
					{[...frames]
						.sort((a, b) => a.start - b.start)
						.map((f) => (
							<div key={f.id} className="flex items-center gap-1 rounded-lg border border-foreground/15 px-2 py-1">
								<button onClick={() => pick(f)} title="Open its settings" className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm">
									<ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
									<span className="shrink-0 text-foreground/60">
										<ShapeIcon shape={f.shape} size={16} />
									</span>
									<span className="truncate">{frameName(f)}</span>
									<span className="shrink-0 text-xs text-foreground/50 tabular-nums">
										{f.start}–{f.end}s
									</span>
								</button>
								{trash(f)}
							</div>
						))}
				</>
			)}

			{openFrame &&
				[openFrame].map((f) => (
					<div key={f.id} className="flex flex-col gap-2">
						<div className="flex flex-col gap-1">
							<button onClick={() => setOpen(null)} className="inline-flex items-center gap-1 self-start rounded-md px-1 py-0.5 text-xs text-foreground/70 hover:bg-foreground/5 hover:text-foreground">
								<ArrowLeft className="h-3.5 w-3.5" aria-hidden /> All frames
							</button>
							<div className="flex items-center gap-1.5">
								<span className="text-foreground/60">
									<ShapeIcon shape={f.shape} size={16} />
								</span>
								<span className="min-w-0 flex-1 truncate text-sm font-medium">{frameName(f)}</span>
								{trash(f)}
							</div>
						</div>
						<LayerTools onMoveHere={() => moveHere(f)} onUp={() => onChange(moveLayer(frames, f.id, true))} onDown={() => onChange(moveLayer(frames, f.id, false))} place={layerPlace(frames, f.id)} />
						<p className="text-xs text-foreground/60">Pause the video to drag the frame, its corner, or the dot in its middle that moves you inside it.</p>

						<div className="flex flex-col gap-1.5 rounded-lg border border-foreground/15 p-2">
							<span className="text-xs font-medium text-foreground/80">Shape</span>
							{shapes(f.shape, (shape) => update(f.id, { shape }))}
							{row(
								"Shows",
								<span className="flex items-center gap-1">
									<input type="number" min={0} max={total} step={0.1} value={f.start} onChange={(e) => update(f.id, { start: round(Math.max(0, Number(e.target.value))) })} className="w-16 rounded border border-foreground/20 bg-background px-1" aria-label="From second" />
									to
									<input type="number" min={0} max={total} step={0.1} value={f.end} onChange={(e) => update(f.id, { end: round(Math.min(total, Number(e.target.value))) })} className="w-16 rounded border border-foreground/20 bg-background px-1" aria-label="To second" />
									s
								</span>,
							)}
							{row("Size", range(f.size, FRAME.size.min, FRAME.size.max, 0.01, percent(f.size), (size) => update(f.id, { size })))}
							{row("Left / right", range(f.x, FRAME.move.min, FRAME.move.max, 0.005, percent(f.x), (x) => update(f.id, { x })))}
							{row("Up / down", range(f.y, FRAME.move.min, FRAME.move.max, 0.005, percent(f.y), (y) => update(f.id, { y })))}
						</div>

						<div className="flex flex-col gap-1.5 rounded-lg border border-foreground/15 p-2">
							<span className="text-xs font-medium text-foreground/80">You inside the frame</span>
							{row("Zoom", range(f.zoom, FRAME.zoom.min, FRAME.zoom.max, 0.01, percent(f.zoom), (zoom) => update(f.id, { zoom })))}
							{/* meX / meY: the point of you in the frame's middle. Sliding right moves you right, so it goes down. */}
							{row("Left / right", range(1 - f.meX, 0, 1, 0.005, percent(1 - f.meX), (v) => update(f.id, { meX: Math.round((1 - v) * 1000) / 1000 })))}
							{row("Up / down", range(1 - f.meY, 0, 1, 0.005, percent(1 - f.meY), (v) => update(f.id, { meY: Math.round((1 - v) * 1000) / 1000 })))}
							<button onClick={() => update(f.id, { meX: FRAME.me.x, meY: FRAME.me.y, zoom: f.size })} className="self-start rounded-md border border-foreground/20 px-2 py-0.5 text-xs hover:bg-foreground/5">
								Center me
							</button>
						</div>

						<div className="flex flex-col gap-1.5 rounded-lg border border-foreground/15 p-2">
							<span className="text-xs font-medium text-foreground/80">Border</span>
							{row("Width", range(f.border, 0, FRAME.border.max, 1, `${f.border}px`, (border) => update(f.id, { border })))}
							{f.border > 0 && row("Color", swatches(BORDER_COLORS, f.borderColor, (borderColor) => update(f.id, { borderColor }), "Border color"))}
						</div>

						<div className="flex flex-col gap-1.5 rounded-lg border border-foreground/15 p-2">
							<span className="text-xs font-medium text-foreground/80">Background</span>
							<div role="radiogroup" aria-label="Background" className="grid grid-cols-3 gap-1 rounded-lg bg-foreground/5 p-0.5">
								{BACKS.map(([id, name]) => (
									<button
										key={id}
										role="radio"
										aria-checked={f.back === id}
										onClick={() => {
											// A picture or clip: the one it had, else the project's newest.
											if (id !== "file" || f.file) update(f.id, { back: id });
											else if (files[0]) pickFile(f, files[0]);
										}}
										disabled={id === "file" && !f.file && !files.length}
										title={id === "file" && !f.file && !files.length ? "Add a picture or clip in Import first" : undefined}
										className={`rounded-md px-1.5 py-1 text-xs whitespace-nowrap disabled:opacity-40 ${f.back === id ? "bg-blue-400/15 font-medium ring-1 ring-inset ring-blue-400" : "text-foreground/70 hover:text-foreground"}`}
									>
										{name}
									</button>
								))}
							</div>
							{f.back === "blur" && (
								<>
									{row("Blur", range(f.blur, 0, FRAME.blur.max, 1, `${f.blur}px`, (blur) => update(f.id, { blur })))}
									{row("Darken", range(f.dim, 0, FRAME.dim.max, 0.05, percent(f.dim), (dim) => update(f.id, { dim })))}
								</>
							)}
							{f.back === "color" && row("Color", swatches(BACK_COLORS, f.backColor, (backColor) => update(f.id, { backColor }), "Background color"))}
							{f.back === "file" && (
								<div className="grid grid-cols-4 gap-1">
									{files.map((item) => (
										<button
											key={item.file}
											onClick={() => pickFile(f, item)}
											title={item.name}
											aria-pressed={f.file === item.file}
											className={`relative aspect-[9/16] overflow-hidden rounded-md border-2 bg-black ${f.file === item.file ? "border-blue-600" : "border-transparent hover:border-foreground/30"}`}
										>
											{item.media === "video" ? (
												<>
													<video src={projectFileSrc(item.file)} muted playsInline preload="metadata" className="h-full w-full object-cover" />
													<Film className="absolute right-0.5 bottom-0.5 h-3 w-3 text-white drop-shadow" aria-hidden />
												</>
											) : (
												// eslint-disable-next-line @next/next/no-img-element -- a private link to the customer's own upload
												<img src={projectFileSrc(item.file)} alt={item.name} className="h-full w-full object-cover" />
											)}
										</button>
									))}
								</div>
							)}
							{f.back === "file" && f.media === "video" && <div className="flex items-center gap-2 text-xs text-foreground/70"><span className="w-16 shrink-0">Sound</span><ClipSound sound={f} onChange={(patch) => update(f.id, patch)} /></div>}
							{(f.back === "file" || !files.length) && (
								<p className="flex items-center gap-1 text-xs text-foreground/60">
									<ImageIcon className="h-3.5 w-3.5 shrink-0" aria-hidden /> Add your pictures and clips in Import, then pick one here.{library === null && " Loading…"}
								</p>
							)}
						</div>
					</div>
				))}

			{removing && (
				<ConfirmDelete
					name={removing.name}
					onCancel={closeRemoving}
					onConfirm={() => {
						removing.remove();
						setRemoving(null);
						setOpen(null);
					}}
				/>
			)}
		</div>
	);
}
