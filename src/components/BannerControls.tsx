"use client";

import { useEffect, useState } from "react";
import { BANNER, BANNER_KINDS, BANNER_SCALE, type Banner, type BannerKind, type BannerPlace, cleanBannerText } from "@/lib/banners";

type Props = {
	banners: Banner[];
	onChange: (banners: Banner[]) => void;
	now: () => number; // where the preview is, in seconds of the final video
	total: number; // length of the final video, seconds
	channel: string; // the Brand Kit's channel name, for the Follow banner
};

const round = (n: number) => Math.round(n * 10) / 10;

// The editor's Banners box: add a price tag, a call to action or "follow me" at the spot the
// preview is at, then change its words, place and when it shows.
export function BannerControls({ banners, onChange, now, total, channel }: Props) {
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
		onChange([...banners, { ...t, id: crypto.randomUUID(), start, end: round(Math.min(total, start + t.end)) }].sort((a, b) => a.start - b.start));
	}

	function add(kind: BannerKind) {
		const start = round(Math.min(now(), Math.max(0, total - 1)));
		const preset = BANNER_KINDS[kind];
		const text = kind === "follow" && channel ? cleanBannerText(`Follow ${channel}`) : preset.text;
		const banner: Banner = { id: crypto.randomUUID(), kind, text, sub: preset.sub, start, end: round(Math.min(total, start + BANNER.seconds)), place: "top" };
		onChange([...banners, banner].sort((a, b) => a.start - b.start));
	}

	const time = (b: Banner, key: "start" | "end") => (
		<span className="flex items-center gap-1">
			<input
				type="number"
				min={0}
				max={total}
				step={0.1}
				value={b[key]}
				onChange={(e) => update(b.id, { [key]: Math.max(0, Number(e.target.value) || 0) })}
				aria-label={key === "start" ? "Shows from (seconds)" : "Shows until (seconds)"}
				className="w-16 rounded-md border border-foreground/20 bg-background px-1.5 py-0.5 tabular-nums"
			/>
			<button
				onClick={() => update(b.id, { [key]: round(now()) })}
				title="Where the video is now"
				className="rounded border border-foreground/20 px-1.5 py-0.5 text-xs hover:bg-foreground/5"
			>
				Now
			</button>
		</span>
	);

	return (
		<div className="flex flex-col gap-2 rounded-lg border border-foreground/15 p-3">
			<div className="flex flex-wrap items-center gap-1.5">
				<p className="mr-auto text-sm font-medium">Banners</p>
				{(Object.keys(BANNER_KINDS) as BannerKind[]).map((kind) => (
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
								✕
							</button>
						</span>
					))}
				</div>
			)}
			{banners.length === 0 && (
				<p className="text-xs text-foreground/60">A price, a call to action or &quot;follow me&quot;, in your brand colour. It is added where the video is now.</p>
			)}
			{banners.map((b) => (
				<div key={b.id} className="flex flex-col gap-1.5 rounded-md bg-foreground/5 p-2 text-sm">
					<div className="flex items-center gap-2">
						<span className="w-20 shrink-0 text-xs text-foreground/60">{BANNER_KINDS[b.kind].name}</span>
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
							⭐
						</button>
						<button
							onClick={() => onChange(banners.filter((x) => x.id !== b.id))}
							aria-label="Remove banner"
							className="rounded px-1.5 text-foreground/50 hover:bg-red-500/10 hover:text-red-600"
						>
							✕
						</button>
					</div>
					{b.kind === "price" && (
						<input
							value={b.sub}
							maxLength={BANNER.maxText}
							onChange={(e) => update(b.id, { sub: e.target.value })}
							placeholder="Small line under it (optional)"
							aria-label="Small line"
							className="ml-[5.5rem] rounded-md border border-foreground/20 bg-background px-2 py-0.5"
						/>
					)}
					<div className="ml-[5.5rem] flex flex-wrap items-center gap-2 text-xs text-foreground/70">
						{time(b, "start")}
						<span>to</span>
						{time(b, "end")}
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
					<label className="ml-[5.5rem] flex items-center gap-2 text-xs text-foreground/70">
						Size
						<input
							type="range"
							min={BANNER_SCALE.min}
							max={BANNER_SCALE.max}
							step={0.05}
							value={b.scale ?? 1}
							onChange={(e) => update(b.id, { scale: Number(e.target.value) })}
							className="min-w-0 flex-1 accent-blue-600"
						/>
						<span className="w-10 tabular-nums">{Math.round((b.scale ?? 1) * 100)}%</span>
					</label>
				</div>
			))}
			{banners.length > 0 && <p className="text-xs text-foreground/60">
					Times are seconds of the final video. Pause the video on a banner to drag it anywhere, or drag its round corner to resize it.
					Emoji can&apos;t be shown in banners.
				</p>}
		</div>
	);
}
