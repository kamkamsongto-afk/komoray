"use client";

import { type ReactNode, useEffect, useState } from "react";
import type { OwnFont } from "@/lib/font-info";
import { COLORS, FONTS, type FontId, LIMITS, type Look, LOOKS, MAX_LOGO_LENGTH, type SubtitleStyle, type Zoom } from "@/lib/subtitle-style";

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
			<p className="text-sm font-medium">Subtitles</p>
			<div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Subtitle style">
				{(Object.keys(LOOKS) as Look[]).map((look) => (
					<button
						key={look}
						role="radio"
						aria-checked={style.look === look}
						title={LOOKS[look].hint}
						onClick={() => onChange({ ...style, look, size: LOOKS[look].size, position: LOOKS[look].position })}
						className={`rounded-md border px-2.5 py-1 text-sm ${
							style.look === look ? "border-blue-600 bg-blue-600 text-white" : "border-foreground/20 hover:bg-foreground/5"
						}`}
					>
						{LOOKS[look].name}
					</button>
				))}
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
					onChange={(e) => onChange({ ...style, logoAt: e.target.value as SubtitleStyle["logoAt"] })}
					aria-label="Channel name corner"
					disabled={!style.logo}
					className="rounded-md border border-foreground/20 bg-background px-1 py-1 text-foreground disabled:opacity-40"
				>
					<option value="top-left">Top left</option>
					<option value="top-right">Top right</option>
				</select>
			</label>
			<label className="flex items-center gap-3 text-sm text-foreground/70" title="Every other part is shown a little closer, so cuts look like a second camera">
				<span className="w-24 shrink-0">Auto zoom</span>
				<select
					value={style.zoom}
					onChange={(e) => onChange({ ...style, zoom: e.target.value as Zoom })}
					className="flex-1 rounded-md border border-foreground/20 bg-background px-2 py-1 text-foreground"
				>
					<option value="off">Off</option>
					<option value="cuts">Zoom in and out at every cut</option>
				</select>
			</label>
			<p className="text-xs text-foreground/60">Drag the subtitles on the video to move them up or down.</p>
			{footer}
		</div>
	);
}
