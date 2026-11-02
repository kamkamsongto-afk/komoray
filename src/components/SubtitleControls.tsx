"use client";

import { type ReactNode, useEffect, useState } from "react";
import type { OwnFont } from "@/lib/font-info";
import { type Motion, MOTIONS } from "@/lib/motion";
import {
	COLORS,
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

type Props = {
	style: SubtitleStyle;
	onChange: (style: SubtitleStyle) => void;
	thai: boolean; // a Thai video: English-only fonts can't be picked
	footer?: ReactNode;
};

// How the subtitles look: style, font, brand colour, channel name, size and outline. Used in the
// editor (for one video) and on the Brand Kit page (for every new video).
export function SubtitleControls({ style, onChange, thai, footer }: Props) {
	// The user's own uploaded font (one per account), if any.
	const [own, setOwn] = useState<OwnFont | null>(null);
	const [uploading, setUploading] = useState(false);
	const [fontError, setFontError] = useState("");
	useEffect(() => {
		fetch("/api/font")
			.then((res) => (res.ok ? (res.json() as Promise<{ font: OwnFont | null }>) : { font: null }))
			.then((data) => setOwn(data.font))
			.catch(() => {});
	}, []);

	// The logo picture (one per account): uploading it turns it on for this look.
	const [logoBusy, setLogoBusy] = useState(false);
	const [logoError, setLogoError] = useState("");
	async function uploadLogo(file: File) {
		setLogoBusy(true);
		setLogoError("");
		const res = await fetch("/api/logo", { method: "POST", body: file }).catch(() => null);
		const data = (await res?.json().catch(() => ({}))) as { version?: number; error?: string };
		setLogoBusy(false);
		if (!res?.ok || !data.version) return setLogoError(data?.error ?? "Could not upload the logo");
		onChange({ ...style, logoImage: { version: data.version } });
	}

	async function uploadFont(file: File) {
		setUploading(true);
		setFontError("");
		const res = await fetch("/api/font", { method: "POST", body: file }).catch(() => null);
		const data = (await res?.json().catch(() => ({}))) as { font?: OwnFont; error?: string };
		setUploading(false);
		if (!res?.ok || !data.font) return setFontError(data?.error ?? "Could not upload the font");
		setOwn(data.font);
		onChange({ ...style, font: "own", ownFont: data.font });
	}

	const slider = (label: string, key: "size" | "outline") => (
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
			<span className="w-8 text-right tabular-nums">{style[key]}</span>
		</label>
	);

	return (
		<div className="flex flex-col gap-2 rounded-lg border border-foreground/15 p-3">
			<label className="flex items-center gap-3 text-sm text-foreground/70">
				<span className="w-24 shrink-0">Video shape</span>
				<select
					value={style.format}
					onChange={(e) => onChange({ ...style, format: e.target.value as Format, position: FORMATS[e.target.value as Format].position })}
					className="min-w-0 flex-1 rounded-md border border-foreground/20 bg-background px-2 py-1 text-foreground"
				>
					{(Object.keys(FORMATS) as Format[]).map((f) => (
						<option key={f} value={f}>
							{FORMATS[f].name}
						</option>
					))}
				</select>
			</label>
			<p className="text-sm font-medium">Subtitles</p>
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
			<label className="flex items-center gap-3 text-sm text-foreground/70">
				<span className="w-24 shrink-0">Font</span>
				<select
					value={style.font}
					onChange={(e) =>
						onChange(e.target.value === "own" && own ? { ...style, font: "own", ownFont: own } : { ...style, font: e.target.value as FontId, ownFont: undefined })
					}
					className="min-w-0 flex-1 rounded-md border border-foreground/20 bg-background px-2 py-1 text-foreground"
				>
					{(own || style.font === "own") && <option value="own">Your font: {(own ?? style.ownFont)?.family}</option>}
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
				<label className={`cursor-pointer underline hover:text-foreground ${uploading ? "opacity-50" : ""}`}>
					{uploading ? "Uploading…" : own ? "Upload a different font (.ttf, .otf)" : "Upload your own font (.ttf, .otf)"}
					<input
						type="file"
						accept=".ttf,.otf,font/ttf,font/otf"
						className="hidden"
						disabled={uploading}
						onChange={(e) => {
							const file = e.target.files?.[0];
							if (file) void uploadFont(file);
							e.target.value = "";
						}}
					/>
				</label>
				{fontError && <span className="text-red-600">❌ {fontError}</span>}
			</div>
			{slider("Text size", "size")}
			{style.look !== "box" && slider("Black outline", "outline")}
			<div className="flex items-center gap-3 text-sm text-foreground/70">
				<span className="w-24 shrink-0" title="Used by the Highlight style">
					Brand colour
				</span>
				<div className="flex flex-1 flex-wrap items-center gap-1.5">
					{COLORS.map((c) => (
						<button
							key={c}
							onClick={() => onChange({ ...style, color: c })}
							aria-label={`Colour ${c}`}
							className={`h-6 w-6 rounded-full border-2 ${style.color === c ? "border-foreground" : "border-transparent"}`}
							style={{ background: c }}
						/>
					))}
					<input
						type="color"
						value={style.color}
						onChange={(e) => onChange({ ...style, color: e.target.value.toUpperCase() })}
						aria-label="Any colour"
						className="h-6 w-8 cursor-pointer rounded border border-foreground/20 bg-transparent"
					/>
				</div>
			</div>
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
					{style.logoImage && (
						<button onClick={() => onChange({ ...style, logoImage: undefined })} className="rounded-md border border-foreground/20 px-2 py-1 hover:bg-foreground/5">
							Don&apos;t show
						</button>
					)}
					{!style.logoImage && <span className="text-foreground/50">PNG with a see-through background looks best. Shown instead of the name.</span>}
					{logoError && <span className="text-red-600">❌ {logoError}</span>}
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
			<label className="flex items-center gap-3 text-sm text-foreground/70" title="Jump: every other part is a little closer, like a second camera. Smooth: the picture glides slowly in and out.">
				<span className="w-24 shrink-0">Auto zoom</span>
				<select
					value={style.zoom}
					onChange={(e) => onChange({ ...style, zoom: e.target.value as Zoom })}
					className="flex-1 rounded-md border border-foreground/20 bg-background px-2 py-1 text-foreground"
				>
					<option value="off">Off</option>
					<option value="smooth">Smooth (slow glide)</option>
					<option value="cuts">Jump at every cut</option>
				</select>
			</label>
			{style.zoom !== "off" && (
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
			{style.zoom === "smooth" && (
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
			<p className="text-xs text-foreground/60">Drag the subtitles on the video to move them up or down.</p>
			{footer}
		</div>
	);
}
