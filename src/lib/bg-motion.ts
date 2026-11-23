// A background picture or clip that moves slowly while it shows (coach 23 Nov): zoom in, zoom out, pan left / right, tilt up /
// down, one at a time, with an Amount (how much) and a Speed (how fast it gets there). Used by Layout's picture or clip, Frame
// Me's background and Cutout's picture, so they all move the same way. Same maths as bg_motion_filter in render.py.
//
// The picture is looked at through a window: s = how much it is blown up (1 = the whole picture), x, y = the window's top
// left corner as a share of the picture (0 up to 1 - 1/s). A pan or tilt blows the picture up by 1 + Amount and slides the
// window across the extra, so its edge never shows. Speed: 1 takes the whole time it shows; 2 gets there in half of it and
// holds; 0.5 only gets half way.

export type BgMotion = "in" | "out" | "panLeft" | "panRight" | "tiltUp" | "tiltDown";

export const BG_MOTIONS: [BgMotion | "still", string][] = [
	["still", "Still"],
	["in", "Zoom in"],
	["out", "Zoom out"],
	["panLeft", "Pan left"],
	["panRight", "Pan right"],
	["tiltUp", "Tilt up"],
	["tiltDown", "Tilt down"],
];

// amount: share bigger the picture gets (0.2 = 20%). speed: times as fast as taking all the time it shows. BG_AMOUNT / BG_SPEED in render.py.
// Amount -100%..120%: zoom in / out with a negative amount does the other way (the whole picture is shown smaller); pan and tilt
// need the picture bigger than the screen, so their amount is at least 5%. Speed 0.5x..20x: 1x = takes all the time it shows, the
// default for a new picture is 2x (coach 23 Nov); a picture saved without a speed plays at 1x, as it always did.
export const BG_MOTION = { amount: { min: -1, max: 1.2, start: 0.2 }, speed: { min: 0.5, max: 20, start: 2 } };
export const BG_SPEED_LEGACY = 1;

export const isBgMotion = (v: unknown): v is BgMotion => typeof v === "string" && BG_MOTIONS.some(([id]) => id === v && id !== "still");

export function bgWindow(motion: BgMotion | undefined, amount: number | undefined, speed: number | undefined, t: number, start: number, end: number) {
	if (!motion) return { s: 1, x: 0, y: 0 };
	const a = Math.min(BG_MOTION.amount.max, Math.max(BG_MOTION.amount.min, amount ?? BG_MOTION.amount.start));
	const p = Math.min(1, Math.max(0, ((t - start) / (end - start)) * Math.min(BG_MOTION.speed.max, Math.max(BG_MOTION.speed.min, speed ?? BG_SPEED_LEGACY))));
	const grow = motion === "in" ? a * p : motion === "out" ? a * (1 - p) : Math.max(a, 0.05);
	const s = Math.max(0.1, 1 + grow);
	const room = 1 - 1 / s; // how much of the picture the window can slide over
	const fx = motion === "panRight" ? p : motion === "panLeft" ? 1 - p : 0.5;
	const fy = motion === "tiltDown" ? p : motion === "tiltUp" ? 1 - p : 0.5;
	return { s, x: room * fx, y: room * fy };
}

// The speed and amount to save when a picture gets its movement: a new one gets the default speed, an old one keeps its own.
export const startMotion = (motion: BgMotion | undefined, speed: number | undefined) => (motion && speed === undefined ? BG_MOTION.speed.start : speed);

// The same window as a CSS style for a box that is the whole picture's size: blown up from its top left corner, then slid so
// the window's corner is the box's corner.
export const bgStyle = (w: { s: number; x: number; y: number }): { transform?: string; transformOrigin?: string } =>
	w.s === 1 ? {} : { transformOrigin: "0 0", transform: `scale(${w.s}) translate(${-w.x * 100}%, ${-w.y * 100}%)` };
