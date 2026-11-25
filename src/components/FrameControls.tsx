"use client";

import { ArrowDown, ArrowLeft, ArrowUp, ChevronRight, Copy, Film, Image as ImageIcon, Trash2, User } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { BACK_COLORS, BORDER_COLORS, FRAME, type FrameBack, type FrameMe, frameBackMoved, frameName, FRAME_SHAPES, type FrameShape, NEW_FRAME, shapePolygon, wholeBackSize } from "@/lib/frame-me";
import { type Format, outputSize } from "@/lib/subtitle-style";
import { duplicateOf, layerPlace, moveLayer } from "@/lib/layers";
import { type LibraryItem, projectFileSrc } from "@/lib/media-library";
import { newClipSound } from "@/lib/clip-sound";
import { startMotion } from "@/lib/bg-motion";
import { BgMotionControl } from "./BgMotionControl";
import { ClipSound } from "./ClipSound";
import { ClipTrim } from "./ClipTrim";
import { FadeSwitches } from "./FadeSwitches";
import { ConfirmDelete } from "./ConfirmDelete";
import { MAIN_BUTTON, mainStyle, PICKED, PLAIN_BUTTON, TabGroup, ToolGroup } from "./ToolGroup";
import { type Clock, FINAL_CLOCK, ON_TIMELINE, rangeText, TimeRange } from "./TimeField";

type Props = {
	frames: FrameMe[];
	onChange: (frames: FrameMe[]) => void;
	now: () => number; // where the preview is, seconds of the final video
	total: number; // length of the final video, seconds
	focus: string | null; // a frame to open here
	onReveal?: (id: string, start: number) => void; // the blue line to its start
	ruler?: Clock; // the timeline ruler's clock, for the times shown here
	format?: Format; // the video's shape, for Whole picture
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
export function FrameControls({ frames, onChange, now, total, focus, onReveal, ruler = FINAL_CLOCK, format }: Props) {
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
	// Another file starts filling the screen again, from its beginning.
	const pickFile = (f: FrameMe, item: LibraryItem) => update(f.id, { back: "file", file: item.file, media: item.media, clipFrom: undefined, ...(item.file !== f.file && { backSize: undefined, backX: undefined, backY: undefined, backRotate: undefined }), ...(item.media === "video" && f.volume === undefined && !f.muted ? newClipSound("video") : {}) });
	// Each file's width / height, learnt from its small picture below.
	const [ratios, setRatios] = useState<Record<string, number>>({});
	const seen = (file: string, w: number, h: number) => h && setRatios((all) => (all[file] === w / h ? all : { ...all, [file]: w / h }));
	const screen = outputSize({ format });
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
	// A copy right after it, opened (coach, 14 Nov: the same in every box).
	const duplicate = (f: FrameMe) => {
		const copy = duplicateOf(f, total);
		onChange([...frames, copy]);
		pick(copy);
	};
	const remove = (f: FrameMe) => setRemoving({ name: frameName(f), remove: () => onChange(frames.filter((x) => x.id !== f.id)) });

	const row = (label: React.ReactNode, control: React.ReactNode, middle?: () => void) => (
		// Double-click the name: back to the middle (coach 23 Nov).
		<label onDoubleClick={middle} title={middle ? "Double-click the name: back to the middle" : undefined} className="flex items-center gap-2 text-xs text-foreground/70">
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
	const [tab, setTab] = useState<"you" | "back">("you"); // under Shape: You, or the Background (coach 22 Nov)
	const [picking, setPicking] = useState<string | null>(null); // the frame whose pictures are open to change
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
										{rangeText(f.start, f.end, ruler)}
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
								{/* The name on the timeline strip: the shape's name until the creator types their own (coach, 13 Nov:
								    several Hearts all read "Heart"). Empty goes back to the shape's name. */}
								<input
									value={f.name ?? ""}
									placeholder={frameName({ ...f, name: undefined })}
									maxLength={40}
									onChange={(e) => update(f.id, { name: e.target.value.replace(/[\n\r\t]/g, " ") || undefined })}
									aria-label="Name on the timeline"
									title="Name on the timeline"
									className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-sm font-medium placeholder:text-foreground placeholder:opacity-100 hover:border-foreground/20 focus:border-foreground/30 focus:outline-none"
								/>
								{(() => {
									const place = layerPlace(frames, f.id);
									return (
										<>
											<span className="shrink-0 text-[11px] text-foreground/60" title="Its layer among the things showing with it">
												{place ? `${place.at}/${place.of}` : "1/1"}
											</span>
											<button onClick={() => onChange(moveLayer(frames, f.id, true))} disabled={!place || place.at === place.of} title={place ? "Bring it in front of the one over it" : "Nothing else shows at the same time"} aria-label="Bring forward" className="rounded p-1 text-foreground/50 hover:bg-foreground/5 hover:text-foreground disabled:opacity-30">
												<ArrowUp className="h-3.5 w-3.5" aria-hidden />
											</button>
											<button onClick={() => onChange(moveLayer(frames, f.id, false))} disabled={!place || place.at === 1} title={place ? "Send it behind the one under it" : "Nothing else shows at the same time"} aria-label="Send backward" className="rounded p-1 text-foreground/50 hover:bg-foreground/5 hover:text-foreground disabled:opacity-30">
												<ArrowDown className="h-3.5 w-3.5" aria-hidden />
											</button>
										</>
									);
								})()}
								<button onClick={() => duplicate(f)} disabled={frames.length >= FRAME.maxItems} aria-label="Duplicate" title="Duplicate: a copy right after it (Ctrl+D on the timeline)" className="rounded p-1 text-foreground/50 hover:bg-foreground/5 hover:text-foreground disabled:opacity-30">
									<Copy className="h-3.5 w-3.5" aria-hidden />
								</button>
								{trash(f)}
							</div>
						</div>
						

						<ToolGroup tone={2} title="Shape">
							{/* With the playhead moved off this frame, a shape is a new frame there (coach, 17 Nov: a circle at 3:00
							    open, the playhead at 4:00, Heart picked: the circle turned into the heart, so the circle was gone). */}
							<div title="With the video moved off this frame, a shape adds a new frame there">
								{shapes(f.shape, (shape) => {
									const at = now();
									if ((at < f.start || at > f.end) && frames.length < FRAME.maxItems) add(shape);
									else update(f.id, { shape });
								})}
							</div>
							<span className="text-[11px] text-foreground/60">Pause, then drag the frame or its corner</span>
							{row("Size", range(f.size, FRAME.size.min, FRAME.size.max, 0.01, percent(f.size), (size) => update(f.id, { size })))}
							{row("Left / right", range(f.x, FRAME.move.min, FRAME.move.max, 0.005, percent(f.x), (x) => update(f.id, { x })), () => update(f.id, { x: 0.5 }))}
							{row("Up / down", range(f.y, FRAME.move.min, FRAME.move.max, 0.005, percent(f.y), (y) => update(f.id, { y })), () => update(f.id, { y: 0.42 }))}
						</ToolGroup>

						<TabGroup
							tone={3}
							value={tab}
							onChange={setTab}
							tabs={[
								{ id: "you", label: "You", icon: <User className="h-5 w-5" aria-hidden /> },
								{ id: "back", label: "Background", icon: <ImageIcon className="h-5 w-5" aria-hidden /> },
							]}
						>
							{tab === "you" && (
								<>
									<span className="text-[11px] text-foreground/60">Pause, then drag the dot in the middle of the frame</span>
									{row("Zoom", range(f.zoom, FRAME.zoom.min, FRAME.zoom.max, 0.01, percent(f.zoom), (zoom) => update(f.id, { zoom })))}
									{/* meX / meY: the point of you in the frame's middle. Sliding right moves you right, so it goes down. */}
									{row("Left / right", range(1 - f.meX, 1 - FRAME.meRange.max, 1 - FRAME.meRange.min, 0.005, percent(1 - f.meX), (v) => update(f.id, { meX: Math.round((1 - v) * 1000) / 1000 })), () => update(f.id, { meX: FRAME.me.x }))}
									{row("Up / down", range(1 - f.meY, 1 - FRAME.meRange.max, 1 - FRAME.meRange.min, 0.005, percent(1 - f.meY), (v) => update(f.id, { meY: Math.round((1 - v) * 1000) / 1000 })), () => update(f.id, { meY: FRAME.me.y }))}
									<button onClick={() => update(f.id, { meX: FRAME.me.x, meY: FRAME.me.y, zoom: f.size })} className={`self-start ${PLAIN_BUTTON}`}>
										Center me
									</button>
								</>
							)}
							{tab === "back" && (
								<>
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
												title={id === "file" && !f.file && !files.length ? "Add a picture or clip in My files first" : undefined}
												className={`rounded-md px-1.5 py-1 text-xs whitespace-nowrap disabled:opacity-40 ${f.back === id ? PICKED : "text-foreground/70 hover:text-foreground"}`}
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
									<div className="relative flex flex-col gap-1.5">
									{f.back === "file" && f.file && (
										// Picked: one row (its picture, its name, Change); the pictures to pick from open only on Change (coach 22 Nov).
										<div className="flex items-center gap-2">
											<span className="relative h-10 w-[22px] shrink-0 overflow-hidden rounded border border-foreground/20 bg-black">
												{f.media === "video" ? (
													<video src={projectFileSrc(f.file)} muted playsInline preload="metadata" onLoadedMetadata={(e) => seen(f.file!, e.currentTarget.videoWidth, e.currentTarget.videoHeight)} className="h-full w-full object-cover" />
												) : (
													// eslint-disable-next-line @next/next/no-img-element -- a private link to the customer's own upload
													<img src={projectFileSrc(f.file)} alt="" onLoad={(e) => seen(f.file!, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)} className="h-full w-full object-cover" />
												)}
											</span>
											<span className="min-w-0 flex-1 truncate text-xs">{files.find((i) => i.file === f.file)?.name ?? (f.media === "video" ? "Clip" : "Picture")}</span>
											<button onClick={() => setPicking(picking === f.id ? null : f.id)} aria-expanded={picking === f.id} className={MAIN_BUTTON} style={mainStyle(3)}>
												{picking === f.id ? "Done" : "Change"}
											</button>
										</div>
									)}
									{f.back === "file" && (!f.file || picking === f.id) && (
										<div className={f.file ? "absolute left-0 right-0 top-full z-40 mt-1 grid max-h-72 grid-cols-4 gap-1 overflow-y-auto rounded-lg border border-foreground/20 bg-background p-2 shadow-xl" : "grid grid-cols-4 gap-1"}>
											{files.map((item) => (
												<button
													key={item.file}
													onClick={() => {
														pickFile(f, item);
														setPicking(null);
													}}
													title={item.name}
													aria-pressed={f.file === item.file}
													className={`relative aspect-[9/16] overflow-hidden rounded-md border-2 bg-black ${f.file === item.file ? "border-[#4D8DBA]" : "border-transparent hover:border-foreground/30"}`}
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
									</div>
									{f.back === "file" && f.file && (
										// The picture or clip's size and place (frameBackPlace): it fills the screen until changed (coach 25 Nov).
										<>
											<div className="flex gap-1.5">
												<button onClick={() => update(f.id, { backSize: wholeBackSize(ratios[f.file!], screen.width / screen.height), backX: 0, backY: 0, backRotate: undefined })} disabled={!ratios[f.file]} title="Make it small enough to see all of it" className={`${PLAIN_BUTTON} disabled:opacity-40`}>
													Whole picture
												</button>
												<button onClick={() => update(f.id, { backSize: undefined, backX: undefined, backY: undefined, backRotate: undefined })} disabled={!frameBackMoved(f)} title="Cover the whole screen again (its edges may be cut off)" className={`${PLAIN_BUTTON} disabled:opacity-40`}>
													Fill screen
												</button>
											</div>
											{row("Size", range(f.backSize ?? 1, FRAME.back.size.min, FRAME.back.size.max, 0.01, percent(f.backSize ?? 1), (backSize) => update(f.id, { backSize })), () => update(f.id, { backSize: 1 }))}
											{row("Left / right", range(f.backX ?? 0, -FRAME.back.move, FRAME.back.move, 0.005, percent(f.backX ?? 0), (backX) => update(f.id, { backX })), () => update(f.id, { backX: 0 }))}
											{row("Up / down", range(f.backY ?? 0, -FRAME.back.move, FRAME.back.move, 0.005, percent(f.backY ?? 0), (backY) => update(f.id, { backY })), () => update(f.id, { backY: 0 }))}
											{row("Rotate", range(f.backRotate ?? 0, -FRAME.back.rotate, FRAME.back.rotate, 1, `${f.backRotate ?? 0}°`, (backRotate) => update(f.id, { backRotate: backRotate || undefined })), () => update(f.id, { backRotate: undefined }))}
											{frameBackMoved(f) && row("Around", swatches(BACK_COLORS, f.backColor, (backColor) => update(f.id, { backColor }), "Color around the picture"))}
										</>
									)}
									{f.back === "file" && f.file && (
										<BgMotionControl
											motion={f.backMotion}
											amount={f.backAmount}
											speed={f.backSpeed}
											onMotion={(backMotion) => update(f.id, { backMotion, backSpeed: startMotion(backMotion, f.backSpeed) })}
											onAmount={(backAmount) => update(f.id, { backAmount })}
											onSpeed={(backSpeed) => update(f.id, { backSpeed })}
										/>
									)}
									{f.back === "file" && f.media === "video" && (
										<div className="flex items-center gap-2 text-xs text-foreground/70">
											<span className="w-16 shrink-0">Sound</span>
											<ClipSound sound={f} onChange={(patch) => update(f.id, patch)} />
										</div>
									)}
									{f.back === "file" && f.media === "video" && f.file && <ClipTrim id={f.id} file={f.file} start={f.start} end={f.end} clipFrom={f.clipFrom} total={total} onChange={(patch) => update(f.id, patch)} />}
									{(f.back === "file" || !files.length) && (
										<span className="flex items-center gap-1 text-[11px] text-foreground/55" title="Add your pictures and clips in My files, then pick one here">
											<ImageIcon className="h-3 w-3 shrink-0" aria-hidden /> Pictures and clips: My files{library === null && " · Loading…"}
										</span>
									)}
								</>
							)}
						</TabGroup>

						<ToolGroup tone={1} title="Border">
							{row("Width", range(f.border, 0, FRAME.border.max, 1, `${f.border}px`, (border) => update(f.id, { border })))}
							{f.border > 0 && row("Color", swatches(BORDER_COLORS, f.borderColor, (borderColor) => update(f.id, { borderColor }), "Border color"))}
						</ToolGroup>
						<ToolGroup tone={1} title="When">
							{row(ON_TIMELINE, <TimeRange id={f.id} start={f.start} end={f.end} total={total} clock={ruler} onChange={(patch) => update(f.id, patch)} />)}
							<FadeSwitches item={f} onChange={(patch) => update(f.id, patch)} />
						</ToolGroup>

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
