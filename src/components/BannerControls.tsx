"use client";

import { ChevronDown, ChevronRight, Copy, ImagePlus, Megaphone, Plus, Star, Tag, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BANNER, BANNER_ANIMS, BANNER_FILE, BANNER_KINDS, BANNER_LINE_GAP, BANNER_OPACITY, BANNER_RADIUS, BANNER_SCALE, BANNER_TOP, type Banner, type BannerAnim, type BannerKind, type BannerPlace, bannerInk, cleanBannerText, keepBannerFile } from "@/lib/banners";
import type { OwnFont } from "@/lib/font-info";
import { EDGE_COLORS, FONTS, type FontId, type Format } from "@/lib/subtitle-style";
import { ConfirmDelete } from "./ConfirmDelete";
import { ClipSound } from "./ClipSound";
import { LayerTools } from "./LayerTools";
import { clipLength, type LibraryItem, projectFileSrc } from "@/lib/media-library";
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

// One tab per kind, with a light blue frame on the open one, as in the Cutout box (coach, 11 Nov).
// Follow still shows on videos that already have one, under Call to action: it was the same thing.
type BannerTab = "price" | "cta" | "file";
const TABS: [BannerTab, typeof Tag, string][] = [["price", Tag, "Price"], ["cta", Megaphone, "Call to action"], ["file", ImagePlus, "Upload"]];
const tabOf = (kind: BannerKind): BannerTab => (kind === "follow" ? "cta" : kind);
// What the browser can show in the preview, and render.py can put on the final video (api/banner-file).
const FILE_TYPES = "image/jpeg,image/png,image/webp,image/gif,video/mp4";

const round = (n: number) => Math.round(n * 10) / 10;

// The editor's Banners box: add a price tag, a call to action or "follow me" at the spot the
// preview is at, then change its words, place and when it shows.
export function BannerControls({ banners, onChange, now, total, brand, focus, format, videoKey, onUseFile, onReveal }: Props) {
	// One banner open at a time, so the panel stays short and the timeline below it stays in reach.
	const [open, setOpen] = useState<string | null>(focus);
	const [tab, setTab] = useState<BannerTab>(() => tabOf(banners.find((b) => b.id === focus)?.kind ?? banners[0]?.kind ?? "price"));
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
	function moveHere(b: Banner) {
		const seconds = b.end - b.start;
		const start = round(Math.max(0, Math.min(now(), total - seconds)));
		update(b.id, { start, end: round(Math.min(total, start + seconds)) });
		onReveal?.(b.id, start);
	}
	// The banner waiting for "yes, delete it" (coach, 11 Nov: the × is small and easy to hit).
	const [removing, setRemoving] = useState<Banner | null>(null);

	// The account's own font (one per account, as for the subtitles), and uploading one from here.
	const [own, setOwn] = useState<OwnFont | null>(null);
	const [fontNote, setFontNote] = useState("");
	const [fontBusy, setFontBusy] = useState(false);
	useEffect(() => {
		void fetch("/api/font")
			.then(async (res) => (res.ok ? ((await res.json()) as { font?: OwnFont | null }) : {}))
			.then((data: { font?: OwnFont | null }) => setOwn(data.font ?? null))
			.catch(() => {});
	}, []);
	async function uploadFont(b: Banner, file: File) {
		setFontNote("");
		setFontBusy(true);
		const res = await fetch("/api/font", { method: "POST", body: file }).catch(() => null);
		const data = (await res?.json().catch(() => null)) as { font?: OwnFont; error?: string } | null;
		setFontBusy(false);
		if (!res?.ok || !data?.font) return setFontNote(data?.error ?? "Could not upload the font");
		setOwn(data.font);
		update(b.id, { font: "own", ownFont: data.font });
	}

	// A banner of your own: a picture, GIF or clip, uploaded next to the video.
	const fileRef = useRef<HTMLInputElement>(null);
	const [uploading, setUploading] = useState(false);
	const [fileNote, setFileNote] = useState("");
	async function addFile(file: File) {
		setFileNote("");
		// The AI studio's address names the video (/edit?key=…), as for its preview (bannerFileSrc).
		const key = videoKey ?? new URLSearchParams(window.location.search).get("key");
		if (!key) return setFileNote("Open a video first.");
		setUploading(true);
		const clip = file.type.startsWith("video/") ? await clipLength(file) : null;
		const res = await fetch("/api/banner-file", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ key, contentType: file.type, size: file.size }),
		}).catch(() => null);
		const data = (await res?.json().catch(() => ({}))) as { uploadUrl?: string; file?: string; media?: "image" | "video"; error?: string } | undefined;
		if (!res?.ok || !data?.uploadUrl || !data.file || !data.media) {
			setUploading(false);
			return setFileNote(data?.error ?? "Could not upload. Please try again.");
		}
		const put = await fetch(data.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file }).catch(() => null);
		setUploading(false);
		if (!put?.ok) return setFileNote("The upload stopped. Please try again.");
		keepBannerFile(data.file, URL.createObjectURL(file));
		const start = round(Math.min(now(), Math.max(0, total - 1)));
		// A clip shows for as long as it plays; a picture for a few seconds, as a word banner.
		const seconds = Math.max(0.5, Math.min(clip ?? BANNER.seconds, total - start));
		const name = cleanBannerText(file.name.replace(/\.[^.]+$/, "")) || BANNER_KINDS.file.text;
		addBanner({ id: crypto.randomUUID(), kind: "file", text: name, sub: "", start, end: round(start + seconds), place: "top", x: BANNER_FILE.x, y: BANNER_FILE.y, file: data.file, media: data.media });
	}
	// Pictures and clips this project already has (api/library), shown on the Upload tab: so nobody uploads the same file
	// again because they didn't know about Import (coach, 11 Nov). Loaded again after each upload here.
	const [kept, setKept] = useState<LibraryItem[]>([]);
	const libraryKey = videoKey ?? (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("key"));
	const fileBanners = banners.filter((b) => b.kind === "file").length;
	const canReuse = Boolean(onUseFile); // not the callback itself: it is new on every frame while the video plays
	useEffect(() => {
		if (tab !== "file" || !libraryKey || !canReuse) return;
		void fetch(`/api/library?key=${encodeURIComponent(libraryKey)}`)
			.then(async (res) => (res.ok ? ((await res.json()) as { items?: LibraryItem[] }) : {}))
			.then((data: { items?: LibraryItem[] }) => setKept(data.items ?? []))
			.catch(() => {});
	}, [tab, libraryKey, canReuse, fileBanners]);
	const update = (id: string, patch: Partial<Banner>) => onChange(banners.map((b) => (b.id === id ? { ...b, ...patch } : b)));

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
		saveTemplates([...templates, { ...b, id: crypto.randomUUID(), start: 0, end: seconds }].slice(-BANNER.maxBanners));
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
		addBanner({ ...t, id: crypto.randomUUID(), start, end: round(Math.min(total, start + t.end)) });
	}

	function add(kind: Exclude<BannerKind, "file">) {
		const start = round(Math.min(now(), Math.max(0, total - 1)));
		const preset = BANNER_KINDS[kind];
		addBanner({ id: crypto.randomUUID(), kind, text: preset.text, sub: preset.sub, start, end: round(Math.min(total, start + BANNER.seconds)), place: "top" });
	}

	const swatches = (b: Banner, label: string, key: "color" | "ink", value: string) => (
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

	const inTemplates = (b: Banner) => templates.some((t) => t.text === cleanBannerText(b.text, BANNER.maxLines) && t.sub === b.sub);

	return (
		<div className="flex flex-col gap-2 p-3 pt-1">
			<div role="tablist" aria-label="Banner kinds" className="grid grid-cols-3 gap-1 rounded-lg bg-foreground/5 p-0.5">
				{TABS.map(([id, Icon, name]) => {
					const count = banners.filter((b) => tabOf(b.kind) === id).length;
					return (
						<button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`inline-flex items-center justify-center gap-1 rounded-md px-1.5 py-1 text-sm whitespace-nowrap ${tab === id ? "bg-blue-400/15 font-medium text-foreground ring-1 ring-inset ring-blue-400" : "text-foreground/70 hover:text-foreground"}`}>
							<Icon className="h-3.5 w-3.5 shrink-0" aria-hidden /> {name}
							{count > 0 && <span className="text-xs text-foreground/50 tabular-nums">{count}</span>}
						</button>
					);
				})}
			</div>
			{tab === "file" ? (
				<>
					<button onClick={() => fileRef.current?.click()} disabled={uploading || banners.length >= BANNER.maxBanners} className="inline-flex items-center justify-center gap-1 rounded-md border border-dashed border-foreground/30 px-2 py-1 text-sm hover:bg-foreground/5 disabled:opacity-40">
						<Plus className="h-3.5 w-3.5" aria-hidden /> {uploading ? "Uploading…" : "Upload a picture or clip"}
					</button>
					<input
						ref={fileRef}
						type="file"
						accept={FILE_TYPES}
						className="hidden"
						onChange={(e) => {
							const file = e.target.files?.[0];
							e.target.value = "";
							if (file) void addFile(file);
						}}
					/>
					{fileNote && <p className="text-xs text-red-500">{fileNote}</p>}
					{onUseFile && kept.length > 0 && (
						<div className="flex flex-col gap-1.5 rounded-lg border border-foreground/15 p-2">
							<p className="text-xs text-foreground/70">Uploaded before: click one to use it again, no need to upload it twice. All of them are in Import.</p>
							<div className="flex gap-1.5 overflow-x-auto pb-1">
								{kept.map((item) => (
									<button
										key={item.file}
										onClick={() => onUseFile(item)}
										disabled={banners.length >= BANNER.maxBanners}
										title={`Use “${item.name}” as a banner where the video is now`}
										className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md border border-foreground/20 bg-foreground/5 hover:ring-2 hover:ring-blue-500 disabled:opacity-40"
									>
										{item.media === "image" ? (
											// eslint-disable-next-line @next/next/no-img-element
											<img src={projectFileSrc(item.file)} alt={item.name} className="h-full w-full object-contain" />
										) : (
											<video src={projectFileSrc(item.file)} muted playsInline preload="metadata" className="h-full w-full object-contain" />
										)}
									</button>
								))}
							</div>
						</div>
					)}
					{shown.length === 0 && (
						<p className="text-xs text-foreground/60">
							Have a banner made already? Upload it: JPG, PNG, WebP or GIF up to {BANNER_FILE.maxBytes.image / 1_000_000} MB, or an MP4 clip up to {BANNER_FILE.maxBytes.video / 1_000_000} MB (clips show without their sound). It goes over you, where the video is now.
						</p>
					)}
				</>
			) : (
				<button onClick={() => add(tab)} disabled={banners.length >= BANNER.maxBanners} className="inline-flex items-center justify-center gap-1 rounded-md border border-dashed border-foreground/30 px-2 py-1 text-sm hover:bg-foreground/5 disabled:opacity-40">
					<Plus className="h-3.5 w-3.5" aria-hidden /> Add {tab === "price" ? "a price" : "a call to action"}
				</button>
			)}
			{tab !== "file" && templates.length > 0 && (
				<div className="flex flex-col gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2">
					<p className="flex items-center gap-1 text-xs font-medium">
						<Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-500" aria-hidden />
						My banners
						<span className="font-normal text-foreground/60">· made by you, for any video. Click one to add it.</span>
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
									<button
										onClick={() => addTemplate(t)}
										disabled={banners.length >= BANNER.maxBanners}
										title="Add it where the video is now"
										className="flex max-w-44 items-center gap-1.5 px-2 py-0.5 hover:bg-foreground/5 disabled:opacity-40"
									>
										<span className="h-3 w-3 shrink-0 rounded-sm border border-foreground/20" style={{ background: t.color ?? brand }} aria-hidden />
										<span className="truncate">{t.text.replace(/\n/g, " ")}</span>
										<Plus className="h-3 w-3 shrink-0 text-foreground/50" aria-hidden />
									</button>
									<button
										onClick={() => setForgetting(t.id)}
										aria-label={`Delete ${t.text} from My banners`}
										title="Delete from My banners"
										className="border-l border-foreground/10 px-1.5 py-1 text-foreground/50 hover:bg-red-500/10 hover:text-red-600"
									>
										<X className="h-3 w-3 shrink-0" aria-hidden />
									</button>
								</span>
							),
						)}
					</div>
				</div>
			)}
			{banners.length === 0 && tab !== "file" && (
				<p className="text-xs text-foreground/60">A price or a call to action. It is added where the video is now, and shows on the timeline: drag it there to change when it appears.</p>
			)}
			{shown.map((b) => (
				<div key={b.id} className={`flex flex-col gap-1.5 rounded-md bg-foreground/5 p-2 text-sm ${open === b.id ? "ring-1 ring-blue-400" : ""}`}>
					<div className="flex items-start gap-2">
						<button
							onClick={() => setOpen(open === b.id ? null : b.id)}
							aria-expanded={open === b.id}
							title={open === b.id ? "Hide its settings" : "Show its settings"}
							className="flex w-16 shrink-0 items-center gap-0.5 pt-1 text-left text-xs text-foreground/60 hover:text-foreground"
						>
							{open === b.id ? <ChevronDown className="h-3 w-3 shrink-0" aria-hidden /> : <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />}
							{b.kind === "file" ? (b.media === "video" ? "Clip" : "Picture") : b.kind === "cta" ? "CTA" : BANNER_KINDS[b.kind].name}
						</button>
						{b.kind === "file" ? (
							<input
								value={b.text}
								maxLength={BANNER.maxText}
								onChange={(e) => update(b.id, { text: e.target.value.replace(/\n/g, " ") })}
								aria-label="Name (shown on the timeline)"
								title="Its name, shown on the timeline"
								className="min-w-0 flex-1 rounded-md border border-foreground/20 bg-background px-2 py-0.5"
							/>
						) : (
							// Enter starts a new line, up to BANNER.maxLines (coach, 11 Nov).
							<textarea
								value={b.text}
								rows={Math.min(BANNER.maxLines, Math.max(1, b.text.split("\n").length))}
								onChange={(e) => update(b.id, { text: e.target.value.split("\n").slice(0, BANNER.maxLines).map((line) => line.slice(0, BANNER.maxText)).join("\n") })}
								aria-label="Banner text"
								title={`Press Enter for a new line (up to ${BANNER.maxLines})`}
								className="min-w-0 flex-1 resize-none rounded-md border border-foreground/20 bg-background px-2 py-0.5"
							/>
						)}
						{b.kind !== "file" && (
							<button
								onClick={() => saveAsTemplate(b)}
								disabled={!cleanBannerText(b.text) || inTemplates(b)}
								title={inTemplates(b) ? "In My banners" : "Save to My banners, to use on any video"}
								aria-label="Save to My banners"
								className="rounded px-1.5 pt-1 text-foreground/50 hover:bg-foreground/10 hover:text-foreground disabled:opacity-30"
							>
								<Star className={`h-3.5 w-3.5 shrink-0 ${inTemplates(b) ? "fill-amber-400 text-amber-500" : ""}`} aria-hidden />
							</button>
						)}
						<button
							onClick={() => duplicate(b)}
							disabled={banners.length >= BANNER.maxBanners}
							title="Duplicate: a copy right after it"
							aria-label="Duplicate banner"
							className="rounded px-1.5 pt-1 text-foreground/50 hover:bg-foreground/10 hover:text-foreground disabled:opacity-30"
						>
							<Copy className="h-3.5 w-3.5 shrink-0" aria-hidden />
						</button>
						<button
							onClick={() => setRemoving(b)}
							aria-label="Remove banner"
							title="Delete this banner"
							className="rounded px-1.5 pt-1.5 text-foreground/50 hover:bg-red-500/10 hover:text-red-600"
						>
							<X className="h-3 w-3 shrink-0" aria-hidden />
						</button>
					</div>
					{open === b.id && (
						<LayerTools
							onMoveHere={() => moveHere(b)}
							onUp={() => onChange(moveLayer(banners, b.id, true, sameBannerPass))}
							onDown={() => onChange(moveLayer(banners, b.id, false, sameBannerPass))}
							place={layerPlace(banners, b.id, sameBannerPass)}
						/>
					)}
					{open === b.id && b.kind === "price" && (
						<input
							value={b.sub}
							maxLength={BANNER.maxText}
							onChange={(e) => update(b.id, { sub: e.target.value })}
							placeholder="Small line under it (optional)"
							aria-label="Small line"
							className="rounded-md border border-foreground/20 bg-background px-2 py-0.5"
						/>
					)}
					{open === b.id && b.kind === "file" && <>
						<p className="text-xs text-foreground/60">Pause the video on it to drag it anywhere, or drag its corner to make it bigger or smaller.</p>
						<select
							value={b.anim ?? "fade"}
							onChange={(e) => update(b.id, { anim: e.target.value as BannerAnim })}
							aria-label="How it arrives"
							className="self-start rounded-md border border-foreground/20 bg-background px-1 py-0.5 text-xs"
						>
							{(Object.keys(BANNER_ANIMS) as BannerAnim[]).map((a) => (
								<option key={a} value={a}>
									{BANNER_ANIMS[a].name}
								</option>
							))}
						</select>
						{range(b, "Size", b.scale ?? 1, BANNER_SCALE.min, BANNER_SCALE.max, 0.05, `${Math.round((b.scale ?? 1) * 100)}%`, (n) => update(b.id, { scale: n }))}
						{range(b, "Opacity", b.opacity ?? 1, BANNER_OPACITY.min, BANNER_OPACITY.max, 0.05, `${Math.round((b.opacity ?? 1) * 100)}%`, (n) => update(b.id, { opacity: n }))}
						{b.media === "video" && <ClipSound volume={b.volume} onChange={(volume) => update(b.id, { volume })} />}
					</>}
					{open === b.id && b.kind !== "file" && <>
					<div className="flex flex-wrap items-center gap-2 text-xs text-foreground/70">
						<select
							value={b.anim ?? "fade"}
							onChange={(e) => update(b.id, { anim: e.target.value as BannerAnim })}
							aria-label="How it arrives"
							className="rounded-md border border-foreground/20 bg-background px-1 py-0.5"
						>
							{(Object.keys(BANNER_ANIMS) as BannerAnim[]).map((a) => (
								<option key={a} value={a}>
									{BANNER_ANIMS[a].name}
								</option>
							))}
						</select>
						<select
							value={b.x !== undefined ? "dragged" : b.place}
							onChange={(e) => placeBanner(b, e.target.value)}
							aria-label="Where on the video"
							className="rounded-md border border-foreground/20 bg-background px-1 py-0.5"
						>
							<option value="dragged">{dragged[b.id] ? "Where you dragged it" : "Anywhere (drag it on the video)"}</option>
							<option value="top">Top</option>
							<option value="middle">Middle</option>
							<option value="bottom">Bottom</option>
						</select>
					</div>
					<div className="flex items-center gap-2 text-xs text-foreground/70">
						<span className="w-16 shrink-0">Font</span>
						<select
							value={b.font ?? ""}
							onChange={(e) => {
								const value = e.target.value;
								if (!value) update(b.id, { font: undefined, ownFont: undefined });
								else if (value === "own" && own) update(b.id, { font: "own", ownFont: own });
								else update(b.id, { font: value as FontId, ownFont: undefined });
							}}
							aria-label="Banner font"
							className="min-w-0 flex-1 rounded-md border border-foreground/20 bg-background px-1 py-0.5"
						>
							<option value="">Same as the subtitles</option>
							{(own || b.font === "own") && <option value="own">Your font: {(own ?? b.ownFont)?.family}</option>}
							{(Object.keys(FONTS) as FontId[]).map((id) => (
								<option key={id} value={id}>
									{FONTS[id].name}
									{FONTS[id].thai ? " (Thai)" : ""}
								</option>
							))}
						</select>
					</div>
					<div className="flex flex-wrap items-center gap-2 pl-[4.5rem] text-xs text-foreground/60">
						<label className={`cursor-pointer underline hover:text-foreground ${fontBusy ? "opacity-50" : ""}`}>
							{fontBusy ? "Uploading…" : own ? "Upload a different font (.ttf, .otf)" : "Upload your own font (.ttf, .otf)"}
							<input
								type="file"
								accept=".ttf,.otf,font/ttf,font/otf"
								className="hidden"
								disabled={fontBusy}
								onChange={(e) => {
									const file = e.target.files?.[0];
									e.target.value = "";
									if (file) void uploadFont(b, file);
								}}
							/>
						</label>
						{fontNote && <span className="text-red-500">{fontNote}</span>}
					</div>
					<label className="flex items-center gap-2 text-xs text-foreground/70">
						<span className="w-16 shrink-0">Background</span>
						<input type="checkbox" checked={!b.noBox} onChange={(e) => update(b.id, { noBox: e.target.checked ? undefined : true })} className="accent-blue-600" />
						<span>{b.noBox ? "Off: letters only" : "On"}</span>
					</label>
					{!b.noBox && swatches(b, "Box colour", "color", b.color ?? brand)}
					{swatches(b, "Text", "ink", b.ink ?? bannerInk(b.color ?? brand))}
					{range(b, "Size", b.scale ?? 1, BANNER_SCALE.min, BANNER_SCALE.max, 0.05, `${Math.round((b.scale ?? 1) * 100)}%`, (n) => update(b.id, { scale: n }))}
					{(b.text.includes("\n") || (b.kind === "price" && cleanBannerText(b.sub))) &&
						range(b, "Line gap", b.lineGap ?? 0, BANNER_LINE_GAP.min, BANNER_LINE_GAP.max, 2, String(b.lineGap ?? 0), (n) => update(b.id, { lineGap: n }))}
					{!b.noBox && range(b, "Corners", b.radius ?? 0, BANNER_RADIUS.min, BANNER_RADIUS.max, 2, String(b.radius ?? 0), (n) => update(b.id, { radius: n }))}
					{!b.noBox && range(b, "Opacity", b.opacity ?? 1, BANNER_OPACITY.min, BANNER_OPACITY.max, 0.05, `${Math.round((b.opacity ?? 1) * 100)}%`, (n) => update(b.id, { opacity: n }))}
					</>}
				</div>
			))}
			{shown.length > 0 && <p className="text-xs text-foreground/60">
					Drag a banner along the timeline to change when it shows, or its right end to change how long. Pause the video on a banner to drag it anywhere on the picture.
					{tab !== "file" && " Emoji can't be shown in banners."}
				</p>}
			{removing && (
				<ConfirmDelete
					name={`"${removing.text.replace(/\n/g, " ")}"`}
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
