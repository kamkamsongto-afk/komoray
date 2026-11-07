"use client";

import { ChevronDown, ChevronRight, ImagePlus, Type, X } from "lucide-react";
import { useRef, useState } from "react";
import { BEHIND, BEHIND_FX, type BehindFx, type BehindSpeed, type BehindText, cleanBehindText, covered, cutoutWindows, type CutoutLayers, INSERT, type Insert } from "@/lib/behind";
import { windowSeconds } from "@/lib/cutout";
import { EDGE_COLORS, FONTS, type FontId, TEXT_COLORS } from "@/lib/subtitle-style";
import type { Segment } from "@/lib/timeline";
import type { useCutout } from "@/lib/use-cutout";

type Props = {
	layers: CutoutLayers;
	onChange: (layers: CutoutLayers) => void;
	cutout: ReturnType<typeof useCutout>;
	segments: Segment[];
	now: () => number; // where the preview is, seconds of the final video
	total: number; // length of the final video, seconds
	thai: boolean; // Thai video: only fonts with Thai letters
};

const round = (n: number) => Math.round(n * 10) / 10;
const SPEEDS: [BehindSpeed, string][] = [
	["slow", "Slow"],
	["normal", "Normal"],
	["fast", "Fast"],
];

// The editor's Cutout box: big text behind the speaker, and pictures or clips behind a smaller speaker.
// The speaker is cut out on a GPU only for the parts these cover, once they are where they should be
// (Cut out the speaker); moving one outside those parts asks for it again.
export function CutoutControls({ layers, onChange, cutout, segments, now, total, thai }: Props) {
	const [open, setOpen] = useState<string | null>(null);
	const [uploading, setUploading] = useState(false);
	const [notice, setNotice] = useState("");
	const fileRef = useRef<HTMLInputElement>(null);

	const need = cutoutWindows(layers, segments);
	const needSeconds = windowSeconds(need.map(([a, b]): [number, number] => [Math.max(0, a), b]));
	const ready = cutout.status === "done" && covered(need, cutout.windows);
	const tooLong = needSeconds > cutout.seconds + 0.05;
	const empty = layers.texts.length + layers.inserts.length === 0;

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
		const seconds = Math.min(clipSeconds ?? BEHIND.seconds, Math.max(1, cutout.seconds - needSeconds), total - start);
		const insert: Insert = { id: crypto.randomUUID(), kind: done.kind, file: done.file, start, end: round(start + Math.max(0.5, seconds)), speakerScale: INSERT.scale.start, speakerX: 0.25, hidden: false };
		setOpen(insert.id);
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
			<p className="text-xs text-foreground/60">
				Put big text behind you, or a picture or clip behind a smaller you. Komoray cuts you out of the background for those parts: up to {cutout.seconds} seconds of
				each video.
			</p>
			<div className="flex flex-wrap items-center gap-1.5">
				<button onClick={addText} disabled={layers.texts.length >= BEHIND.maxItems} className="inline-flex items-center gap-1 rounded-md border border-foreground/20 px-2 py-1 text-sm hover:bg-foreground/5 disabled:opacity-40">
					<Type className="h-3.5 w-3.5" aria-hidden /> Text behind you
				</button>
				<button onClick={() => fileRef.current?.click()} disabled={uploading || layers.inserts.length >= BEHIND.maxItems} className="inline-flex items-center gap-1 rounded-md border border-foreground/20 px-2 py-1 text-sm hover:bg-foreground/5 disabled:opacity-40">
					<ImagePlus className="h-3.5 w-3.5" aria-hidden /> {uploading ? "Uploading…" : "Picture or clip"}
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
			</div>
			{notice && <p className="text-xs text-red-500">{notice}</p>}

			{!empty && (
				<div className={`flex flex-col gap-1.5 rounded-lg border p-2 text-xs ${ready ? "border-green-600/40 bg-green-600/10" : "border-blue-600/40 bg-blue-600/10"}`}>
					<span>
						{cutout.status === "processing"
							? "Cutting you out of the background… this takes about 5 minutes. Keep editing."
							: ready
								? "You're cut out for these parts. The preview shows how it will look."
								: tooLong
									? `These parts need ${needSeconds} seconds cut out, more than the ${cutout.seconds} seconds you can use. Make them shorter.`
									: cutout.status === "failed"
										? (cutout.error ?? "The cutout failed. Please try again.")
										: `When the parts are where you want them, cut yourself out (${needSeconds} of ${cutout.seconds} seconds).`}
					</span>
					{!ready && cutout.status !== "processing" && (
						<button onClick={() => void cutout.start(need)} disabled={tooLong} className="self-start rounded-md bg-blue-600 px-2.5 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
							Cut me out
						</button>
					)}
				</div>
			)}

			{layers.texts.map((t) => (
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
						<button onClick={() => setTexts(layers.texts.filter((x) => x.id !== t.id))} aria-label={`Delete ${t.text}`} className="rounded p-1 text-foreground/50 hover:bg-foreground/5 hover:text-foreground">
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

			{layers.inserts.map((i) => (
				<div key={i.id} className="rounded-lg border border-foreground/15">
					<div className="flex items-center gap-1 px-2 py-1">
						<button onClick={() => setOpen(open === i.id ? null : i.id)} className="flex min-w-0 flex-1 items-center gap-1 text-left text-sm">
							{open === i.id ? <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />}
							<ImagePlus className="h-3.5 w-3.5 shrink-0 text-foreground/50" aria-hidden />
							<span className="truncate">{i.kind === "video" ? "Clip" : "Picture"}</span>
							<span className="shrink-0 text-xs text-foreground/50">
								{i.start}–{i.end}s
							</span>
						</button>
						<button onClick={() => setInserts(layers.inserts.filter((x) => x.id !== i.id))} aria-label="Delete this picture or clip" className="rounded p-1 text-foreground/50 hover:bg-foreground/5 hover:text-foreground">
							<X className="h-3.5 w-3.5" aria-hidden />
						</button>
					</div>
					{open === i.id && (
						<div className="flex flex-col gap-1.5 border-t border-foreground/10 p-2">
							<label className="flex items-center gap-2 text-xs">
								<input type="checkbox" checked={i.hidden} onChange={(e) => updateInsert(i.id, { hidden: e.target.checked })} />
								Hide me while it shows
							</label>
							{!i.hidden && row("Your size", range(i.speakerScale, INSERT.scale.min, INSERT.scale.max, 0.05, `${Math.round(i.speakerScale * 100)}%`, (speakerScale) => updateInsert(i.id, { speakerScale })))}
							{!i.hidden && row("You stand", range(i.speakerX, 0, 1, 0.01, i.speakerX < 0.4 ? "Left" : i.speakerX > 0.6 ? "Right" : "Middle", (speakerX) => updateInsert(i.id, { speakerX })))}
							{times(i, (patch) => updateInsert(i.id, patch))}
						</div>
					)}
				</div>
			))}
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
