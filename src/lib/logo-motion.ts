// How the logo (picture or channel name) comes and goes (coach 21 Nov, in place of Zoom on the Brand Kit page).
// The same sums as logo_motion / logo_picture_filters / logo_text_events in render.py: change one side, change the other.
// effect: still (just there), fade (fades in and out), flash (a soft flash of light as it comes and goes), zoom (grows
// in from its corner and shrinks back). speed: seconds each coming and going takes. every: 0 = always on (it comes in
// once, at the start), else it shows SHOW seconds, then is gone `every` seconds, again and again.
export type LogoEffect = "still" | "fade" | "flash" | "zoom";
export const LOGO_EFFECTS: Record<LogoEffect, { name: string; hint: string }> = {
	still: { name: "Still", hint: "Just there" },
	fade: { name: "Fade", hint: "Fades in and out" },
	flash: { name: "Soft flash", hint: "A soft flash of light as it comes and goes" },
	zoom: { name: "Zoom", hint: "Grows in from its corner and shrinks back" },
};
export const LOGO_MOTION = {
	show: 5, // seconds on screen each time, when it comes and goes
	zoomFrom: 0.6, // Zoom: the size it grows from, share of its own
	flash: 1.5, // Soft flash: how much brighter at the start (a picture's colours × 1 + this), fading to normal
	glow: 6, // Soft flash on the channel name: the white glow's blur, px, at the start
};

// How far in it is at `t` seconds of the final video: 0 gone .. 1 fully in.
export function logoIn(t: number, effect: LogoEffect, speed: number, every: number) {
	const s = Math.max(0.05, speed);
	if (every <= 0) return effect === "still" ? 1 : Math.min(1, Math.max(0, t / s));
	const u = t % (LOGO_MOTION.show + every);
	if (u >= LOGO_MOTION.show) return 0;
	return effect === "still" ? 1 : Math.max(0, Math.min(1, u / s, (LOGO_MOTION.show - u) / s));
}

// What the logo looks like at `t`: opacity share (of its own), size share, brightness (picture), glow share (name).
export function logoLook(t: number, effect: LogoEffect, speed: number, every: number) {
	const e = logoIn(t, effect, speed, every);
	return {
		opacity: e,
		scale: effect === "zoom" ? LOGO_MOTION.zoomFrom + (1 - LOGO_MOTION.zoomFrom) * e : 1,
		bright: effect === "flash" ? 1 + LOGO_MOTION.flash * (1 - e) : 1,
		glow: effect === "flash" ? 1 - e : 0,
	};
}
