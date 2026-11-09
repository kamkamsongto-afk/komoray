"use client";

import { ChevronDown, ChevronRight, ImagePlus, Plus, Type, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { BEHIND, BEHIND_FX, type BehindFx, type BehindSpeed, type BehindText, cleanBehindText, covered, type CutoutLayers, INSERT, type Insert, keptWindows } from "@/lib/behind";
import { clock, type CutoutTier, newSeconds, slowSeconds, type Window } from "@/lib/cutout";
import { EDGE_COLORS, FONTS, type FontId, TEXT_COLORS } from "@/lib/subtitle-style";
import type { Segment } from "@/lib/timeline";
import { type useCutout, waitLabel } from "@/lib/use-cutout";
import { Confirm, ConfirmDelete } from "./ConfirmDelete";

type Props = {
	focus: string | null; // the layer just clicked on the timeline: open it here
	layers: CutoutLayers;
	onChange: (layers: CutoutLayers) => void;
	cutout: ReturnType<typeof useCutout>;
	segments: Segment[];
	now: () => number; // where the preview is, seconds of the final video
	total: number; // length of the final video, seconds
	videoUrl: string | null; // the preview copy, which Fast and Balanced read on this device
	thai: boolean; // Thai video: only fonts with Thai letters
};

const round = (n: number) => Math.round(n * 10) / 10;

// Chosen before cutting out (coach, 9 Nov): Fast and Normal run on the customer's device and cost no GPU, Slow on ours.
// In the code they stay fast, balanced and best; people see these names.
const TIER_ORDER: CutoutTier[] = ["fast", "balanced", "best"];
const TIERS: Record<CutoutTier, { name: string; card: string; note: string }> = {
	fast: { name: "Fast", card: "Fast", note: "Ready in about the length of the video" },
	balanced: { name: "Normal", card: "Normal", note: "Cleaner edges. A few minutes for each minute" },
	best: { name: "Slow", card: "Slow (High Quality)", note: "Finest hair and edges. Close the page if you like" },
};
const SPEEDS: [BehindSpeed, string][] = [
	["slow", "Slow"],
	["normal", "Normal"],
	["fast", "Fast"],
];

// The editor's Cutout box: big text behind the speaker, and pictures or clips behind a smaller speaker.
// The speaker is cut out on a GPU only for the parts these cover, once they are where they should be
// (Cut out the speaker); moving one outside those parts asks for it again.
export function CutoutControls({ layers, onChange, cutout, segments, now, total, videoUrl, thai, focus }: Props) {
	const [open, setOpen] = useState<string | null>(focus);
	// A new layer clicked on the timeline opens here (set while drawing, not in an effect).
	const [focused, setFocused] = useState(focus);
	// Two lists instead of one long mixed one (coach, 9 Nov).
	const [tab, setTab] = useState<"text" | "inserts">(layers.inserts.some((i) => i.id === focus) || (!layers.texts.length && layers.inserts.length) ? "inserts" : "text");
	if (focus !== focused) {
		setFocused(focus);
		setOpen(focus);
		if (layers.inserts.some((i) => i.id === focus)) setTab("inserts");
		else if (layers.texts.some((t) => t.id === focus)) setTab("text");
	}
	const [removing, setRemoving] = useState<{ name: string; remove: () => void } | null>(null);
	const closeRemoving = useCallback(() => setRemoving(null), []);
	const [askSlow, setAskSlow] = useState(false);
	const closeAskSlow = useCallback(() => setAskSlow(false), []);
	const [changing, setChanging] = useState(false); // once cut out, the three qualities fold away until asked for
	const [uploading, setUploading] = useState(false);
	const [notice, setNotice] = useState("");
	const fileRef = useRef<HTMLInputElement>(null);

	const [choice, setPicked] = useState<CutoutTier>("balanced");
	// A quality this device can't run is never the one picked.
	const canRun = (id: CutoutTier) => id === "best" || cutout.support[id];
	const picked: CutoutTier = canRun(choice) ? choice : canRun("balanced") ? "balanced" : canRun("fast") ? "fast" : "best";
	const whole: Window[] = keptWindows(segments);
	const cutOut = cutout.status === "done";
	const ready = cutOut && covered(whole, cutout.windows);
	// covered, not newSeconds === 0: the kept video runs a tenth of a second past the end, the server's windows stop at it.
	const slowWindows = cutout.saved.best ?? [];
	const bestCost = covered(whole, slowWindows) ? 0 : newSeconds(whole, slowWindows);
	// Already made for this video and not the one in use: switching is a moment, and free.
	const isSaved = (id: CutoutTier) => whole.length > 0 && !(cutOut && cutout.tier === id) && covered(whole, cutout.saved[id] ?? []);
	const pickedSaved = isSaved(picked);
	const bestLeft = Math.max(0, cutout.best.limit - cutout.best.used);
	const tooMuch = picked === "best" && !cutout.best.unlimited && bestCost > bestLeft + 0.05;
	const same = cutOut && ready && picked === cutout.tier; // the same quality over the same video gives the same result
	const wait = waitLabel(cutout);
	const go = () => {
		setChanging(false);
		cutout.start(whole, picked, videoUrl);
	};
	const slowPart = cutout.timeLeft !== null ? Math.min(0.95, Math.max(0, 1 - cutout.timeLeft / slowSeconds(cutout.windows))) : 0;

	const setTexts = (texts: BehindText[]) => onChange({ ...layers, texts });
	const setInserts = (inserts: Insert[]) => onChange({ ...layers, inserts });
	const updateText = (id: string, patch: Partial<BehindText>) => setTexts(layers.texts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
	const updateInsert = (id: string, patch: Partial<Insert>) => setInserts(layers.inserts.map((i) => (i.id === id ? { ...i, ...patch } : i)));
	const startAt = () => round(Math.min(now(), Math.max(0, total - 1)));

	function addText() {
		const start = startAt();
		const text: BehindText = {
			id: crypto.randomUUID(),
			text: thai ? "ห้ามพลาด" : "DON'T MISS",
			start,
			end: round(Math.min(total, start + BEHIND.seconds)),
			font: thai ? "kanit" : "anton",
			size: BEHIND.size.start,
			color: "#FFFFFF",
			stroke: 8,
			strokeColor: "#000000",
			fx: "burst",
			speed: "normal",
			y: BEHIND.y,
		};
		setOpen(text.id);
		setTexts([...layers.texts, text].sort((a, b) => a.start - b.start));
	}

	async function addInsert(file: File) {
		setNotice("");
		setUploading(true);
		// A clip shows for as long as it plays (within what may be cut out); a picture for a few seconds.
		const clipSeconds = file.type.startsWith("video/") ? await clipLength(file) : null;
		const done = await cutout.upload(file);
		setUploading(false);
		if ("error" in done) return setNotice(done.error);
		const start = startAt();
		const seconds = Math.min(clipSeconds ?? BEHIND.seconds, total - start);
		const insert: Insert = { id: crypto.randomUUID(), kind: done.kind, file: done.file, start, end: round(start + Math.max(0.5, seconds)), speakerScale: INSERT.scale.start, speakerX: 0.25, hidden: false };
		setOpen(insert.id);
		setTab("inserts");
		setInserts([...layers.inserts, insert].sort((a, b) => a.start - b.start));
	}

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
	const times = (item: { start: number; end: number }, set: (patch: { start?: number; end?: number }) => void) =>
		row(
			"Shows",
			<span className="flex items-center gap-1">
				<input type="number" min={0} max={total} step={0.1} value={item.start} onChange={(e) => set({ start: round(Math.max(0, Number(e.target.value))) })} className="w-16 rounded border border-foreground/20 bg-background px-1" aria-label="From second" />
				to
				<input type="number" min={0} max={total} step={0.1} value={item.end} onChange={(e) => set({ end: round(Math.min(total, Number(e.target.value))) })} className="w-16 rounded border border-foreground/20 bg-background px-1" aria-label="To second" />
				s
			</span>,
		);

	if (!cutout.on) {
		return <p className="p-3 text-sm text-foreground/70">Cutout isn&apos;t turned on for your account yet. Email hello@komoray.com to try it.</p>;
	}

	return (
		<div className="flex flex-col gap-2 p-3 pt-1">
			<p className="text-xs text-foreground/60">Put big text behind you, or a picture or clip behind a smaller you.</p>
			<div className={`flex flex-col gap-2 rounded-lg border p-2 text-xs ${cutOut ? "border-green-600/40 bg-green-600/10" : "border-blue-600/40 bg-blue-600/10"}`}>
				{cutout.restoring ? (
					<span>Switching to {TIERS[cutout.restoring].name}…</span>
				) : cutout.local ? (
					<>
						<span className="flex items-baseline justify-between gap-2">
							<span>{cutout.local.phase === "sending" ? "Saving your cutout…" : `Cutting you out on this device… ${Math.round(cutout.local.part * 100)}%`}</span>
							<span className="shrink-0 font-medium tabular-nums">{wait}</span>
						</span>
						<div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
							<div className="h-full bg-blue-600 transition-[width]" style={{ width: `${Math.round(cutout.local.part * 100)}%` }} />
						</div>
						<span className="text-foreground/70">Keep this page open. Your text moves behind you when this finishes.</span>
						{cutout.local.phase === "cutting" && (
							<button onClick={cutout.cancel} className="self-start rounded-md border border-foreground/20 px-2 py-0.5 hover:bg-foreground/5">
								Cancel
							</button>
						)}
					</>
				) : cutout.status === "processing" ? (
					cutout.tier === "best" ? (
						<>
							<span className="flex items-baseline justify-between gap-2">
								<span>Slow is cutting you out…</span>
								<span className="shrink-0 font-medium tabular-nums">{wait}</span>
							</span>
							<div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
								<div className="h-full bg-blue-600 transition-[width]" style={{ width: `${Math.round(slowPart * 100)}%` }} />
							</div>
							<span className="text-foreground/70">You can keep editing or close this page. Your text moves behind you when this finishes.</span>
						</>
					) : (
						<span>Almost done, putting your cutout together…</span>
					)
				) : cutOut && ready && !changing ? (
					<span className="flex items-center justify-between gap-2">
						<span>You&apos;re cut out with {TIERS[cutout.tier ?? "best"].name}. Your text and pictures go behind you.</span>
						<button onClick={() => setChanging(true)} className="shrink-0 rounded-md border border-foreground/20 px-2 py-0.5 hover:bg-foreground/5">
							Change quality
						</button>
					</span>
				) : (
					<>
						<span>
							{cutOut && ready
								? `You're cut out with ${TIERS[cutout.tier ?? "best"].name}. Choose another quality to cut again.`
								: cutOut
									? "Part of your video has changed since you were cut out. Cut me out again to cover it."
									: cutout.status === "failed"
										? (cutout.error ?? "The cutout failed. Please try again.")
										: "Choose a quality, then press Cut me out. Your text stays in front of you until it finishes."}
						</span>
						<div className="grid gap-1 sm:grid-cols-3" role="radiogroup" aria-label="Cutout quality">
							{TIER_ORDER.map((id) => {
								const off = !canRun(id);
								return (
									<button
										key={id}
										role="radio"
										aria-checked={picked === id}
										disabled={off}
										onClick={() => setPicked(id)}
										className={`rounded-md border p-1.5 text-left disabled:opacity-40 ${picked === id ? "border-blue-600 bg-blue-600/10" : "border-foreground/20 hover:bg-foreground/5"}`}
									>
										<span className="block text-sm font-medium">{TIERS[id].card}</span>
										<span className="block text-[11px] leading-4 text-foreground/60">{cutOut && cutout.tier === id ? "In use now" : isSaved(id) ? "Saved. Switches right away" : off ? "This device can't run it" : TIERS[id].note}</span>
									</button>
								);
							})}
						</div>
						{pickedSaved && <span className="text-foreground/70">Your {TIERS[picked].name} cutout is saved. It comes back right away{picked === "best" ? " and uses none of your minutes" : ""}.</span>}
						{picked === "best" && !pickedSaved && !same && !cutout.best.unlimited && (
							<span className="text-foreground/70">
								{tooMuch ? `Slow needs ${clock(bestCost)}, and you have ${clock(bestLeft)} left this month. Try Fast or Normal.` : `This will use ${clock(bestCost)} of your ${clock(bestLeft)} Slow left this month.`}
							</span>
						)}
						{picked !== "best" && !pickedSaved && !same && <span className="text-foreground/70">Runs on this device, so keep this page open until it finishes.</span>}
						{/* What a switch really does, read from /api/cutout: only one cutout is kept per video. */}
						{cutOut && ready && !same && (
							<span className="text-foreground/70">
								Your {TIERS[cutout.tier ?? "best"].name} cutout stays saved, so you can switch back any time.
								{picked === "best" && !pickedSaved ? " Your text shows in front of you again until Slow finishes." : ""}
							</span>
						)}
						<span className="flex items-center gap-2">
							<button
								// A second Slow on this video that has to make something new costs minutes again: ask first.
								onClick={() => (picked === "best" && (cutout.runs ?? 0) > 0 && bestCost > 0 ? setAskSlow(true) : go())}
								disabled={same || tooMuch || !whole.length || (picked !== "best" && !videoUrl)}
								className="rounded-md bg-blue-600 px-2.5 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
							>
								{pickedSaved ? `Switch to ${TIERS[picked].name}` : cutOut && ready ? "Cut me out again" : "Cut me out"}
							</button>
							{cutOut && ready && (
								<button onClick={() => setChanging(false)} className="rounded-md border border-foreground/20 px-2 py-1 hover:bg-foreground/5">
									Keep this one
								</button>
							)}
						</span>
						{picked !== "best" && !videoUrl && <span className="text-foreground/60">Your preview is still being made. This will work in a moment.</span>}
					</>
				)}
			</div>

			<div role="tablist" aria-label="Cutout layers" className="grid grid-cols-2 gap-1 rounded-lg bg-foreground/5 p-0.5">
				{(
					[
						["text", Type, "Text behind you", layers.texts.length],
						["inserts", ImagePlus, "Picture or clip", layers.inserts.length],
					] as const
				).map(([id, Icon, name, count]) => (
					<button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-sm ${tab === id ? "bg-background font-medium shadow-sm" : "text-foreground/70 hover:text-foreground"}`}>
						<Icon className="h-3.5 w-3.5 shrink-0" aria-hidden /> {name}
						{count > 0 && <span className="text-xs text-foreground/50 tabular-nums">{count}</span>}
					</button>
				))}
			</div>
			{notice && <p className="text-xs text-red-500">{notice}</p>}

			{tab === "text" && (
				<button onClick={addText} disabled={layers.texts.length >= BEHIND.maxItems} className="inline-flex items-center justify-center gap-1 rounded-md border border-dashed border-foreground/30 px-2 py-1 text-sm hover:bg-foreground/5 disabled:opacity-40">
					<Plus className="h-3.5 w-3.5" aria-hidden /> Add text
				</button>
			)}
			{tab === "inserts" && (
				<>
					<button onClick={() => fileRef.current?.click()} disabled={uploading || layers.inserts.length >= BEHIND.maxItems} className="inline-flex items-center justify-center gap-1 rounded-md border border-dashed border-foreground/30 px-2 py-1 text-sm hover:bg-foreground/5 disabled:opacity-40">
						<Plus className="h-3.5 w-3.5" aria-hidden /> {uploading ? "Uploading…" : "Add picture or clip"}
					</button>
					<input
						ref={fileRef}
						type="file"
						accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
						className="hidden"
						onChange={(e) => {
							const file = e.target.files?.[0];
							e.target.value = "";
							if (file) void addInsert(file);
						}}
					/>
				</>
			)}

			{tab === "text" && layers.texts.map((t) => (
				<div key={t.id} className="rounded-lg border border-foreground/15">
					<div className="flex items-center gap-1 px-2 py-1">
						<button onClick={() => setOpen(open === t.id ? null : t.id)} className="flex min-w-0 flex-1 items-center gap-1 text-left text-sm">
							{open === t.id ? <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />}
							<Type className="h-3.5 w-3.5 shrink-0 text-foreground/50" aria-hidden />
							<span className="truncate">{t.text}</span>
							<span className="shrink-0 text-xs text-foreground/50">
								{t.start}–{t.end}s
							</span>
						</button>
						<button onClick={() => setRemoving({ name: `"${t.text}"`, remove: () => setTexts(layers.texts.filter((x) => x.id !== t.id)) })} aria-label={`Delete ${t.text}`} className="rounded p-1 text-foreground/50 hover:bg-foreground/5 hover:text-foreground">
							<X className="h-3.5 w-3.5" aria-hidden />
						</button>
					</div>
					{open === t.id && (
						<div className="flex flex-col gap-1.5 border-t border-foreground/10 p-2">
							{row("Words", <input value={t.text} maxLength={BEHIND.maxText} onChange={(e) => updateText(t.id, { text: e.target.value })} onBlur={(e) => updateText(t.id, { text: cleanBehindText(e.target.value) || t.text })} className="min-w-0 flex-1 rounded border border-foreground/20 bg-background px-1.5 py-0.5 text-sm" />)}
							{row(
								"Effect",
								<select value={t.fx} onChange={(e) => updateText(t.id, { fx: e.target.value as BehindFx })} className="rounded border border-foreground/20 bg-background px-1 py-0.5">
									{Object.entries(BEHIND_FX).map(([id, name]) => (
										<option key={id} value={id}>
											{name}
										</option>
									))}
								</select>,
							)}
							{row(
								"Speed",
								<span className="flex gap-1">
									{SPEEDS.map(([id, name]) => (
										<button key={id} onClick={() => updateText(t.id, { speed: id })} className={`rounded border px-1.5 py-0.5 ${t.speed === id ? "border-blue-600 bg-blue-600/10" : "border-foreground/20"}`}>
											{name}
										</button>
									))}
								</span>,
							)}
							{row(
								"Font",
								<select value={t.font} onChange={(e) => updateText(t.id, { font: e.target.value as FontId })} className="rounded border border-foreground/20 bg-background px-1 py-0.5">
									{(Object.entries(FONTS) as [FontId, (typeof FONTS)[FontId]][])
										.filter(([, f]) => !thai || f.thai)
										.map(([id, f]) => (
											<option key={id} value={id}>
												{f.name}
											</option>
										))}
								</select>,
							)}
							{row("Size", range(t.size, BEHIND.size.min, BEHIND.size.max, 10, `${t.size}px`, (size) => updateText(t.id, { size })))}
							{row("Color", swatches(TEXT_COLORS, t.color, (color) => updateText(t.id, { color }), "Text color"))}
							{row("Outline", range(t.stroke, 0, BEHIND.stroke.max, 1, `${t.stroke}px`, (stroke) => updateText(t.id, { stroke })))}
							{t.stroke > 0 && row("Outline color", swatches(EDGE_COLORS, t.strokeColor, (strokeColor) => updateText(t.id, { strokeColor }), "Outline color"))}
							{row("Height", range(Math.round((1 - t.y) * 100), 3, 97, 1, `${Math.round((1 - t.y) * 100)}%`, (up) => updateText(t.id, { y: Math.round((1 - up / 100) * 1000) / 1000 })))}
							{times(t, (patch) => updateText(t.id, patch))}
						</div>
					)}
				</div>
			))}

			{tab === "inserts" && layers.inserts.length > 0 && (
				<div className="grid grid-cols-3 gap-1.5">
					{layers.inserts.map((i) => {
						const name = i.kind === "video" ? "Clip" : "Picture";
						const url = cutout.files[i.file];
						return (
							<div key={i.id} className={`relative overflow-hidden rounded-md border ${open === i.id ? "border-blue-600 ring-1 ring-blue-600" : "border-foreground/15"}`}>
								<button onClick={() => setOpen(open === i.id ? null : i.id)} aria-label={`${name} at ${i.start} seconds`} aria-expanded={open === i.id} className="block w-full text-left">
									<span className="flex aspect-square items-center justify-center bg-black/80">
										{!url ? (
											<ImagePlus className="h-5 w-5 text-white/50" aria-hidden />
										) : i.kind === "video" ? (
											<video src={`${url}#t=0.1`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
										) : (
											// eslint-disable-next-line @next/next/no-img-element -- a private link to the customer's own upload
											<img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
										)}
									</span>
									<span className="block truncate px-1 py-0.5 text-[11px] text-foreground/60 tabular-nums">
										{name} {i.start}–{i.end}s
									</span>
								</button>
								<button onClick={() => setRemoving({ name: `this ${name.toLowerCase()}`, remove: () => setInserts(layers.inserts.filter((x) => x.id !== i.id)) })} aria-label={`Delete this ${name.toLowerCase()}`} className="absolute top-0.5 right-0.5 rounded-full bg-black/70 p-0.5 text-white hover:bg-red-600">
									<X className="h-3 w-3" aria-hidden />
								</button>
							</div>
						);
					})}
				</div>
			)}
			{tab === "inserts" &&
				layers.inserts
					.filter((i) => i.id === open)
					.map((i) => (
						<div key={i.id} className="flex flex-col gap-1.5 rounded-lg border border-foreground/15 p-2">
							<label className="flex items-center gap-2 text-xs">
								<input type="checkbox" checked={i.hidden} onChange={(e) => updateInsert(i.id, { hidden: e.target.checked })} />
								Hide me while it shows
							</label>
							{!i.hidden && row("Your size", range(i.speakerScale, INSERT.scale.min, INSERT.scale.max, 0.05, `${Math.round(i.speakerScale * 100)}%`, (speakerScale) => updateInsert(i.id, { speakerScale })))}
							{!i.hidden && row("You stand", range(i.speakerX, 0, 1, 0.01, i.speakerX < 0.4 ? "Left" : i.speakerX > 0.6 ? "Right" : "Middle", (speakerX) => updateInsert(i.id, { speakerX })))}
							{times(i, (patch) => updateInsert(i.id, patch))}
						</div>
					))}

			{askSlow && (
				<Confirm
					title="Use Slow again?"
					body={cutout.best.unlimited ? `Slow has to cut ${clock(bestCost)} of this video again.` : `Slow has to cut ${clock(bestCost)} of this video again. That uses ${clock(bestCost)} of your ${clock(bestLeft)} left this month.`}
					action="Cut with Slow"
					onCancel={closeAskSlow}
					onConfirm={() => {
						closeAskSlow();
						go();
					}}
				/>
			)}
			{removing && (
				<ConfirmDelete
					name={removing.name}
					onCancel={closeRemoving}
					onConfirm={() => {
						removing.remove();
						closeRemoving();
					}}
				/>
			)}
		</div>
	);
}

// A clip's length in seconds, read by the browser (null if it can't tell).
function clipLength(file: File): Promise<number | null> {
	return new Promise((resolve) => {
		const video = document.createElement("video");
		const url = URL.createObjectURL(file);
		video.preload = "metadata";
		video.onloadedmetadata = () => {
			resolve(Number.isFinite(video.duration) ? video.duration : null);
			URL.revokeObjectURL(url);
		};
		video.onerror = () => resolve(null);
		video.src = url;
	});
}
