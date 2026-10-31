"use client";

import { BANNER, BANNER_KINDS, type Banner, type BannerKind, type BannerPlace, cleanBannerText } from "@/lib/banners";

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
							value={b.place}
							onChange={(e) => update(b.id, { place: e.target.value as BannerPlace })}
							aria-label="Where on the video"
							className="rounded-md border border-foreground/20 bg-background px-1 py-0.5"
						>
							<option value="top">Top</option>
							<option value="middle">Middle</option>
							<option value="bottom">Bottom</option>
						</select>
					</div>
				</div>
			))}
			{banners.length > 0 && <p className="text-xs text-foreground/60">Times are seconds of the final video. Emoji can&apos;t be shown in banners.</p>}
		</div>
	);
}
