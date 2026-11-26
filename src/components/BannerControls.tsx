"use client";

import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, ImagePlus, Plus, RefreshCw, Star, Trash2, Type, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BANNER, BANNER_ANIMS, BANNER_FILE, BANNER_KINDS, BANNER_LINE_GAP, BANNER_OPACITY, BANNER_PADDING, BANNER_RADIUS, BANNER_ROTATE, BANNER_SCALE, BANNER_STROKE, BANNER_TOP, type Banner, type BannerAnim, type BannerKind, type BannerPlace, bannerInk, canBeBanner, cleanBannerText, keepBannerFile } from "@/lib/banners";
import { fontChoice, ownValue, useMyFonts } from "@/lib/use-my-fonts";
import { FontField } from "./FontField";
import { EDGE_COLORS, type Format } from "@/lib/subtitle-style";
import { ConfirmDelete } from "./ConfirmDelete";
import { ClipSound } from "./ClipSound";
import { ClipTrim } from "./ClipTrim";
import { FadeSwitches } from "./FadeSwitches";
import { PICKED, TabGroup, ToolGroup } from "./ToolGroup";
import { addToLibrary, clipLength, type LibraryItem } from "@/lib/media-library";
import { FilePicker, PickedFile, useLibrary } from "./FilePicker";
import { newClipSound } from "@/lib/clip-sound";
import { layerPlace, moveLayer, sameBannerPass } from "@/lib/layers";

type Props = {
	banners: Banner[];
	onChange: (banners: Banner[]) => void;
	now: () => number; // where the preview is, in seconds of the final video
	total: number; // length of the final video, seconds
	brand: string; // the Brand Kit's colour: a banner's background until one is picked
	focus: string | null; // the banner just clicked on the timeline: open it here
	format: Format; // the video's shape: where a banner sits before it is dragged
	videoKey?: string; // the video, for uploading a banner of your own next to it
	onUseFile?: (item: LibraryItem) => void; // a picture or clip uploaded before (Import's list): a banner again
	onReveal?: (id: string, start: number) => void; // show it: the blue line to its start, its strip picked on the timeline
};

// Two tabs (coach 23 Nov): Text (any words: Call to action, a price, a title; old Price and Follow banners show here too) and
// Pic & Clip (an uploaded picture, GIF or clip). Price and Follow are no longer added, only kept.
type BannerTab = "text" | "file";
const tabOf = (kind: BannerKind): BannerTab => (kind === "file" ? "file" : "text");
// What the browser can show in the preview, and render.py can put on the final video (api/banner-file).
const FILE_TYPES = "image/jpeg,image/png,image/webp,image/gif,video/mp4";

const round = (n: number) => Math.round(n * 10) / 10;

// The editor's Banners box: add a price tag, a call to action or "follow me" at the spot the
// preview is at, then change its words, place and when it shows.
export function BannerControls({ banners, onChange, now, total, brand, focus, format, videoKey, onUseFile, onReveal }: Props) {
	// One banner open at a time, so the panel stays short and the timeline below it stays in reach.
	const [open, setOpen] = useState<string | null>(focus);
	const [tab, setTab] = useState<BannerTab>(() => tabOf(banners.find((b) => b.id === focus)?.kind ?? banners[0]?.kind ?? "cta"));
	// Which pop-up of pictures is open: a banner (Change), or "new" (Add a picture or clip).
	const [picking, setPicking] = useState<string | null>(null);
	// Another banner clicked on the timeline: open it, on its tab (set while drawing, not in an effect, as in CutoutControls).
	const [seenFocus, setSeenFocus] = useState(focus);
	if (focus !== seenFocus) {
		setSeenFocus(focus);
		setOpen(focus);
		const kind = banners.find((b) => b.id === focus)?.kind;
		if (kind) setTab(tabOf(kind));
	}
	// In time order here; the list itself is in layer order (the last one on top, lib/layers.ts).
	const shown = banners.filter((b) => tabOf(b.kind) === tab).sort((a, b) => a.start - b.start);
	// A new banner goes on top of the others, and its strip shows on the timeline.
	const addBanner = (banner: Banner) => {
		setOpen(banner.id);
		onChange([...banners, banner]);
		onReveal?.(banner.id, banner.start);
	};
	// The banner waiting for "yes, delete it" (coach, 11 Nov: the × is small and easy to hit).
	const [removing, setRemoving] = useState<Banner | null>(null);

	// Own fonts, as for the subtitles (lib/use-my-fonts.ts): a pick pins that very file in the banner.
	const myFonts = useMyFonts();
	function pickFont(b: Banner, value: string) {
		const choice = fontChoice(value, b.ownFont, myFonts);
		if (choice) update(b.id, choice as Pick<Banner, "font" | "ownFont">);
	}

	// A banner of your own: a picture, GIF or clip, uploaded into My files and shown from there (coach 21 Nov).
	const [uploading, setUploading] = useState(false);
	const [fileNote, setFileNote] = useState("");
	async function addFile(file: File, replaceId?: string) {
		setFileNote("");
		// The AI studio's address names the video (/edit?key=…), as for its preview (bannerFileSrc).
		const key = videoKey ?? new URLSearchParams(window.location.search).get("key");
		if (!key) return setFileNote("Open a video first.");
		setUploading(true);
		const clip = file.type.startsWith("video/") ? await clipLength(file) : null;
		const sent = await addToLibrary(key, file);
		setUploading(false);
		if ("error" in sent) return setFileNote(sent.error);
		const data = { file: sent.item.file, media: sent.item.media };
		keepBannerFile(data.file, URL.createObjectURL(file));
		reloadLibrary();
		setPicking(null);
		latest.current?.(sent.item, file.name, clip, replaceId);
	}
	// A file just uploaded: into the banner whose picture it replaces, or a new banner where the preview is.
	function placeFile(item: LibraryItem, fileName: string, clip: number | null, replaceId?: string) {
		if (replaceId) return changeFile(replaceId, item);
		if (banners.length >= BANNER.maxBanners) return setFileNote(`That's the most banners one video can have. ${fileName} is in My files.`);
		const start = round(Math.min(now(), Math.max(0, total - 1)));
		// A clip shows for as long as it plays; a picture for a few seconds, as a word banner.
		const seconds = Math.max(0.5, Math.min(clip ?? BANNER.seconds, total - start));
		const name = cleanBannerText(fileName.replace(/\.[^.]+$/, "")) || BANNER_KINDS.file.text;
		addBanner({ id: crypto.randomUUID(), kind: "file", text: name, sub: "", start, end: round(start + seconds), place: "top", x: BANNER_FILE.x, y: BANNER_FILE.y, file: item.file, media: item.media, ...newClipSound(item.media) });
	}
	// A banner shows another picture or clip: its sound starts as for a new one, and a clip's Trim starts again.
	function changeFile(id: string, item: LibraryItem) {
		const old = banners.find((x) => x.id === id);
		update(id, { file: item.file, media: item.media, clipFrom: undefined, text: cleanBannerText(item.name.replace(/\.[^.]+$/, "")) || old?.text || BANNER_KINDS.file.text, ...(item.media === "video" ? (old?.volume === undefined && !old?.muted ? newClipSound("video") : {}) : { volume: undefined, muted: undefined }) });
	}
	// Every picture and clip this video can show (the picker): its own and My files'. So nobody uploads the same file
	// again (coach 11 Nov).
	const [library, reloadLibrary] = useLibrary();
	const update = (id: string, patch: Partial<Banner>) => onChange(banners.map((b) => (b.id === id ? { ...b, ...patch } : b)));
	// An upload takes a while, so it goes into the banners as they are by then (else edits made meanwhile are lost);
	// with the box closed meanwhile it only goes into My files. As in CutoutControls.
	const latest = useRef<typeof placeFile | null>(null);
	useEffect(() => {
		latest.current = placeFile;
		return () => {
			latest.current = null;
		};
	});

	// Where each banner was dragged to, so picking Top and then "Where you dragged it" brings it back (coach, 6 Nov).
	const [dragged, setDragged] = useState<Record<string, { x: number; y: number }>>({});
	const moved = banners.filter((b) => b.x !== undefined && b.y !== undefined && (dragged[b.id]?.x !== b.x || dragged[b.id]?.y !== b.y));
	if (moved.length) setDragged({ ...dragged, ...Object.fromEntries(moved.map((b) => [b.id, { x: b.x as number, y: b.y as number }])) });
	function placeBanner(b: Banner, value: string) {
		if (value !== "dragged") return update(b.id, { place: value as BannerPlace, x: undefined, y: undefined });
		// Never dragged yet: start from the middle of where it sits now, ready to be dragged on the video.
		const spot = dragged[b.id] ?? { x: 0.5, y: Math.round((BANNER_TOP[format][b.place] + 0.04) * 1000) / 1000 };
		update(b.id, spot);
	}
	// The saved banner waiting for "yes, delete it", so a slip of the mouse never loses one.
	const [forgetting, setForgetting] = useState<string | null>(null);

	// My banners: saved to the account, for any video. Each starts at 0 and ends after as long as it shows.
	const [templates, setTemplates] = useState<Banner[]>([]);
	useEffect(() => {
		void fetch("/api/banner-templates")
			.then(async (res) => (res.ok ? ((await res.json()) as { templates?: Banner[] }) : {}))
			.then((data: { templates?: Banner[] }) => setTemplates((data.templates ?? []).filter((t) => t.kind !== "file")))
			.catch(() => {});
	}, []);
	function saveTemplates(next: Banner[]) {
		setTemplates(next);
		void fetch("/api/banner-templates", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templates: next }) }).catch(() => {});
	}
	function saveAsTemplate(b: Banner) {
		const seconds = round(Math.max(0.5, b.end - b.start));
		const id = crypto.randomUUID();
		saveTemplates([...templates, { ...b, id, templateId: undefined, start: 0, end: seconds }].slice(-BANNER.maxBanners));
		update(b.id, { templateId: id }); // so Update My banner knows which one it is
	}
	// The banner's looks that My banners keeps; if they differ from the saved one, Update My banner shows (coach 23 Nov).
	const looksOf = (b: Banner) =>
		JSON.stringify([b.text, b.sub, b.color, b.ink, b.radius, b.opacity, b.anim, b.font, b.ownFont?.file, b.lineGap, b.noBox, b.align, b.scale, b.stroke, b.strokeColor, b.padding, b.rotate, b.fadeIn, b.fadeOut]);
	const master = (b: Banner) => (b.templateId ? templates.find((t) => t.id === b.templateId) : undefined);
	const changedFromMaster = (b: Banner) => {
		const m = master(b);
		return Boolean(m) && looksOf(m as Banner) !== looksOf(b);
	};
	// Only the saved copy changes; banners already put on the timeline from it stay as they are.
	function updateMaster(b: Banner) {
		const m = master(b);
		if (!m) return;
		saveTemplates(templates.map((t) => (t.id === m.id ? { ...b, id: m.id, templateId: undefined, start: 0, end: round(Math.max(0.5, b.end - b.start)) } : t)));
	}
	// A copy of a banner, with every setting, right after it ends (or where the video is now if there's no
	// room after it), to change only its words (coach, 11 Nov).
	function duplicate(b: Banner) {
		const seconds = b.end - b.start;
		const start = round(b.end + seconds <= total ? b.end : Math.min(now(), Math.max(0, total - seconds)));
		addBanner({ ...b, id: crypto.randomUUID(), start, end: round(Math.min(total, start + seconds)) });
	}
	function addTemplate(t: Banner) {
		const start = round(Math.min(now(), Math.max(0, total - 1)));
		addBanner({ ...t, id: crypto.randomUUID(), templateId: t.id, start, end: round(Math.min(total, start + t.end)) });
	}

	function add(kind: Exclude<BannerKind, "file">) {
		const start = round(Math.min(now(), Math.max(0, total - 1)));
		const preset = BANNER_KINDS[kind];
		addBanner({ id: crypto.randomUUID(), kind, text: preset.text, sub: preset.sub, start, end: round(Math.min(total, start + BANNER.seconds)), place: "top" });
	}

	const swatches = (b: Banner, label: string, key: "color" | "ink" | "strokeColor", value: string) => (
		<div className="flex items-center gap-2 text-xs text-foreground/70">
			<span className="w-16 shrink-0">{label}</span>
			<div className="flex flex-wrap items-center gap-1">
				{EDGE_COLORS.map((c) => (
					<button
						key={c}
						onClick={() => update(b.id, { [key]: c })}
						aria-label={`${label} ${c}`}
						className={`h-5 w-5 rounded-full border-2 ${value === c ? "border-blue-600" : "border-foreground/20"}`}
						style={{ background: c }}
					/>
				))}
				<input type="color" value={value} onChange={(e) => update(b.id, { [key]: e.target.value.toUpperCase() })} aria-label={`Any ${label.toLowerCase()}`} className="h-5 w-7 cursor-pointer rounded border border-foreground/20 bg-transparent" />
			</div>
		</div>
	);
	const range = (b: Banner, label: string, value: number, min: number, max: number, step: number, show: string, set: (n: number) => void) => (
		<label className="flex items-center gap-2 text-xs text-foreground/70">
			<span className="w-16 shrink-0">{label}</span>
			<input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} className="min-w-0 flex-1 accent-blue-600" />
			<span className="w-10 tabular-nums">{show}</span>
		</label>
	);

	const inTemplates = (b: Banner) => Boolean(master(b)) || templates.some((t) => t.text === cleanBannerText(b.text, BANNER.maxLines) && t.sub === b.sub);

	// The choices, as a pop-up (coach 23 Nov: not unrolled down the box), for a banner (it is changed) or for a new one.
	const filePicker = (target: string | "new", current?: string) => (
		<FilePicker
			floating
			items={library && library.filter((i) => canBeBanner(i.file))}
			current={current}
			disabled={target === "new" && banners.length >= BANNER.maxBanners}
			onPick={(item) => {
				if (target === "new") onUseFile?.(item);
				else changeFile(target, item);
				setPicking(null);
			}}
			upload={{ accept: FILE_TYPES, busy: uploading, onFile: (file) => void addFile(file, target === "new" ? undefined : target) }}
			note={fileNote}
		/>
	);

	// The header row of a banner: its name, then the star, the layer arrows, Duplicate and the bin (coach 23 Nov).
	const bannerHeader = (b: Banner) => {
		const place = layerPlace(banners, b.id, sameBannerPass);
		const isOpen = open === b.id;
		return (
			<div className="flex items-center gap-1">
				<button onClick={() => setOpen(isOpen ? null : b.id)} aria-expanded={isOpen} title={isOpen ? "Hide its settings" : "Show its settings"} className="rounded p-1 text-foreground/60 hover:bg-foreground/5 hover:text-foreground">
					{isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />}
				</button>
				{b.kind === "file" ? (
					<input
						value={b.text}
						maxLength={BANNER.maxText}
						onChange={(e) => update(b.id, { text: e.target.value.replace(/\n/g, " ") })}
						aria-label="Name (shown on the timeline)"
						title="Its name, shown on the timeline"
						className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-sm font-medium hover:border-foreground/20 focus:border-foreground/30 focus:outline-none"
					/>
				) : (
					<input
						value={b.name ?? ""}
						placeholder={cleanBannerText(b.text).split("\n")[0] || BANNER_KINDS[b.kind].name}
						maxLength={40}
						onChange={(e) => update(b.id, { name: e.target.value.replace(/[\n\r\t]/g, " ") || undefined })}
						aria-label="Name on the timeline"
						title="Name on the timeline"
						className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-sm font-medium placeholder:text-foreground placeholder:opacity-100 hover:border-foreground/20 focus:border-foreground/30 focus:outline-none"
					/>
				)}
				{b.kind !== "file" && (
					<button
						onClick={() => saveAsTemplate(b)}
						disabled={!cleanBannerText(b.text) || inTemplates(b)}
						title={inTemplates(b) ? "In My banners" : "Save to My banners, to use on any video"}
						aria-label="Save to My banners"
						className="rounded p-1 text-foreground/50 hover:bg-foreground/10 hover:text-foreground disabled:opacity-30"
					>
						<Star className={`h-3.5 w-3.5 shrink-0 ${inTemplates(b) ? "fill-amber-400 text-amber-500" : ""}`} aria-hidden />
					</button>
				)}
				<span className="shrink-0 text-[11px] text-foreground/60" title="Its layer among the things showing with it">
					{place ? `${place.at}/${place.of}` : "1/1"}
				</span>
				<button onClick={() => onChange(moveLayer(banners, b.id, true, sameBannerPass))} disabled={!place || place.at === place.of} title={place ? "Bring it in front of the one over it" : "Nothing else shows at the same time"} aria-label="Bring forward" className="rounded p-1 text-foreground/50 hover:bg-foreground/5 hover:text-foreground disabled:opacity-30">
					<ArrowUp className="h-3.5 w-3.5" aria-hidden />
				</button>
				<button onClick={() => onChange(moveLayer(banners, b.id, false, sameBannerPass))} disabled={!place || place.at === 1} title={place ? "Send it behind the one under it" : "Nothing else shows at the same time"} aria-label="Send backward" className="rounded p-1 text-foreground/50 hover:bg-foreground/5 hover:text-foreground disabled:opacity-30">
					<ArrowDown className="h-3.5 w-3.5" aria-hidden />
				</button>
				<button onClick={() => duplicate(b)} disabled={banners.length >= BANNER.maxBanners} title="Duplicate: a copy right after it" aria-label="Duplicate banner" className="rounded p-1 text-foreground/50 hover:bg-foreground/10 hover:text-foreground disabled:opacity-30">
					<Copy className="h-3.5 w-3.5 shrink-0" aria-hidden />
				</button>
				<button onClick={() => setRemoving(b)} aria-label="Remove banner" title="Delete this banner" className="rounded p-1 text-foreground/50 hover:bg-red-500/10 hover:text-red-600">
					<Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
				</button>
			</div>
		);
	};

	const animPick = (b: Banner) => (
		<select value={b.anim ?? "fade"} onChange={(e) => update(b.id, { anim: e.target.value as BannerAnim })} aria-label="How it arrives" className="min-w-0 flex-1 rounded-md border border-foreground/20 bg-background px-1 py-0.5 text-xs">
			{(Object.keys(BANNER_ANIMS) as BannerAnim[]).filter((a) => b.kind !== "file" || !BANNER_ANIMS[a].roll).map((a) => (
				<option key={a} value={a}>
					{BANNER_ANIMS[a].name}
				</option>
			))}
		</select>
	);

	// A text banner's settings, in cards (coach 23 Nov): its words, how it shows, its font, its letters, its box.
	const textCards = (b: Banner) => (
		<div className="flex flex-col gap-2">
			<ToolGroup tone={1} title="Words">
				<textarea
					value={b.text}
					rows={Math.min(BANNER.maxLines, Math.max(2, b.text.split("\n").length))}
					onChange={(e) => update(b.id, { text: e.target.value.split("\n").slice(0, BANNER.maxLines).map((line) => line.slice(0, BANNER.maxText)).join("\n") })}
					aria-label="Banner text"
					title={`Press Enter for a new line (up to ${BANNER.maxLines})`}
					className="w-full resize-y rounded-md border border-foreground/20 bg-background px-2 py-1 text-sm"
				/>
				<span className="text-[11px] text-foreground/55">Enter a new line, up to {BANNER.maxLines} lines</span>
				{b.kind === "price" && (
					<input value={b.sub} maxLength={BANNER.maxText} onChange={(e) => update(b.id, { sub: e.target.value })} placeholder="Small line under it (optional)" aria-label="Small line" className="rounded-md border border-foreground/20 bg-background px-2 py-0.5 text-sm" />
				)}
			</ToolGroup>

			<ToolGroup tone={2} title="Show">
				<div className="flex items-center gap-2">
					{animPick(b)}
					<select value={b.x !== undefined ? "dragged" : b.place} onChange={(e) => placeBanner(b, e.target.value)} aria-label="Where on the video" className="min-w-0 flex-1 rounded-md border border-foreground/20 bg-background px-1 py-0.5 text-xs">
						<option value="dragged">{dragged[b.id] ? "Position" : "Anywhere (drag it on the video)"}</option>
						<option value="top">Top</option>
						<option value="middle">Middle</option>
						<option value="bottom">Bottom</option>
					</select>
				</div>
				{BANNER_ANIMS[b.anim ?? "fade"].roll ? (
					<span className="text-[11px] text-foreground/60">Travels from below the screen to above it for as long as it shows. Make it longer to go slower. Rotate and fades don&apos;t apply.</span>
				) : (
					<FadeSwitches item={b} onChange={(patch) => update(b.id, patch)} />
				)}
				{range(b, "Rotate", b.rotate ?? 0, BANNER_ROTATE.min, BANNER_ROTATE.max, 1, `${Math.round(b.rotate ?? 0)}°`, (n) => update(b.id, { rotate: n || undefined }))}
			</ToolGroup>

			<ToolGroup tone={3} title="Font">
				<FontField
					key={b.id}
					label="Banner font"
					inherit="Same as the subtitles"
					value={b.font === "own" ? ownValue(b.ownFont) : (b.font ?? "")}
					current={b.font === "own" ? b.ownFont : undefined}
					myFonts={myFonts}
					onPick={(value) => pickFont(b, value)}
					onUploaded={(font) => update(b.id, { font: "own", ownFont: font })}
				/>
			</ToolGroup>

			<ToolGroup tone={1} title="Letters">
				{swatches(b, "Text", "ink", b.ink ?? bannerInk(b.color ?? brand))}
				{range(b, "Size", b.scale ?? 1, BANNER_SCALE.min, BANNER_SCALE.max, 0.05, `${Math.round((b.scale ?? 1) * 100)}%`, (n) => update(b.id, { scale: n }))}
				{range(b, "Line gap", b.lineGap ?? 0, BANNER_LINE_GAP.min, BANNER_LINE_GAP.max, 2, String(b.lineGap ?? 0), (n) => update(b.id, { lineGap: n }))}
				<div className="flex items-center gap-2 text-xs text-foreground/70">
					<span className="w-16 shrink-0">Align</span>
					{(
						[
							[undefined, AlignCenter, "Center"],
							["left", AlignLeft, "Left"],
							["right", AlignRight, "Right"],
						] as const
					).map(([align, Icon, name]) => (
						<button
							key={name}
							onClick={() => update(b.id, { align })}
							aria-pressed={b.align === align}
							title={name}
							aria-label={`Align ${name.toLowerCase()}`}
							className={`rounded-md border p-1 ${b.align === align ? PICKED : "border-foreground/20 hover:bg-foreground/5"}`}
						>
							<Icon className="h-3.5 w-3.5" aria-hidden />
						</button>
					))}
				</div>
			</ToolGroup>

			<ToolGroup tone={2} title="Stroke">
				{range(b, "Stroke", b.stroke ?? 0, BANNER_STROKE.min, BANNER_STROKE.max, 0.5, b.stroke ? `${b.stroke}px` : "Off", (n) => update(b.id, { stroke: n > 0 ? n : undefined }))}
				{b.stroke ? swatches(b, "Colour", "strokeColor", b.strokeColor ?? "#000000") : <span className="text-[11px] text-foreground/55">The line round the letters is always round at the corners.</span>}
			</ToolGroup>

			<ToolGroup tone={3} title="Box">
				<label className="flex items-center gap-2 text-xs text-foreground/70">
					<span className="w-16 shrink-0">Background</span>
					<input type="checkbox" checked={!b.noBox} onChange={(e) => update(b.id, { noBox: e.target.checked ? undefined : true })} className="accent-blue-600" />
					<span>{b.noBox ? "Off: letters only" : "On"}</span>
				</label>
				{!b.noBox && swatches(b, "Box colour", "color", b.color ?? brand)}
				{!b.noBox && range(b, "Padding", b.padding ?? BANNER.padding, BANNER_PADDING.min, BANNER_PADDING.max, 1, String(b.padding ?? BANNER.padding), (n) => update(b.id, { padding: n === BANNER.padding ? undefined : n }))}
				{!b.noBox && range(b, "Corners", b.radius ?? 0, BANNER_RADIUS.min, BANNER_RADIUS.max, 2, String(b.radius ?? 0), (n) => update(b.id, { radius: n }))}
				{!b.noBox && range(b, "Opacity", b.opacity ?? 1, BANNER_OPACITY.min, BANNER_OPACITY.max, 0.05, `${Math.round((b.opacity ?? 1) * 100)}%`, (n) => update(b.id, { opacity: n }))}
			</ToolGroup>
		</div>
	);

	// A picture or clip banner's settings (coach 23 Nov): the file as one row with Change, then how it shows and its size.
	const fileCards = (b: Banner) => (
		<div className="flex flex-col gap-2">
			<ToolGroup tone={1} title={b.media === "video" ? "The clip" : "The picture"}>
				<div className="relative flex flex-col gap-1.5">
					{b.file && <PickedFile file={b.file} media={b.media === "video" ? "video" : "image"} name={b.text} open={picking === b.id} onToggle={() => setPicking(picking === b.id ? null : b.id)} />}
					{picking === b.id && filePicker(b.id, b.file)}
				</div>
				<span className="text-[11px] text-foreground/55">Pause the video on it to drag it anywhere, or drag its corner to make it bigger or smaller.</span>
				{b.media === "video" && <ClipSound sound={b} onChange={(patch) => update(b.id, patch)} />}
				{b.media === "video" && b.file && <ClipTrim id={b.id} file={b.file} start={b.start} end={b.end} clipFrom={b.clipFrom} total={total} onChange={(patch) => update(b.id, patch)} />}
			</ToolGroup>
			<ToolGroup tone={2} title="Show">
				<div className="flex items-center gap-2">{animPick(b)}</div>
				<FadeSwitches item={b} onChange={(patch) => update(b.id, patch)} />
			</ToolGroup>
			<ToolGroup tone={3} title="Size">
				{range(b, "Size", b.scale ?? 1, BANNER_SCALE.min, BANNER_SCALE.max, 0.05, `${Math.round((b.scale ?? 1) * 100)}%`, (n) => update(b.id, { scale: n }))}
				{range(b, "Opacity", b.opacity ?? 1, BANNER_OPACITY.min, BANNER_OPACITY.max, 0.05, `${Math.round((b.opacity ?? 1) * 100)}%`, (n) => update(b.id, { opacity: n }))}
				{range(b, "Rotate", b.rotate ?? 0, BANNER_ROTATE.min, BANNER_ROTATE.max, 1, `${Math.round(b.rotate ?? 0)}°`, (n) => update(b.id, { rotate: n || undefined }))}
			</ToolGroup>
		</div>
	);

	return (
		<div className="flex flex-col gap-2 p-3 pt-1">
			<TabGroup
				tone={3}
				value={tab}
				onChange={setTab}
				tabs={[
					{ id: "text", label: "Text", icon: <Type className="h-5 w-5" aria-hidden /> },
					{ id: "file", label: "Pic & Clip", icon: <ImagePlus className="h-5 w-5" aria-hidden /> },
				]}
			>
				{tab === "text" ? (
					<>
						<button onClick={() => add("cta")} disabled={banners.length >= BANNER.maxBanners} className="inline-flex items-center justify-center gap-1 rounded-md border border-dashed border-foreground/30 px-2 py-1 text-sm hover:bg-foreground/5 disabled:opacity-40">
							<Plus className="h-3.5 w-3.5" aria-hidden /> Add a text
						</button>
						{templates.length > 0 && (
							<div className="flex flex-col gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2">
								<p className="flex items-center gap-1 text-xs font-medium">
									<Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-500" aria-hidden />
									My banners
									<span className="font-normal text-foreground/60">· add your favorite banner</span>
								</p>
								<div className="flex flex-wrap items-center gap-1.5 text-sm">
									{templates.map((t) =>
										forgetting === t.id ? (
											<span key={t.id} className="flex items-center gap-1.5 rounded-md border border-red-500/50 bg-background px-2 py-0.5 text-xs">
												Delete &ldquo;{t.text}&rdquo; from My banners?
												<button onClick={() => { saveTemplates(templates.filter((x) => x.id !== t.id)); setForgetting(null); }} className="rounded bg-red-600 px-1.5 py-0.5 font-medium text-white hover:bg-red-700">
													Delete
												</button>
												<button onClick={() => setForgetting(null)} className="rounded border border-foreground/20 px-1.5 py-0.5 hover:bg-foreground/5">
													Keep
												</button>
											</span>
										) : (
											<span key={t.id} className="flex items-center overflow-hidden rounded-md border border-foreground/20 bg-background">
												<button onClick={() => addTemplate(t)} disabled={banners.length >= BANNER.maxBanners} title="Add it where the video is now" className="flex max-w-44 items-center gap-1.5 px-2 py-0.5 hover:bg-foreground/5 disabled:opacity-40">
													<span className="h-3 w-3 shrink-0 rounded-sm border border-foreground/20" style={{ background: t.color ?? brand }} aria-hidden />
													<span className="truncate">{t.text.replace(/\n/g, " ")}</span>
													<Plus className="h-3 w-3 shrink-0 text-foreground/50" aria-hidden />
												</button>
												<button onClick={() => setForgetting(t.id)} aria-label={`Delete ${t.text} from My banners`} title="Delete from My banners" className="border-l border-foreground/10 px-1.5 py-1 text-foreground/50 hover:bg-red-500/10 hover:text-red-600">
													<X className="h-3 w-3 shrink-0" aria-hidden />
												</button>
											</span>
										),
									)}
								</div>
							</div>
						)}
						{shown.length === 0 && <p className="text-xs text-foreground/60">Any words on the video: a price, a link, a title. It is added where the video is now and shows on the timeline: drag it there to change when it appears.</p>}
					</>
				) : (
					<div className="relative flex flex-col gap-1.5">
						<button onClick={() => setPicking(picking === "new" ? null : "new")} aria-expanded={picking === "new"} disabled={uploading || banners.length >= BANNER.maxBanners} className="inline-flex items-center justify-center gap-1 rounded-md border border-dashed border-foreground/30 px-2 py-1 text-sm hover:bg-foreground/5 disabled:opacity-40">
							<Plus className="h-3.5 w-3.5" aria-hidden /> {uploading ? "Uploading…" : "Add a picture or clip"}
						</button>
						{picking === "new" && filePicker("new")}
						{picking === null && fileNote && <p className="text-xs text-red-500">{fileNote}</p>}
						{shown.length === 0 && (
							<p className="text-xs text-foreground/60">
								Have a banner made already? JPG, PNG, WebP or GIF up to {BANNER_FILE.maxBytes.image / 1_000_000} MB, or an MP4 clip up to {BANNER_FILE.maxBytes.video / 1_000_000} MB (clips show without their sound). It goes over you, where the video is now.
							</p>
						)}
					</div>
				)}
				{shown.map((b) => (
					<div key={b.id} className={`flex flex-col gap-2 rounded-md bg-foreground/5 p-1.5 text-sm ${open === b.id ? "ring-1 ring-blue-400" : ""}`}>
						{bannerHeader(b)}
						{b.kind !== "file" && changedFromMaster(b) && (
							<button onClick={() => updateMaster(b)} title="Save these changes to My banners. Banners already on the timeline stay as they are." className="inline-flex items-center justify-center gap-1.5 rounded-md border border-amber-500/60 bg-amber-500/15 px-2 py-1 text-xs font-medium hover:bg-amber-500/25">
								<RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden /> Update My banner
							</button>
						)}
						{open === b.id && (b.kind === "file" ? fileCards(b) : textCards(b))}
					</div>
				))}
				{shown.length > 0 && (
					<p className="text-[11px] text-foreground/55">Move banner on timeline to set start time; pause video over banner to move its position.{tab === "text" && " No emojis allowed."}</p>
				)}
			</TabGroup>
			{removing && (
				<ConfirmDelete
					name={`"${(removing.name ?? removing.text).replace(/\n/g, " ")}"`}
					onCancel={() => setRemoving(null)}
					onConfirm={() => {
						onChange(banners.filter((x) => x.id !== removing.id));
						setRemoving(null);
					}}
				/>
			)}
		</div>
	);
}
