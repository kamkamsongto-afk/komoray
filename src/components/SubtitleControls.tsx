"use client";

import { type ReactNode, useEffect, useState } from "react";
import { MY_FILE_KINDS, type MyFile } from "@/lib/my-files";
import { LOGO_EFFECTS, LOGO_MOTION, type LogoEffect } from "@/lib/logo-motion";
import { asOwnFont, ownValue, useMyFonts } from "@/lib/use-my-fonts";
import { ClashNote, OwnFontOptions } from "./MyFilePickers";
import { type Motion, MOTIONS } from "@/lib/motion";
import {
	COLORS,
	EDGE_COLORS,
	TEXT_COLORS,
	type Format,
	FORMATS,
	FONTS,
	type FontId,
	LIMITS,
	LOGO_CORNERS,
	type LogoCorner,
	type Look,
	LOOKS,
	MAX_LOGO_LENGTH,
	type SubtitleStyle,
	type Zoom,
	ZOOM_SPEEDS,
} from "@/lib/subtitle-style";
import { ZOOM_NAMES } from "@/lib/zoom";

type Props = {
	style: SubtitleStyle;
	onChange: (style: SubtitleStyle) => void;
	thai: boolean; // a Thai video: English-only fonts can't be picked
	footer?: ReactNode;
	top?: ReactNode; // shown first, above the section's own settings
	bodyHidden?: boolean; // only top and footer (the Zoom box's This part tab)
	section?: ControlSection; // show only this part (the editor's panels); left out: everything (Brand Kit page)
};

export type ControlSection = "text" | "zoom" | "shape" | "brand";

const ZOOM_CHOICES: { id: Zoom; name: string; hint: string }[] = [
	{ id: "off", name: "None", hint: "No zoom, except the parts that have their own" },
	{ id: "in", name: ZOOM_NAMES.in, hint: "Glides closer, then starts again at a cut" },
	{ id: "out", name: ZOOM_NAMES.out, hint: "Starts close and glides back, then starts again at a cut" },
	{ id: "smooth", name: ZOOM_NAMES.smooth, hint: "A slow glide in and back out" },
	{ id: "cuts", name: ZOOM_NAMES.cuts, hint: "Every other part is a little closer, like a second camera" },
];

// How the subtitles look: style, font, brand colour, channel name, size and outline. Used in the
// editor (for one video) and on the Brand Kit page (for every new video).
export function SubtitleControls({ style, onChange, thai, footer, top, section, bodyHidden }: Props) {
	const on = (part: ControlSection) => !bodyHidden && (!section || section === part);
	// Own fonts: My files and the one from before (lib/use-my-fonts.ts). A pick pins that very file in the style.
	const myFonts = useMyFonts();

	// The logo picture, kept in My files (lib/my-files.ts): uploaded once, then picked from the list. Uploading turns it
	// on for this look. The same file again is the one already there; another file with a name already used is asked
	// about (Use that one / Keep both), never written over.
	const [logos, setLogos] = useState<MyFile[]>([]);
	const [logoBusy, setLogoBusy] = useState(false);
	const [logoError, setLogoError] = useState("");
	const [logoClash, setLogoClash] = useState<{ file: File; conflict: MyFile } | null>(null);
	useEffect(() => {
		// Logos, and the other pictures in My files (from the AI studio's + Upload) except GIFs, which a logo can't be.
		const ask = (kind: string) =>
			fetch(`/api/files?kind=${kind}`)
				.then((res) => (res.ok ? (res.json() as Promise<{ files: MyFile[] }>) : { files: [] }))
				.then((data) => data.files)
				.catch(() => [] as MyFile[]);
		void Promise.all([ask("logo"), ask("image")]).then(([logos, pictures]) => setLogos([...logos, ...pictures.filter((p) => p.type !== "image/gif" && p.size <= MY_FILE_KINDS.logo.maxBytes)]));
	}, []);
	async function uploadLogo(file: File, then?: "use" | "keep") {
		setLogoBusy(true);
		setLogoError("");
		setLogoClash(null);
		const query = new URLSearchParams({ kind: "logo", name: file.name, ...(then && { then }) });
		const res = await fetch(`/api/files?${query}`, { method: "POST", body: file }).catch(() => null);
		const data = (await res?.json().catch(() => ({}))) as { file?: MyFile; conflict?: MyFile; error?: string };
		setLogoBusy(false);
		if (res?.status === 409 && data.conflict) return setLogoClash({ file, conflict: data.conflict });
		if (!res?.ok || !data.file) return setLogoError(data?.error ?? "Could not upload the logo");
		const added = data.file;
		setLogos((list) => [added, ...list.filter((f) => f.id !== added.id)]);
		onChange({ ...style, logoImage: { file: added.id } });
	}

	async function uploadFont(file: File, then?: "use" | "keep") {
		const font = await myFonts.upload(file, then);
		if (font) onChange({ ...style, font: "own", ownFont: font });
	}
	function pickFont(value: string) {
		const mine = value.startsWith("own:") ? myFonts.fonts.find((f) => f.id === value.slice(4)) : undefined;
		if (mine) return onChange({ ...style, font: "own", ownFont: asOwnFont(mine) });
		if (value === "own" && myFonts.older) return onChange({ ...style, font: "own", ownFont: myFonts.older });
		if (value === ownValue(style.ownFont)) return; // the font this look already has
		onChange({ ...style, font: value as FontId, ownFont: undefined });
	}

	const colours = (label: string, key: "color" | "textColor" | "outlineColor" | "boxColor", list: string[], hint?: string) => (
		<div className="flex items-center gap-3 text-sm text-foreground/70">
			<span className="w-24 shrink-0" title={hint}>
				{label}
			</span>
			<div className="flex flex-1 flex-wrap items-center gap-1.5">
				{list.map((c) => (
					<button
						key={c}
						onClick={() => onChange({ ...style, [key]: c })}
						aria-label={`${label} ${c}`}
						className={`h-6 w-6 rounded-full border-2 ${style[key] === c ? "border-blue-600" : "border-foreground/20"}`}
						style={{ background: c }}
					/>
				))}
				<input
					type="color"
					value={style[key]}
					onChange={(e) => onChange({ ...style, [key]: e.target.value.toUpperCase() })}
					aria-label={`Any ${label.toLowerCase()}`}
					className="h-6 w-8 cursor-pointer rounded border border-foreground/20 bg-transparent"
				/>
			</div>
		</div>
	);

	const slider = (label: string, key: "size" | "outline" | "letterSpacing" | "lineSpacing" | "boxRadius" | "boxOpacity", show: (n: number) => string | number = (n) => n) => (
		<label className="flex items-center gap-3 text-sm text-foreground/70">
			<span className="w-24 shrink-0">{label}</span>
			<input
				type="range"
				min={LIMITS[key].min}
				max={LIMITS[key].max}
				step={LIMITS[key].step}
				value={style[key]}
				onChange={(e) => onChange({ ...style, [key]: Number(e.target.value) })}
				className="flex-1"
			/>
			<span className="w-10 text-right tabular-nums">{show(style[key])}</span>
		</label>
	);

	return (
		<div className={`flex flex-col gap-2 p-3 ${section ? "" : "rounded-lg border border-foreground/15"}`}>
			{top}
			{on("shape") && <Zone on={!section} title="Video shape" tint="blue">
			<div className="flex items-start gap-3 text-sm text-foreground/70">
				{section && <span className="w-24 shrink-0 pt-2">Video shape</span>}
				{/* A picture of each shape instead of a list (coach, 6 Nov): what it is for shows on hover. */}
				<div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Video shape">
					{(Object.keys(FORMATS) as Format[]).map((f) => {
						const { width, height } = FORMATS[f];
						const big = 34; // px, the longer side of the little picture
						return (
							<button
								key={f}
								type="button"
								role="radio"
								aria-checked={style.format === f}
								title={`Best for ${FORMATS[f].for}`}
								onClick={() => onChange({ ...style, format: f, position: FORMATS[f].position })}
								className={`flex w-16 flex-col items-center gap-1 rounded-lg border px-1 pt-2 pb-1 ${
									style.format === f ? "border-blue-600 bg-blue-600/10 text-foreground" : "border-foreground/20 hover:bg-foreground/5"
								}`}
							>
								<span className="flex h-9 items-center justify-center">
									<span
										className={`block rounded-[3px] border-2 ${style.format === f ? "border-blue-600" : "border-current"}`}
										style={{ width: (big * width) / Math.max(width, height), height: (big * height) / Math.max(width, height) }}
									/>
								</span>
								<span className="text-xs font-medium tabular-nums">{f}</span>
							</button>
						);
					})}
				</div>
			</div>
			</Zone>}
			{on("text") && <Zone on={!section} title="Subtitles" tint="violet">
			<label className="flex items-center gap-2 text-sm">
				<input type="checkbox" checked={style.subtitles} onChange={(e) => onChange({ ...style, subtitles: e.target.checked })} />
				Show subtitles on the video
			</label>
			<div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Subtitle style">
				{(Object.keys(LOOKS) as Look[]).map((look) => (
					<button
						key={look}
						role="radio"
						aria-checked={style.look === look}
						title={LOOKS[look].hint}
						onClick={() =>
							onChange({
								...style,
								look,
								size: LOOKS[look].size,
								// The looks' heights are for 9:16; other shapes keep theirs (Big still goes to the middle).
								position: style.format === "9:16" || look === "big" ? LOOKS[look].position : FORMATS[style.format].position,
							})
						}
						className={`rounded-md border px-2.5 py-1 text-sm ${
							style.look === look ? "border-blue-600 bg-blue-600 text-white" : "border-foreground/20 hover:bg-foreground/5"
						}`}
					>
						{LOOKS[look].name}
					</button>
				))}
			</div>
			<p className="text-xs text-foreground/60">{LOOKS[style.look].hint}</p>
			<div className="flex items-center gap-3 text-sm text-foreground/70">
				<span className="w-24 shrink-0">Motion</span>
				<div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Subtitle motion">
					{(Object.keys(MOTIONS) as Motion[]).map((m) => (
						<button
							key={m}
							role="radio"
							aria-checked={style.motion === m}
							title={MOTIONS[m].hint}
							onClick={() => onChange({ ...style, motion: m })}
							className={`rounded-md border px-2.5 py-0.5 text-sm ${
								style.motion === m ? "border-blue-600 bg-blue-600 text-white" : "border-foreground/20 hover:bg-foreground/5"
							}`}
						>
							{MOTIONS[m].name}
						</button>
					))}
				</div>
			</div>
			<p className="text-xs text-foreground/60">{MOTIONS[style.motion].hint}</p>
			<label className="flex items-center gap-3 text-sm text-foreground/70">
				<span className="w-24 shrink-0">Font</span>
				<select
					value={style.font === "own" ? ownValue(style.ownFont) : style.font}
					onChange={(e) => pickFont(e.target.value)}
					className="min-w-0 flex-1 rounded-md border border-foreground/20 bg-background px-2 py-1 text-foreground"
				>
					<OwnFontOptions current={style.font === "own" ? style.ownFont : undefined} myFonts={myFonts} />
					{(Object.keys(FONTS) as FontId[])
						.filter((id) => FONTS[id].thai || !thai || id === style.font)
						.map((id) => (
							<option key={id} value={id}>
								{FONTS[id].name}
								{FONTS[id].thai ? "" : " (English only)"}
							</option>
						))}
				</select>
			</label>
			<div className="flex items-center gap-3 text-xs text-foreground/60">
				<span className="w-24 shrink-0" />
				<label className={`cursor-pointer underline hover:text-foreground ${myFonts.busy ? "opacity-50" : ""}`}>
					{myFonts.busy ? "Uploading…" : myFonts.fonts.length || myFonts.older ? "Upload another font (.ttf, .otf)" : "Upload your own font (.ttf, .otf)"}
					<input
						type="file"
						accept=".ttf,.otf,font/ttf,font/otf"
						className="hidden"
						disabled={myFonts.busy}
						onChange={(e) => {
							const file = e.target.files?.[0];
							if (file) void uploadFont(file);
							e.target.value = "";
						}}
					/>
				</label>
				{myFonts.error && <span className="text-red-600">{myFonts.error}</span>}
				{myFonts.clash && <ClashNote clash={myFonts.clash} what="font" onUse={() => void uploadFont(myFonts.clash!.file, "use")} onKeep={() => void uploadFont(myFonts.clash!.file, "keep")} onCancel={myFonts.dismiss} />}
			</div>
			{slider("Text size", "size")}
			{style.look !== "box" && slider("Outline", "outline")}
			{slider("Letter spacing", "letterSpacing")}
			{style.look === "two" && slider("Line spacing", "lineSpacing")}
			{colours("Text color", "textColor", TEXT_COLORS)}
			{style.look === "box" ? colours("Box color", "boxColor", EDGE_COLORS) : colours("Outline color", "outlineColor", EDGE_COLORS)}
			{style.look === "box" && slider("Corners", "boxRadius")}
			{style.look === "box" && slider("Box opacity", "boxOpacity", (n) => `${Math.round(n * 100)}%`)}
			{section === "text" && style.look === "highlight" && colours("Highlight", "color", COLORS)}
			<p className="text-xs text-foreground/60">Drag the subtitles on the video to move them up or down.</p>
			</Zone>}
			{on("brand") && <Zone on={!section} title="Brand & logo" tint="amber">
			{colours("Brand color", "color", COLORS, "Used by the Highlight style and banners")}
			<label className="flex items-center gap-3 text-sm text-foreground/70">
				<span className="w-24 shrink-0">Channel name</span>
				<input
					value={style.logo}
					maxLength={MAX_LOGO_LENGTH}
					onChange={(e) => onChange({ ...style, logo: e.target.value })}
					placeholder="e.g. @yourchannel"
					className="min-w-0 flex-1 rounded-md border border-foreground/20 bg-background px-2 py-1 text-foreground"
				/>
				<select
					value={style.logoAt}
					onChange={(e) => onChange({ ...style, logoAt: e.target.value as LogoCorner })}
					aria-label="Logo corner"
					disabled={!style.logo && !style.logoImage}
					className="rounded-md border border-foreground/20 bg-background px-1 py-1 text-foreground disabled:opacity-40"
				>
					{(Object.keys(LOGO_CORNERS) as LogoCorner[]).map((c) => (
						<option key={c} value={c}>
							{LOGO_CORNERS[c]}
						</option>
					))}
				</select>
			</label>
			<div className="flex items-center gap-3 text-sm text-foreground/70">
				<span className="w-24 shrink-0">Logo</span>
				<div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-xs">
					<label className={`cursor-pointer rounded-md border border-foreground/20 px-2 py-1 hover:bg-foreground/5 ${logoBusy ? "opacity-50" : ""}`}>
						{logoBusy ? "Uploading…" : style.logoImage ? "Change picture" : "Upload a picture"}
						<input
							type="file"
							accept="image/png,image/jpeg,image/webp"
							className="hidden"
							disabled={logoBusy}
							onChange={(e) => {
								const file = e.target.files?.[0];
								if (file) void uploadLogo(file);
								e.target.value = "";
							}}
						/>
					</label>
					{logos.length > 0 && (
						<select
							value={style.logoImage && "file" in style.logoImage ? style.logoImage.file : ""}
							onChange={(e) => e.target.value && onChange({ ...style, logoImage: { file: e.target.value } })}
							aria-label="Your logos"
							className="max-w-40 rounded-md border border-foreground/20 bg-background px-1 py-1 text-foreground"
						>
							<option value="">{style.logoImage ? "Picked before" : "Your logos…"}</option>
							{logos.map((f) => (
								<option key={f.id} value={f.id}>
									{f.name}
								</option>
							))}
						</select>
					)}
					{style.logoImage && (
						<button onClick={() => onChange({ ...style, logoImage: undefined })} className="rounded-md border border-foreground/20 px-2 py-1 hover:bg-foreground/5">
							Don&apos;t show
						</button>
					)}
					{!style.logoImage && <span className="text-foreground/50">PNG with a see-through background looks best. Shown instead of the name.</span>}
					{logoError && <span className="text-red-600">{logoError}</span>}
					{logoClash && <ClashNote clash={logoClash} what="logo" onUse={() => void uploadLogo(logoClash.file, "use")} onKeep={() => void uploadLogo(logoClash.file, "keep")} onCancel={() => setLogoClash(null)} />}
				</div>
			</div>
			{style.logoImage && (
				<>
					<label className="flex items-center gap-3 text-sm text-foreground/70">
						<span className="w-24 shrink-0">Logo size</span>
						<input
							type="range"
							min={LIMITS.logoSize.min}
							max={LIMITS.logoSize.max}
							step={LIMITS.logoSize.step}
							value={style.logoSize}
							onChange={(e) => onChange({ ...style, logoSize: Number(e.target.value) })}
							className="flex-1"
						/>
						<span className="w-8 text-right tabular-nums">{style.logoSize}</span>
					</label>
					<label className="flex items-center gap-3 text-sm text-foreground/70">
						<span className="w-24 shrink-0">Logo opacity</span>
						<input
							type="range"
							min={LIMITS.logoOpacity.min}
							max={LIMITS.logoOpacity.max}
							step={LIMITS.logoOpacity.step}
							value={style.logoOpacity}
							onChange={(e) => onChange({ ...style, logoOpacity: Number(e.target.value) })}
							className="flex-1"
						/>
						<span className="w-8 text-right tabular-nums">{Math.round(style.logoOpacity * 100)}%</span>
					</label>
				</>
			)}
			{(style.logo || style.logoImage) && (
				<>
					{/* How the logo comes and goes (lib/logo-motion.ts; coach 21 Nov, in place of Zoom here). */}
					<div className="flex items-start gap-3 text-sm text-foreground/70">
						<span className="w-24 shrink-0 pt-1">Logo effect</span>
						<div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Logo effect">
							{(Object.keys(LOGO_EFFECTS) as LogoEffect[]).map((id) => (
								<button
									key={id}
									type="button"
									role="radio"
									aria-checked={style.logoEffect === id}
									title={LOGO_EFFECTS[id].hint}
									onClick={() => onChange({ ...style, logoEffect: id })}
									className={`rounded-md border px-2.5 py-0.5 text-sm ${style.logoEffect === id ? "border-blue-600 bg-blue-600 text-white" : "border-foreground/20 hover:bg-foreground/5"}`}
								>
									{LOGO_EFFECTS[id].name}
								</button>
							))}
						</div>
					</div>
					{style.logoEffect !== "still" && (
						<label className="flex items-center gap-3 text-sm text-foreground/70" title="How long it takes to come in and to go">
							<span className="w-24 shrink-0">Speed</span>
							<input
								type="range"
								min={LIMITS.logoSpeed.min}
								max={LIMITS.logoSpeed.max}
								step={LIMITS.logoSpeed.step}
								value={style.logoSpeed}
								onChange={(e) => onChange({ ...style, logoSpeed: Number(e.target.value) })}
								className="flex-1"
							/>
							<span className="w-12 text-right tabular-nums">{style.logoSpeed.toFixed(1)} s</span>
						</label>
					)}
					<label className="flex items-center gap-3 text-sm text-foreground/70" title={`Always on, or on for ${LOGO_MOTION.show} s, then gone this long, again and again`}>
						<span className="w-24 shrink-0">Shows</span>
						<input
							type="range"
							min={LIMITS.logoEvery.min}
							max={LIMITS.logoEvery.max}
							step={LIMITS.logoEvery.step}
							value={style.logoEvery}
							onChange={(e) => onChange({ ...style, logoEvery: Number(e.target.value) })}
							className="flex-1"
						/>
						<span className="w-32 text-right tabular-nums">{style.logoEvery === 0 ? "Always" : `${LOGO_MOTION.show} s on, ${style.logoEvery} s off`}</span>
					</label>
				</>
			)}
			</Zone>}
			{/* The editor's Zoom box only: not on the Brand Kit page (withVideoZoom in lib/subtitle-style.ts). */}
			{section === "zoom" && !bodyHidden && <>
			{/* Short names (coach, 6 Nov): what each one does shows on hover. */}
			<div className="flex items-start gap-3 text-sm text-foreground/70">
				<span className="w-24 shrink-0 pt-1" title={section ? "Everywhere that has no zoom part of its own" : undefined}>
					{section ? "Whole video" : "Auto zoom"}
				</span>
				<div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Auto zoom">
					{ZOOM_CHOICES.map((z) => (
						<button
							key={z.id}
							type="button"
							role="radio"
							aria-checked={style.zoom === z.id}
							title={z.hint}
							onClick={() => onChange({ ...style, zoom: z.id })}
							className={`rounded-md border px-2.5 py-0.5 text-sm ${style.zoom === z.id ? "border-blue-600 bg-blue-600 text-white" : "border-foreground/20 hover:bg-foreground/5"}`}
						>
							{z.name}
						</button>
					))}
				</div>
			</div>
			{(style.zoom !== "off" || section) && (
				<label className="flex items-center gap-3 text-sm text-foreground/70" title="How much closer the picture gets">
					<span className="w-24 shrink-0">Zoom amount</span>
					<input
						type="range"
						min={LIMITS.zoomAmount.min}
						max={LIMITS.zoomAmount.max}
						step={LIMITS.zoomAmount.step}
						value={style.zoomAmount}
						onChange={(e) => onChange({ ...style, zoomAmount: Number(e.target.value) })}
						className="flex-1"
					/>
					<span className="w-8 text-right tabular-nums">{Math.round((style.zoomAmount - 1) * 100)}%</span>
				</label>
			)}
			{style.zoom !== "off" && style.zoom !== "cuts" && (
				<div className="flex items-center gap-3 text-sm text-foreground/70">
					<span className="w-24 shrink-0">Zoom speed</span>
					<div className="flex gap-1">
						{ZOOM_SPEEDS.map((s) => (
							<button
								key={s.period}
								type="button"
								onClick={() => onChange({ ...style, zoomPeriod: s.period })}
								className={`rounded-md border px-2.5 py-1 ${style.zoomPeriod === s.period ? "border-blue-600 bg-blue-600 text-white" : "border-foreground/20 hover:bg-foreground/5"}`}
							>
								{s.name}
							</button>
						))}
					</div>
				</div>
			)}
			</>}
			{footer}
		</div>
	);
}

// The Brand Kit page's areas, each its own tint so they read apart (coach 21 Nov). In the editor's panels (on false)
// the settings show as they are: each panel is one area already.
const ZONE_TINTS = {
	blue: "border-blue-500/40 bg-blue-500/10",
	violet: "border-violet-500/40 bg-violet-500/10",
	amber: "border-amber-500/50 bg-amber-500/10",
} as const;
function Zone({ on, title, tint, children }: { on: boolean; title: string; tint: keyof typeof ZONE_TINTS; children: ReactNode }) {
	if (!on) return <>{children}</>;
	return (
		<section className={`flex flex-col gap-2 rounded-lg border p-3 ${ZONE_TINTS[tint]}`}>
			<p className="text-sm font-semibold">{title}</p>
			{children}
		</section>
	);
}
