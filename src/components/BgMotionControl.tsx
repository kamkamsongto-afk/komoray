"use client";

import { BG_MOTION, BG_MOTIONS, BG_SPEED_LEGACY, type BgMotion } from "@/lib/bg-motion";

// One control for a background picture or clip that moves while it shows (coach 23 Nov): pick one way (Still, Zoom in / out,
// Pan left / right, Tilt up / down), then Amount and Speed on sliders. Used by Layout, Frame Me and Cutout, so they all look
// and work the same. motion undefined = Still. The maths is in lib/bg-motion.ts.
type Props = {
	motion: BgMotion | undefined;
	amount: number | undefined;
	speed: number | undefined;
	onMotion: (motion: BgMotion | undefined) => void;
	onAmount: (amount: number) => void;
	onSpeed: (speed: number) => void;
	tone?: string; // a colour for the picked choice (the box's blue)
};

export function BgMotionControl({ motion, amount, speed, onMotion, onAmount, onSpeed, tone = "#4D8DBA" }: Props) {
	const a = amount ?? BG_MOTION.amount.start;
	const s = speed ?? BG_SPEED_LEGACY;
	const slider = (label: string, value: number, min: number, max: number, step: number, show: string, set: (n: number) => void) => (
		<label className="flex items-center gap-2 text-xs text-foreground/70">
			<span className="w-16 shrink-0">{label}</span>
			<input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} className="min-w-0 flex-1 accent-blue-600" />
			<span className="w-12 tabular-nums">{show}</span>
		</label>
	);
	return (
		<div className="flex flex-col gap-1.5">
			<div role="radiogroup" aria-label="Movement" className="grid grid-cols-4 gap-1">
				{BG_MOTIONS.map(([id, name]) => {
					const picked = (motion ?? "still") === id;
					return (
						<button
							key={id}
							role="radio"
							aria-checked={picked}
							onClick={() => onMotion(id === "still" ? undefined : id)}
							className={`rounded-md border px-1 py-1 text-[11px] leading-tight ${picked ? "font-medium" : "border-foreground/20 text-foreground/70 hover:bg-foreground/5"}`}
							style={picked ? { borderColor: tone, background: `${tone}33` } : undefined}
						>
							{name}
						</button>
					);
				})}
			</div>
			{motion && slider("Amount", a, BG_MOTION.amount.min, BG_MOTION.amount.max, 0.05, `${Math.round(a * 100)}%`, onAmount)}
			{motion && slider("Speed", s, BG_MOTION.speed.min, BG_MOTION.speed.max, 0.1, `${s.toFixed(1)}×`, onSpeed)}
		</div>
	);
}
