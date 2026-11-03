"use client";

import { ChevronDown, ChevronRight, Star, X } from "lucide-react";
import { useEffect, useState } from "react";
import { BANNER, BANNER_ANIMS, BANNER_KINDS, BANNER_OPACITY, BANNER_RADIUS, BANNER_SCALE, type Banner, type BannerAnim, type BannerKind, type BannerPlace, bannerInk, cleanBannerText } from "@/lib/banners";
import { EDGE_COLORS } from "@/lib/subtitle-style";

type Props = {
	banners: Banner[];
	onChange: (banners: Banner[]) => void;
	now: () => number; // where the preview is, in seconds of the final video
	total: number; // length of the final video, seconds
	brand: string; // the Brand Kit's colour: a banner's background until one is picked
	focus: string | null; // the banner just clicked on the timeline: open it here
};

// The two kinds to add. Follow still shows on videos that already have one: it was the same as a call to action.
const ADD_KINDS: BannerKind[] = ["price", "cta"];

const round = (n: number) => Math.round(n * 10) / 10;

// The editor's Banners box: add a price tag, a call to action or "follow me" at the spot the
// preview is at, then change its words, place and when it shows.
export function BannerControls({ banners, onChange, now, total, brand, focus }: Props) {
	// One banner open at a time, so the panel stays short and the timeline below it stays in reach.
	const [open, setOpen] = useState<string | null>(focus);
	useEffect(() => setOpen(focus), [focus]);
	const update = (id: string, patch: Partial<Banner>) => onChange(banners.map((b) => (b.id === id ? { ...b, ...patch } : b)));

	// My banners: saved to the account, for any video. Each starts at 0 and ends after as long as it shows.
	const [templates, setTemplates] = useState<Banner[]>([]);
	useEffect(() => {
		void fetch("/api/banner-templates")
			.then(async (res) => (res.ok ? ((await res.json()) as { templates?: Banner[] }) : {}))
			.then((data: { templates?: Banner[] }) => setTemplates(data.templates ?? []))
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
	function addTemplate(t: Banner) {
		const start = round(Math.min(now(), Math.max(0, total - 1)));
		const id = crypto.randomUUID();
		setOpen(id);
		onChange([...banners, { ...t, id, start, end: round(Math.min(total, start + t.end)) }].sort((a, b) => a.start - b.start));
	}

	function add(kind: BannerKind) {
		const start = round(Math.min(now(), Math.max(0, total - 1)));
		const preset = BANNER_KINDS[kind];
		const banner: Banner = { id: crypto.randomUUID(), kind, text: preset.text, sub: preset.sub, start, end: round(Math.min(total, start + BANNER.seconds)), place: "top" };
		setOpen(banner.id);
		onChange([...banners, banner].sort((a, b) => a.start - b.start));
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

	return (
		<div className="flex flex-col gap-2 p-3 pt-1">
			<div className="flex flex-wrap items-center gap-1.5">
				{ADD_KINDS.map((kind) => (
					<button
						key={kind}
						onClick={() => add(kind)}
						disabled={banners.length >= BANNER.maxBanners}
						className="rounded-md border border-foreground/20 px-2 py-1 text-sm hover:bg-foreground/5 disabled:opacity-40"
					>
						+ {BANNER_KINDS[kind].name}
					</button>
				))}
			</div>
			{templates.length > 0 && (
				<div className="flex flex-wrap items-center gap-1.5 text-sm">
					<span className="text-xs text-foreground/60">My banners</span>
					{templates.map((t) => (
						<span key={t.id} className="flex items-center rounded-md border border-foreground/20">
							<button
								onClick={() => addTemplate(t)}
								disabled={banners.length >= BANNER.maxBanners}
								title="Add it where the video is now"
								className="max-w-40 truncate rounded-l-md px-2 py-0.5 hover:bg-foreground/5 disabled:opacity-40"
							>
								+ {t.text}
							</button>
							<button
								onClick={() => saveTemplates(templates.filter((x) => x.id !== t.id))}
								aria-label={`Forget ${t.text}`}
								className="rounded-r-md px-1.5 py-0.5 text-foreground/50 hover:bg-red-500/10 hover:text-red-600"
							>
								<X className="h-3 w-3 shrink-0" aria-hidden />
							</button>
						</span>
					))}
				</div>
			)}
			{banners.length === 0 && (
				<p className="text-xs text-foreground/60">A price or a call to action. It is added where the video is now, and shows on the timeline: drag it there to change when it appears.</p>
			)}
			{banners.map((b) => (
				<div key={b.id} className="flex flex-col gap-1.5 rounded-md bg-foreground/5 p-2 text-sm">
					<div className="flex items-center gap-2">
						<button
							onClick={() => setOpen(open === b.id ? null : b.id)}
							aria-expanded={open === b.id}
							title={open === b.id ? "Hide its settings" : "Show its settings"}
							className="flex w-16 shrink-0 items-center gap-0.5 text-left text-xs text-foreground/60 hover:text-foreground"
						>
							{open === b.id ? <ChevronDown className="h-3 w-3 shrink-0" aria-hidden /> : <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />}
							{b.kind === "cta" ? "CTA" : BANNER_KINDS[b.kind].name}
						</button>
						<input
							value={b.text}
							maxLength={BANNER.maxText}
							onChange={(e) => update(b.id, { text: e.target.value })}
							aria-label="Banner text"
							className="min-w-0 flex-1 rounded-md border border-foreground/20 bg-background px-2 py-0.5"
						/>
						<button
							onClick={() => saveAsTemplate(b)}
							disabled={!cleanBannerText(b.text) || templates.some((t) => t.text === cleanBannerText(b.text) && t.sub === b.sub)}
							title="Save to My banners, to use on any video"
							aria-label="Save to My banners"
							className="rounded px-1.5 text-foreground/50 hover:bg-foreground/10 hover:text-foreground disabled:opacity-30"
						>
							<Star className="h-3.5 w-3.5 shrink-0" aria-hidden />
						</button>
						<button
							onClick={() => onChange(banners.filter((x) => x.id !== b.id))}
							aria-label="Remove banner"
							className="rounded px-1.5 text-foreground/50 hover:bg-red-500/10 hover:text-red-600"
						>
							<X className="h-3 w-3 shrink-0" aria-hidden />
						</button>
					</div>
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
					{open === b.id && <>
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
							onChange={(e) => e.target.value !== "dragged" && update(b.id, { place: e.target.value as BannerPlace, x: undefined, y: undefined })}
							aria-label="Where on the video"
							className="rounded-md border border-foreground/20 bg-background px-1 py-0.5"
						>
							{b.x !== undefined && <option value="dragged">Where you dragged it</option>}
							<option value="top">Top</option>
							<option value="middle">Middle</option>
							<option value="bottom">Bottom</option>
						</select>
					</div>
					{swatches(b, "Background", "color", b.color ?? brand)}
					{swatches(b, "Text", "ink", b.ink ?? bannerInk(b.color ?? brand))}
					{range(b, "Size", b.scale ?? 1, BANNER_SCALE.min, BANNER_SCALE.max, 0.05, `${Math.round((b.scale ?? 1) * 100)}%`, (n) => update(b.id, { scale: n }))}
					{range(b, "Corners", b.radius ?? 0, BANNER_RADIUS.min, BANNER_RADIUS.max, 2, String(b.radius ?? 0), (n) => update(b.id, { radius: n }))}
					{range(b, "Opacity", b.opacity ?? 1, BANNER_OPACITY.min, BANNER_OPACITY.max, 0.05, `${Math.round((b.opacity ?? 1) * 100)}%`, (n) => update(b.id, { opacity: n }))}
					</>}
				</div>
			))}
			{banners.length > 0 && <p className="text-xs text-foreground/60">
					Drag a banner along the timeline to change when it shows, or its right end to change how long. Pause the video on a banner to drag it anywhere on the picture.
					Emoji can&apos;t be shown in banners.
				</p>}
		</div>
	);
}
