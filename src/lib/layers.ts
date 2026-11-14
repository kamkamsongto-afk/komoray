// Which of two things on the video is on top: the later one in its list. The preview draws each list in order
// (PlayerFrame), and so does the final video: cutout_filters and banner_file_filters put them on one after another,
// banner_events gives each word banner its own pair of ASS layers (render.py). So moving a thing up a layer is
// moving it later in its list.

type Timed = { id: string; start: number; end: number };
const together = (a: Timed, b: Timed) => a.start < b.end && b.start < a.end;

// The one it would swap with: the nearest one above it (up) or below it that shows at the same time and is drawn
// in the same pass (same). -1: nothing to go over or under, so the button does nothing.
export function layerNeighbour<T extends Timed>(list: T[], id: string, up: boolean, same: (a: T, b: T) => boolean = () => true) {
	const at = list.findIndex((x) => x.id === id);
	if (at < 0) return -1;
	const me = list[at];
	for (let k = up ? at + 1 : at - 1; k >= 0 && k < list.length; k += up ? 1 : -1) if (same(me, list[k]) && together(me, list[k])) return k;
	return -1;
}

// The list with it moved just over (up) or under the next one it overlaps. Everything else keeps its order.
export function moveLayer<T extends Timed>(list: T[], id: string, up: boolean, same?: (a: T, b: T) => boolean): T[] {
	const at = list.findIndex((x) => x.id === id);
	const to = layerNeighbour(list, id, up, same);
	if (at < 0 || to < 0) return list;
	const next = list.filter((_, k) => k !== at);
	next.splice(to, 0, list[at]); // after removing it, index `to` is just past the neighbour (up) or just before it (down)
	return next;
}

// Its place among the things showing with it, counted from the bottom: "2 of 3". Null when nothing overlaps it.
export function layerPlace<T extends Timed>(list: T[], id: string, same: (a: T, b: T) => boolean = () => true) {
	const me = list.find((x) => x.id === id);
	if (!me) return null;
	const stack = list.filter((x) => x.id === id || (same(me, x) && together(me, x)));
	return stack.length > 1 ? { at: stack.indexOf(me) + 1, of: stack.length } : null;
}

// Banners: the uploaded ones (pictures, clips) are always under the word banners, so each only swaps with its own kind.
export const sameBannerPass = (a: { kind: string }, b: { kind: string }) => (a.kind === "file") === (b.kind === "file");

// Copies of a thing on the timeline (coach, 14 Nov: the same everywhere, from its box, the timeline's button,
// Ctrl+D, or Ctrl+C then Ctrl+V). Every setting kept, a new id, as long as it was; it goes last in its list, so on top.
const tenths = (n: number) => Math.round(n * 10) / 10;

// Right after it; near the end of the video, as late as still fits.
export function duplicateOf<T extends Timed>(item: T, total: number): T {
	const seconds = item.end - item.start;
	const start = tenths(Math.max(0, Math.min(item.end, total - seconds)));
	return { ...item, id: crypto.randomUUID(), start, end: tenths(Math.min(total, start + seconds)) };
}

// Where the playhead is (`at`, seconds of the final video); near the end, as late as still fits.
export function pasteOf<T extends Timed>(item: T, at: number, total: number): T {
	const seconds = item.end - item.start;
	const start = tenths(Math.max(0, Math.min(at, total - seconds)));
	return { ...item, id: crypto.randomUUID(), start, end: tenths(Math.min(total, start + seconds)) };
}
