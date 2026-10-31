"use client";

import { type ReactNode } from "react";
import { COLORS, FONTS, type FontId, LIMITS, type Look, LOOKS, MAX_LOGO_LENGTH, type SubtitleStyle } from "@/lib/subtitle-style";

type Props = {
	style: SubtitleStyle;
	onChange: (style: SubtitleStyle) => void;
	thai: boolean; // a Thai video: English-only fonts can't be picked
	footer?: ReactNode;
};

// How the subtitles look: style, font, brand colour, channel name, size and outline. Used in the
// editor (for one video) and on the Brand Kit page (for every new video).
export function SubtitleControls({ style, onChange, thai, footer }: Props) {
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
					onChange={(e) => onChange({ ...style, font: e.target.value as FontId })}
					className="flex-1 rounded-md border border-foreground/20 bg-background px-2 py-1 text-foreground"
				>
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
			<p className="text-xs text-foreground/60">Drag the subtitles on the video to move them up or down.</p>
			{footer}
		</div>
	);
}
