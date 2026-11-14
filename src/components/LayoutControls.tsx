"use client";

import { ArrowLeft, ArrowLeftRight, ChevronRight, Film, Image as ImageIcon, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { LAYOUT, LAYOUT_COLORS, LAYOUT_DRAG, LAYOUT_ENTERS, LAYOUT_KINDS, type LayoutKind, layoutName, NEW_LAYOUT, type VideoLayout } from "@/lib/layout";
import { layerPlace, moveLayer } from "@/lib/layers";
import { type LibraryItem, projectFileSrc } from "@/lib/media-library";
import { newClipSound } from "@/lib/clip-sound";
import { ClipSound } from "./ClipSound";
import { ConfirmDelete } from "./ConfirmDelete";
import { LayerTools } from "./LayerTools";

type Props = {
	layouts: VideoLayout[];
	onChange: (layouts: VideoLayout[]) => void;
	now: () => number; // where the preview is, seconds of the final video
	total: number; // length of the final video, seconds
	focus: string | null; // a layout to open here
	onReveal?: (id: string, start: number) => void; // the blue line to its start
	note?: string; // a file dropped on the video: being added to Import, or why it couldn't be
	libraryVersion?: number; // goes up when Import got a new file: the pictures here are asked for again
};

const round = (n: number) => Math.round(n * 10) / 10;

// The layout as a small picture: the speaker's part filled, the other part outlined.
function KindIcon({ kind, meFirst = true, split = 0.5, size = 22 }: { kind: LayoutKind; meFirst?: boolean; split?: number; size?: number }) {
	const [w, h] = [size * 0.62, size];
	const x0 = (size - w) / 2;
	const mine = kind === "stack" ? { x: x0, y: meFirst ? 0 : h * (1 - split), w, h: h * split } : { x: meFirst ? x0 : x0 + w * (1 - split), y: 0, w: w * split, h };
	return (
		<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
			<rect x={x0 + 0.5} y={0.5} width={w - 1} height={h - 1} rx={2} fill="none" stroke="currentColor" opacity={0.6} />
			<rect x={mine.x + 0.5} y={mine.y + 0.5} width={mine.w - 1} height={mine.h - 1} rx={2} fill="currentColor" opacity={0.85} />
		</svg>
	);
}

// The editor's Layout box (coach, 14 Nov): for a stretch of the video, the screen is split, you in one part and a
// picture or clip from Import in the other, top / bottom or side by side, sliding in or with a flash.
// Drawn by PlayerFrame, made by layout_filters (render.py).
export function LayoutControls({ layouts, onChange, now, total, focus, onReveal, note, libraryVersion = 0 }: Props) {
	const [open, setOpen] = useState<string | null>(focus);
	const [focused, setFocused] = useState(focus);
	if (focus !== focused) {
		setFocused(focus);
		setOpen(focus);
	}
	const [removing, setRemoving] = useState<{ name: string; remove: () => void } | null>(null);
	const closeRemoving = useCallback(() => setRemoving(null), []);
	// The project's pictures and clips (Import), for the other part. Asked for once the box opens.
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
	}, [libraryVersion]);
	const files = (library ?? []).filter((i) => i.media === "image" || /\.mp4$/.test(i.file));

	const update = (id: string, patch: Partial<VideoLayout>) => onChange(layouts.map((l) => (l.id === id ? { ...l, ...patch } : l)));
	// A clip: quietly on at first, so people hear it plays (as Frame Me, coach 12 Nov). A picture has no sound.
	const pickFile = (l: VideoLayout, item: LibraryItem) => update(l.id, { file: item.file, media: item.media, fileZoom: undefined, fileX: undefined, fileY: undefined, ...(item.media === "video" && l.volume === undefined && !l.muted ? newClipSound("video") : {}) });
	const add = (kind: LayoutKind) => {
		const start = round(Math.min(now(), Math.max(0, total - 1)));
		const layout = NEW_LAYOUT(start, round(Math.min(total, start + LAYOUT.seconds)), kind);
		// The project's newest picture or clip in the other part at once, so it shows something there.
		const first = files[0];
		const ready = first ? { ...layout, file: first.file, media: first.media, ...newClipSound(first.media) } : layout;
		onChange([...layouts, ready]); // on top of the others (lib/layers.ts)
		setOpen(layout.id);
		onReveal?.(layout.id, start);
	};
	const pick = (l: VideoLayout) => {
		setOpen(l.id);
		onReveal?.(l.id, l.start);
	};
	const moveHere = (l: VideoLayout) => {
		const seconds = l.end - l.start;
		const start = round(Math.max(0, Math.min(now(), total - seconds)));
		update(l.id, { start, end: round(Math.min(total, start + seconds)) });
		onReveal?.(l.id, start);
	};
	const remove = (l: VideoLayout) => setRemoving({ name: layoutName(l), remove: () => onChange(layouts.filter((x) => x.id !== l.id)) });

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
	const percent = (n: number) => `${Math.round(n * 100)}%`;
	const trash = (l: VideoLayout) => (
		<button onClick={() => remove(l)} aria-label={`Delete ${layoutName(l)}`} title="Delete" className="rounded p-1 text-foreground/50 hover:bg-red-500/10 hover:text-red-600">
			<Trash2 className="h-3.5 w-3.5" aria-hidden />
		</button>
	);
	const kinds = (value: LayoutKind | null, set: (kind: LayoutKind) => void, disabled = false) => (
		<div className="grid grid-cols-2 gap-1">
			{LAYOUT_KINDS.map((k) => (
				<button
					key={k.id}
					onClick={() => set(k.id)}
					disabled={disabled}
					aria-pressed={value === k.id}
					className={`flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs disabled:opacity-40 ${value === k.id ? "border-blue-600 bg-blue-600/10" : "border-foreground/20 hover:bg-foreground/5"}`}
				>
					<KindIcon kind={k.id} />
					{k.name}
				</button>
			))}
		</div>
	);

	const openLayout = layouts.find((l) => l.id === open);

	return (
		<div className="flex flex-col gap-2 p-3 pt-1">
			{note && <p className="rounded-md bg-blue-500/10 px-2 py-1 text-xs">{note}</p>}
			{!openLayout && (
				<>
					<p className="text-xs text-foreground/60">Split the screen: you in one part, your own picture or clip in the other. Nothing is cut out, so it&apos;s ready right away. Or drop a picture or clip on the video.</p>
					<span className="text-xs font-medium text-foreground/80">Add a layout where the video is now</span>
					{kinds(null, add, layouts.length >= LAYOUT.maxItems)}
					{layouts.length >= LAYOUT.maxItems && <p className="text-xs text-foreground/60">That&apos;s the most layouts one video can have.</p>}
					{[...layouts]
						.sort((a, b) => a.start - b.start)
						.map((l) => (
							<div key={l.id} className="flex items-center gap-1 rounded-lg border border-foreground/15 px-2 py-1">
								<button onClick={() => pick(l)} title="Open its settings" className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm">
									<ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
									<span className="shrink-0 text-foreground/60">
										<KindIcon kind={l.kind} meFirst={l.meFirst} split={l.split} size={16} />
									</span>
									<span className="truncate">{layoutName(l)}</span>
									<span className="shrink-0 text-xs text-foreground/50 tabular-nums">
										{l.start}–{l.end}s
									</span>
								</button>
								{trash(l)}
							</div>
						))}
				</>
			)}

			{openLayout &&
				[openLayout].map((l) => (
					<div key={l.id} className="flex flex-col gap-2">
						<div className="flex flex-col gap-1">
							<button onClick={() => setOpen(null)} className="inline-flex items-center gap-1 self-start rounded-md px-1 py-0.5 text-xs text-foreground/70 hover:bg-foreground/5 hover:text-foreground">
								<ArrowLeft className="h-3.5 w-3.5" aria-hidden /> All layouts
							</button>
							<div className="flex items-center gap-1.5">
								<span className="text-foreground/60">
									<KindIcon kind={l.kind} meFirst={l.meFirst} split={l.split} size={16} />
								</span>
								<input
									value={l.name ?? ""}
									placeholder={layoutName({ ...l, name: undefined })}
									maxLength={40}
									onChange={(e) => update(l.id, { name: e.target.value.replace(/[\n\r\t]/g, " ") || undefined })}
									aria-label="Name on the timeline"
									title="Name on the timeline"
									className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-sm font-medium placeholder:text-foreground placeholder:opacity-100 hover:border-foreground/20 focus:border-foreground/30 focus:outline-none"
								/>
								{trash(l)}
							</div>
						</div>
						<LayerTools onMoveHere={() => moveHere(l)} onUp={() => onChange(moveLayer(layouts, l.id, true))} onDown={() => onChange(moveLayer(layouts, l.id, false))} place={layerPlace(layouts, l.id)} />
						<p className="text-xs text-foreground/60">Pause the video to drag yourself inside your part.</p>

						<div className="flex flex-col gap-1.5 rounded-lg border border-foreground/15 p-2">
							<span className="text-xs font-medium text-foreground/80">Layout</span>
							{kinds(l.kind, (kind) => update(l.id, { kind }))}
							<button onClick={() => update(l.id, { meFirst: !l.meFirst })} className="inline-flex items-center gap-1 self-start rounded-md border border-foreground/20 px-2 py-0.5 text-xs hover:bg-foreground/5">
								<ArrowLeftRight className="h-3.5 w-3.5" aria-hidden /> Swap sides
							</button>
							{row(
								"Shows",
								<span className="flex items-center gap-1">
									<input type="number" min={0} max={total} step={0.1} value={l.start} onChange={(e) => update(l.id, { start: round(Math.max(0, Number(e.target.value))) })} className="w-16 rounded border border-foreground/20 bg-background px-1" aria-label="From second" />
									to
									<input type="number" min={0} max={total} step={0.1} value={l.end} onChange={(e) => update(l.id, { end: round(Math.min(total, Number(e.target.value))) })} className="w-16 rounded border border-foreground/20 bg-background px-1" aria-label="To second" />
									s
								</span>,
							)}
							{row("Your part", range(l.split, LAYOUT.split.min, LAYOUT.split.max, 0.01, percent(l.split), (split) => update(l.id, { split })))}
						</div>

						<div className="flex flex-col gap-1.5 rounded-lg border border-foreground/15 p-2">
							<span className="text-xs font-medium text-foreground/80">Transition</span>
							<div role="radiogroup" aria-label="Transition" className="grid grid-cols-3 gap-1 rounded-lg bg-foreground/5 p-0.5">
								{LAYOUT_ENTERS.map((e) => (
									<button
										key={e.id}
										role="radio"
										aria-checked={l.enter === e.id}
										onClick={() => update(l.id, { enter: e.id })}
										title={e.note}
										className={`rounded-md px-1.5 py-1 text-xs whitespace-nowrap ${l.enter === e.id ? "bg-blue-400/15 font-medium ring-1 ring-inset ring-blue-400" : "text-foreground/70 hover:text-foreground"}`}
									>
										{e.name}
									</button>
								))}
							</div>
							<p className="text-xs text-foreground/60">{LAYOUT_ENTERS.find((e) => e.id === l.enter)?.note}, at the start and the end.</p>
						</div>

						<div className="flex flex-col gap-1.5 rounded-lg border border-foreground/15 p-2">
							<span className="text-xs font-medium text-foreground/80">You in your part</span>
							{/* meX / meY: the point of you in your part's middle. Sliding right moves you right, so it goes down. */}
							{l.kind === "side"
								? row("Left / right", range(1 - l.meX, 0, 1, 0.005, percent(1 - l.meX), (v) => update(l.id, { meX: Math.round((1 - v) * 1000) / 1000 })))
								: row("Up / down", range(1 - l.meY, 0, 1, 0.005, percent(1 - l.meY), (v) => update(l.id, { meY: Math.round((1 - v) * 1000) / 1000 })))}
							<button onClick={() => update(l.id, { meX: LAYOUT.me.x, meY: LAYOUT.me.y })} className="self-start rounded-md border border-foreground/20 px-2 py-0.5 text-xs hover:bg-foreground/5">
								Center me
							</button>
						</div>

						<div className="flex flex-col gap-1.5 rounded-lg border border-foreground/15 p-2">
							<span className="text-xs font-medium text-foreground/80">The other part</span>
							<div className="grid grid-cols-4 gap-1">
								{files.map((item) => (
									<button
										key={item.file}
										onClick={() => pickFile(l, item)}
										draggable
										// Can also be dragged onto the video (PlayerFrame drops it in the other part).
										onDragStart={(e) => {
											e.dataTransfer.setData(LAYOUT_DRAG, JSON.stringify({ file: item.file, media: item.media }));
											e.dataTransfer.effectAllowed = "copy";
										}}
										title={item.name}
										aria-pressed={l.file === item.file}
										className={`relative aspect-[9/16] overflow-hidden rounded-md border-2 bg-black ${l.file === item.file ? "border-blue-600" : "border-transparent hover:border-foreground/30"}`}
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
							{l.file && (
								// Its size and which bit of it shows (coach, 14 Nov). fileX / fileY: the point of it in the part's middle,
								// so sliding right moves it right and the number goes down. Drag it on the video too.
								<div className="flex flex-col gap-1.5 rounded-md bg-foreground/5 p-1.5">
									{row("Size", range(l.fileZoom ?? 1, LAYOUT.fileZoom.min, LAYOUT.fileZoom.max, 0.01, percent(l.fileZoom ?? 1), (fileZoom) => update(l.id, { fileZoom })))}
									{row("Left / right", range(1 - (l.fileX ?? 0.5), 0, 1, 0.005, percent(1 - (l.fileX ?? 0.5)), (v) => update(l.id, { fileX: Math.round((1 - v) * 1000) / 1000 })))}
									{row("Up / down", range(1 - (l.fileY ?? 0.5), 0, 1, 0.005, percent(1 - (l.fileY ?? 0.5)), (v) => update(l.id, { fileY: Math.round((1 - v) * 1000) / 1000 })))}
									<p className="text-xs text-foreground/60">Pause the video and drag your picture to move it. It always fills its part, so it moves only where it is bigger than the part: make it bigger to move it both ways.</p>
									<button onClick={() => update(l.id, { fileZoom: undefined, fileX: undefined, fileY: undefined })} className="self-start rounded-md border border-foreground/20 px-2 py-0.5 text-xs hover:bg-foreground/5">
										Fit and center
									</button>
								</div>
							)}
							{l.file && (
								<button onClick={() => update(l.id, { file: undefined, media: undefined, volume: undefined, muted: undefined })} className="self-start rounded-md border border-foreground/20 px-2 py-0.5 text-xs hover:bg-foreground/5">
									Use a color instead
								</button>
							)}
							{!l.file && (
								<div className="flex flex-wrap items-center gap-1">
									{LAYOUT_COLORS.map((c) => (
										<button key={c} onClick={() => update(l.id, { color: c })} aria-label={`Color ${c}`} className={`h-5 w-5 rounded-full border-2 ${l.color === c ? "border-blue-600" : "border-foreground/20"}`} style={{ background: c }} />
									))}
									<input type="color" value={l.color} onChange={(e) => update(l.id, { color: e.target.value.toUpperCase() })} aria-label="Any color" className="h-5 w-7 cursor-pointer rounded border border-foreground/20 bg-transparent" />
								</div>
							)}
							{l.file && l.media === "video" && (
								<div className="flex items-center gap-2 text-xs text-foreground/70">
									<span className="w-16 shrink-0">Sound</span>
									<ClipSound sound={l} onChange={(patch) => update(l.id, patch)} />
								</div>
							)}
							<p className="flex items-center gap-1 text-xs text-foreground/60">
								<ImageIcon className="h-3.5 w-3.5 shrink-0" aria-hidden /> Pick one here, drag it onto the video, or drop a picture or clip from your computer on the video.{library === null && " Loading…"}
							</p>
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
