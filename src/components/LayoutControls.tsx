"use client";

import { ArrowDown, ArrowLeft, ArrowLeftRight, ArrowUp, ChevronRight, Copy, Image as ImageIcon, Trash2, User } from "lucide-react";
import { useCallback, useState } from "react";
import { LIMITS } from "@/lib/subtitle-style";
import { LAYOUT, LAYOUT_COLORS, LAYOUT_DRAG, LAYOUT_ENTERS, LAYOUT_KINDS, type LayoutKind, layoutName, NEW_LAYOUT, type VideoLayout } from "@/lib/layout";
import { duplicateOf, layerPlace, moveLayer } from "@/lib/layers";
import { LIBRARY_ACCEPT, type LibraryItem } from "@/lib/media-library";
import { FilePicker, PickedFile, useLibrary } from "./FilePicker";
import { SubtitlesCard, type SubtitlesHere } from "./SubtitlesCard";
import { newClipSound } from "@/lib/clip-sound";
import { startMotion } from "@/lib/bg-motion";
import { BgMotionControl } from "./BgMotionControl";
import { ClipSound } from "./ClipSound";
import { ClipTrim } from "./ClipTrim";
import { ConfirmDelete } from "./ConfirmDelete";
import { Switch } from "./FadeSwitches";
import { MAIN_BUTTON, mainStyle, PICKED, PLAIN_BUTTON, TabGroup, ToolGroup } from "./ToolGroup";
import { type Clock, FINAL_CLOCK, ON_TIMELINE, rangeText, TimeRange } from "./TimeField";

type Props = {
	layouts: VideoLayout[];
	onChange: (layouts: VideoLayout[]) => void;
	now: () => number; // where the preview is, seconds of the final video
	total: number; // length of the final video, seconds
	focus: string | null; // a layout to open here
	onReveal?: (id: string, start: number) => void; // the blue line to its start
	ruler?: Clock; // the timeline ruler's clock, for the times shown here
	note?: string; // a file dropped on the video: being added to Import, or why it couldn't be
	libraryVersion?: number; // goes up when Import got a new file: the pictures here are asked for again
	onImportFile?: (file: File, id: string) => void; // a file from the computer: into Import, then into this layout's other part
	// Subtitles while it shows (coach 20 Nov, placeStretch in lib/timeline.ts): their own height, or null = the rest's.
	subtitles?: SubtitlesHere;
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
export function LayoutControls({ layouts, onChange, now, total, focus, onReveal, note, libraryVersion = 0, onImportFile, ruler = FINAL_CLOCK, subtitles }: Props) {
	const [open, setOpen] = useState<string | null>(focus);
	const [focused, setFocused] = useState(focus);
	if (focus !== focused) {
		setFocused(focus);
		setOpen(focus);
	}
	const [tab, setTab] = useState<"you" | "other">("you"); // under Layout: You, or the Other part (coach 22 Nov)
	const [picking, setPicking] = useState<string | null>(null); // the layout whose pictures are open to change (Other part)
	const [removing, setRemoving] = useState<{ name: string; remove: () => void } | null>(null);
	const closeRemoving = useCallback(() => setRemoving(null), []);
	// The pictures and clips for the other part. A new file in Import (libraryVersion went up): a list from after it.
	const [library] = useLibrary(libraryVersion);
	const files = (library ?? []).filter((i) => i.media === "image" || /\.mp4$/.test(i.file));

	const update = (id: string, patch: Partial<VideoLayout>) => onChange(layouts.map((l) => (l.id === id ? { ...l, ...patch } : l)));
	// A clip: quietly on at first, so people hear it plays (as Frame Me, coach 12 Nov). A picture has no sound.
	const pickFile = (l: VideoLayout, item: LibraryItem) => update(l.id, { file: item.file, media: item.media, clipFrom: undefined, fileZoom: undefined, fileX: undefined, fileY: undefined, fileRotate: undefined, fileMotion: undefined, fileMotionZoom: undefined, ...(item.media === "video" && l.volume === undefined && !l.muted ? newClipSound("video") : {}) });
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
	// A copy right after it, opened (coach, 14 Nov: the same in every box).
	// Fade in / Fade out (coach 26 Nov): that end fades, whatever the Transition does at the other. Under "Fade" both are
	// on; switching one off leaves the other end fading and this one cut. Both on over "Cut" is "Fade".
	const setFade = (l: VideoLayout, end: "in" | "out", on: boolean) => {
		const now = { in: l.enter === "fade" || Boolean(l.inFade), out: l.enter === "fade" || Boolean(l.outFade), [end]: on };
		const plain = l.enter === "fade" || l.enter === "cut";
		if (plain && now.in && now.out) return update(l.id, { enter: "fade", inFade: undefined, outFade: undefined });
		update(l.id, { ...(plain && { enter: "cut" as const }), inFade: now.in || undefined, outFade: now.out || undefined });
	};
	const duplicate = (l: VideoLayout) => {
		const copy = duplicateOf(l, total);
		onChange([...layouts, copy]);
		pick(copy);
	};
	const remove = (l: VideoLayout) => setRemoving({ name: layoutName(l), remove: () => onChange(layouts.filter((x) => x.id !== l.id)) });

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
										{rangeText(l.start, l.end, ruler)}
									</span>
								</button>
								{trash(l)}
							</div>
						))}
				</>
			)}

			{openLayout &&
				[openLayout].map((l) => {
					const current = l.file ? files.find((i) => i.file === l.file) : undefined;
					const choosing = !l.file || picking === l.id;
					return (
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
								{(() => {
										const place = layerPlace(layouts, l.id);
										return (
											<>
												<span className="shrink-0 text-[11px] text-foreground/60" title="Its layer among the things showing with it">
													{place ? `${place.at}/${place.of}` : "1/1"}
												</span>
												<button onClick={() => onChange(moveLayer(layouts, l.id, true))} disabled={!place || place.at === place.of} title={place ? "Bring it in front of the one over it" : "Nothing else shows at the same time"} aria-label="Bring forward" className="rounded p-1 text-foreground/50 hover:bg-foreground/5 hover:text-foreground disabled:opacity-30">
													<ArrowUp className="h-3.5 w-3.5" aria-hidden />
												</button>
												<button onClick={() => onChange(moveLayer(layouts, l.id, false))} disabled={!place || place.at === 1} title={place ? "Send it behind the one under it" : "Nothing else shows at the same time"} aria-label="Send backward" className="rounded p-1 text-foreground/50 hover:bg-foreground/5 hover:text-foreground disabled:opacity-30">
													<ArrowDown className="h-3.5 w-3.5" aria-hidden />
												</button>
											</>
										);
									})()}
									<button onClick={() => duplicate(l)} disabled={layouts.length >= LAYOUT.maxItems} aria-label="Duplicate" title="Duplicate: a copy right after it (Ctrl+D on the timeline)" className="rounded p-1 text-foreground/50 hover:bg-foreground/5 hover:text-foreground disabled:opacity-30">
									<Copy className="h-3.5 w-3.5" aria-hidden />
								</button>
								{trash(l)}
							</div>
						</div>
						

						<ToolGroup tone={2} title="Layout">
							{/* With the playhead moved off this layout, a kind is a new layout there, as in Frame Me (coach, 17 Nov:
							    picking one with another layout's box open turned that one into it, so it was gone from where it was). */}
							<div title="With the video moved off this layout, a kind adds a new layout there">
								{kinds(l.kind, (kind) => {
									const at = now();
									if ((at < l.start || at > l.end) && layouts.length < LAYOUT.maxItems) add(kind);
									else update(l.id, { kind });
								})}
							</div>
							{row("Your part", range(l.split, LAYOUT.split.min, LAYOUT.split.max, 0.01, percent(l.split), (split) => update(l.id, { split })))}
							<button onClick={() => update(l.id, { meFirst: !l.meFirst })} className={`self-start ${MAIN_BUTTON}`} style={mainStyle(2)}>
								<ArrowLeftRight className="h-3.5 w-3.5" aria-hidden /> Swap sides
							</button>
						</ToolGroup>

						<TabGroup
							tone={3}
							value={tab}
							onChange={setTab}
							tabs={[
								{ id: "you", label: "You", icon: <User className="h-5 w-5" aria-hidden /> },
								{ id: "other", label: "Other part", icon: <ImageIcon className="h-5 w-5" aria-hidden /> },
							]}
						>
							{tab === "you" && (
								<>
									<span className="text-[11px] text-foreground/60">Pause, then drag yourself on the video</span>
							{/* meX / meY: the point of you in your part's middle. Sliding right moves you right, so it goes down. */}
							{/* Zoom: you bigger or smaller; what you then don't cover shows a blurred, dimmed copy of yourself. Setting it frees you to move both ways and past your own edge. */}
							{row("Zoom", range(l.meZoom ?? 1, LAYOUT.meZoom.min, LAYOUT.meZoom.max, 0.01, percent(l.meZoom ?? 1), (meZoom) => update(l.id, { meZoom })))}
							{(l.meZoom !== undefined || l.kind === "side") && row("Left / right", range(1 - l.meX, l.meZoom !== undefined ? 1 - LAYOUT.meRange.max : 0, l.meZoom !== undefined ? 1 - LAYOUT.meRange.min : 1, 0.005, percent(1 - l.meX), (v) => update(l.id, { meX: Math.round((1 - v) * 1000) / 1000 })), () => update(l.id, { meX: LAYOUT.me.x }))}
							{(l.meZoom !== undefined || l.kind !== "side") && row("Up / down", range(1 - l.meY, l.meZoom !== undefined ? 1 - LAYOUT.meRange.max : 0, l.meZoom !== undefined ? 1 - LAYOUT.meRange.min : 1, 0.005, percent(1 - l.meY), (v) => update(l.id, { meY: Math.round((1 - v) * 1000) / 1000 })), () => update(l.id, { meY: LAYOUT.me.y }))}
							<button onClick={() => update(l.id, { meX: LAYOUT.me.x, meY: LAYOUT.me.y, ...(l.meZoom !== undefined && { meZoom: LAYOUT.meZoom.start }) })} className={`self-start ${PLAIN_BUTTON}`}>
								Center me
							</button>
						</>
							)}
							{tab === "other" && (
								<>
							{/* Picked: one row (its picture, its name, Change); the pictures to pick from open only on Change (coach 22 Nov: it was crowded). */}
							<>
										<div className="relative flex flex-col gap-1.5">
										{l.file && <PickedFile file={l.file} media={l.media === "video" ? "video" : "image"} name={current?.name ?? (l.media === "video" ? "Clip" : "Picture")} open={picking === l.id} onToggle={() => setPicking(picking === l.id ? null : l.id)} />}
										{choosing && (
											<FilePicker
												floating={Boolean(l.file)}
												items={library && files}
												current={l.file}
												onPick={(item) => {
													pickFile(l, item);
													setPicking(null);
												}}
												// Can also be dragged onto the video (PlayerFrame drops it in the other part).
												onDragStart={(e, item) => {
													e.dataTransfer.setData(LAYOUT_DRAG, JSON.stringify({ file: item.file, media: item.media }));
													e.dataTransfer.effectAllowed = "copy";
												}}
												upload={
													onImportFile && {
														accept: LIBRARY_ACCEPT,
														onFile: (file) => {
															setPicking(null);
															onImportFile(file, l.id);
														},
													}
												}
												footer={
													<div className="flex flex-wrap items-center gap-1">
														{l.file && (
															<button onClick={() => update(l.id, { file: undefined, media: undefined, volume: undefined, muted: undefined })} className={PLAIN_BUTTON}>
																Use a color
															</button>
														)}
														<span className="flex items-center gap-1 text-[11px] text-foreground/55" title="Or drag one onto the video">
															<ImageIcon className="h-3 w-3 shrink-0" aria-hidden /> or drop on the video
														</span>
													</div>
												}
											/>
										)}
									</div>
</>
							{!l.file && (
								<div className="flex flex-wrap items-center gap-1">
									{LAYOUT_COLORS.map((c) => (
										<button key={c} onClick={() => update(l.id, { color: c })} aria-label={`Color ${c}`} className={`h-5 w-5 rounded-full border-2 ${l.color === c ? "border-[#4D8DBA]" : "border-foreground/20"}`} style={{ background: c }} />
									))}
									<input type="color" value={l.color} onChange={(e) => update(l.id, { color: e.target.value.toUpperCase() })} aria-label="Any color" className="h-5 w-7 cursor-pointer rounded border border-foreground/20 bg-transparent" />
								</div>
							)}
							{l.file && (
								// Its size and which bit of it shows (coach, 14 Nov). fileX / fileY: the point of it in the part's middle,
								// so sliding right moves it right and the number goes down. Drag it on the video too.
								<>
									{row("Size", range(l.fileZoom ?? 1, LAYOUT.fileZoom.min, LAYOUT.fileZoom.max, 0.01, percent(l.fileZoom ?? 1), (fileZoom) => update(l.id, { fileZoom })))}
									<BgMotionControl
										motion={l.fileMotion}
										amount={l.fileMotionZoom}
										speed={l.fileMotionSpeed}
										onMotion={(fileMotion) => update(l.id, { fileMotion, fileMotionSpeed: startMotion(fileMotion, l.fileMotionSpeed) })}
										onAmount={(fileMotionZoom) => update(l.id, { fileMotionZoom })}
										onSpeed={(fileMotionSpeed) => update(l.id, { fileMotionSpeed })}
									/>
									{row("Left / right", range(1 - (l.fileX ?? 0.5), 0, 1, 0.005, percent(1 - (l.fileX ?? 0.5)), (v) => update(l.id, { fileX: Math.round((1 - v) * 1000) / 1000 })), () => update(l.id, { fileX: undefined }))}
									{row("Up / down", range(1 - (l.fileY ?? 0.5), 0, 1, 0.005, percent(1 - (l.fileY ?? 0.5)), (v) => update(l.id, { fileY: Math.round((1 - v) * 1000) / 1000 })), () => update(l.id, { fileY: undefined }))}
									{row("Rotate", range(l.fileRotate ?? 0, -LAYOUT.fileRotate, LAYOUT.fileRotate, 1, `${l.fileRotate ?? 0}°`, (fileRotate) => update(l.id, { fileRotate: fileRotate || undefined })), () => update(l.id, { fileRotate: undefined }))}
									<span className="text-[11px] text-foreground/55" title="It always fills its part, so it moves only where it is bigger than the part: make it bigger to move it both ways.">
										Pause, then drag it. Bigger than the part to move it.
									</span>
									<button onClick={() => update(l.id, { fileZoom: undefined, fileX: undefined, fileY: undefined, fileRotate: undefined })} className={`self-start ${PLAIN_BUTTON}`}>
										Fit and center
									</button>
								</>
							)}
							{l.file && l.media === "video" && (
								<div className="flex items-center gap-2 text-xs text-foreground/70">
									<span className="w-16 shrink-0">Sound</span>
									<ClipSound sound={l} onChange={(patch) => update(l.id, patch)} />
								</div>
							)}
							{l.file && l.media === "video" && <ClipTrim id={l.id} file={l.file} start={l.start} end={l.end} clipFrom={l.clipFrom} total={total} onChange={(patch) => update(l.id, patch)} />}
								</>
							)}
						</TabGroup>

						<ToolGroup tone={1} title="Transition">
							<div role="radiogroup" aria-label="Transition" className="grid grid-cols-4 gap-1 rounded-lg bg-foreground/5 p-0.5">
								{LAYOUT_ENTERS.map((e) => (
									<button
										key={e.id}
										role="radio"
										aria-checked={l.enter === e.id}
										onClick={() => update(l.id, e.id === "fade" ? { enter: e.id, inFade: undefined, outFade: undefined } : { enter: e.id })}
										title={`${e.note}, at the start and the end`}
										className={`rounded-md px-1.5 py-1 text-xs whitespace-nowrap ${l.enter === e.id ? PICKED : "text-foreground/70 hover:text-foreground"}`}
									>
										{e.name}
									</button>
								))}
							</div>
							<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-foreground/70" title="On: that end fades instead">
									<Switch on={l.enter === "fade" || Boolean(l.inFade)} label="Fade in" onChange={(on) => setFade(l, "in", on)} />
									<Switch on={l.enter === "fade" || Boolean(l.outFade)} label="Fade out" onChange={(on) => setFade(l, "out", on)} />
								</div>
							</ToolGroup>

						{subtitles && (
							<SubtitlesCard item={l} subtitles={subtitles} tone={2}>
								{l.kind === "stack" && (
									// The line between the two parts, from the bottom.
									<button onClick={() => subtitles.set(l, Math.min(LIMITS.position.max, Math.max(LIMITS.position.min, Math.round(((l.meFirst ? 1 - l.split : l.split) - 0.03) * 1000) / 1000)))} className={PLAIN_BUTTON}>
										On the line between
									</button>
								)}
							</SubtitlesCard>
						)}
						<ToolGroup tone={1} title="When">
							{row(ON_TIMELINE, <TimeRange id={l.id} start={l.start} end={l.end} total={total} clock={ruler} onChange={(patch) => update(l.id, patch)} />)}
						</ToolGroup>

					</div>
				);
				})}

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
