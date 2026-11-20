// Fade in / Fade out switches (coach 20 Nov): every Banner, Cutout text, Cutout picture or clip and Frame Me fades in and
// out by default; either switch off makes that edge a cut, at once. Saved only when off (fadeIn: false / fadeOut: false),
// so items saved before keep both fades. Same as fades_of in modal_app/render.py.
export type Fades = { fadeIn?: false; fadeOut?: false };

export const fadesOn = (f: Fades) => ({ in: f.fadeIn !== false, out: f.fadeOut !== false });

// How far it shows at second t from its edges, 0..1, fading over `seconds` at each edge that is switched on.
export function fadeLevel(item: Fades & { start: number; end: number }, t: number, seconds: number) {
	const on = fadesOn(item);
	return Math.max(0, Math.min(1, on.in ? (t - item.start) / seconds : 1, on.out ? (item.end - t) / seconds : 1));
}

// Checking what the browser sends: kept only when switched off.
export const readFades = (raw: Record<string, unknown>): Fades => ({ ...(raw.fadeIn === false && { fadeIn: false as const }), ...(raw.fadeOut === false && { fadeOut: false as const }) });
