// The rows of strips under the timeline's waveform (banners, Cutout layers, Frame Me, Layout), each kind in rows of
// its own (a group). Rules (coach, 17 Nov):
//   - A strip stays in its row. Adding, moving or changing one never moves any other strip (rows were worked out
//     afresh on every change, so strips after an early one jumped to other rows).
//   - The creator can drag a strip to another row of its kind, if that row is free for its whole time.
//   - Two strips in one row never overlap: moving, stretching or typing a time stops at the strip next to it.
// Rows are only how the timeline is drawn: nothing here changes the video. The memo is kept per video in this
// browser (ScriptView), so a reload keeps the rows the creator chose.

export type LaneGroup = "banner" | "cutout" | "frame" | "layout";
export type RowEntry = { row: number; start: number; end: number; group: LaneGroup };
export type RowMemo = Map<string, RowEntry>;
type Timed = { id: string; start: number; end: number };

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end - 1e-6 && b.start < a.end - 1e-6;

// Each strip in a row, starting at `first`. First the strips that did not change keep their rows, then the changed
// ones keep theirs if there is room, and new ones (or ones with no room) go in the first row with room. Rows left
// empty close up. The memo is updated to what is drawn.
export function packRows<T extends Timed>(items: T[], group: LaneGroup, first: number, memo: RowMemo) {
	const rows: { start: number; end: number }[][] = [];
	const fits = (row: number, item: T) => !(rows[row] ?? []).some((o) => overlaps(o, item));
	const put = (row: number, item: T) => (rows[row] ??= []).push(item);
	const placed = new Map<string, number>();
	const was = (item: T) => {
		const kept = memo.get(item.id);
		return kept && kept.group === group ? kept : undefined;
	};
	const same = (item: T) => was(item)?.start === item.start && was(item)?.end === item.end;
	const byStart = [...items].sort((a, b) => a.start - b.start);
	for (const pass of [(i: T) => Boolean(was(i)) && same(i), (i: T) => Boolean(was(i)) && !same(i)]) {
		for (const item of byStart.filter(pass)) {
			const row = was(item)!.row;
			if (fits(row, item)) {
				put(row, item);
				placed.set(item.id, row);
			}
		}
	}
	for (const item of byStart) {
		if (placed.has(item.id)) continue;
		let row = 0;
		while (!fits(row, item)) row++;
		put(row, item);
		placed.set(item.id, row);
	}
	const used = [...new Set(placed.values())].sort((a, b) => a - b);
	return byStart.map((item) => {
		const row = used.indexOf(placed.get(item.id)!);
		memo.set(item.id, { row, start: item.start, end: item.end, group });
		return { item, row: first + row };
	});
}

// The free stretch around a strip in its row: from the end of the strip before it to the start of the one after.
export function gapAround(memo: RowMemo, id: string, at: { start: number; end: number }, total: number) {
	const me = memo.get(id);
	let from = 0;
	let to = total;
	if (!me) return { from, to };
	for (const [other, o] of memo) {
		if (other === id || o.group !== me.group || o.row !== me.row) continue;
		if (o.end <= at.start + 1e-6) from = Math.max(from, o.end);
		else if (o.start >= at.end - 1e-6) to = Math.min(to, o.start);
	}
	return { from, to };
}

const MIN_SECONDS = 0.3; // the shortest a strip can be made by stretching it
const tenths = (n: number) => Math.round(n * 10) / 10;

// A new start and/or end for a strip, kept inside its free stretch (coach, 17 Nov: a time typed or dragged into the
// next strip stops right at it, and the strip already there never moves). was: where it is now.
export function fitInRow(memo: RowMemo, id: string, was: { start: number; end: number }, want: { start?: number; end?: number }, total: number) {
	const { from, to } = gapAround(memo, id, was, total);
	if (want.start !== undefined && want.end !== undefined) {
		// Moved whole: as long as it was, slid to fit.
		const seconds = Math.min(want.end - want.start, to - from);
		const start = Math.max(from, Math.min(want.start, to - seconds));
		return { start: tenths(start), end: tenths(start + seconds) };
	}
	if (want.start !== undefined) return { start: tenths(Math.max(from, Math.min(want.start, was.end - MIN_SECONDS))) };
	if (want.end !== undefined) return { end: tenths(Math.min(to, Math.max(want.end, was.start + MIN_SECONDS))) };
	return {};
}

// May this strip go into that row? Only if the row is free for its whole time.
export function rowIsFree(memo: RowMemo, id: string, group: LaneGroup, row: number, at: { start: number; end: number }) {
	for (const [other, o] of memo) if (other !== id && o.group === group && o.row === row && overlaps(o, at)) return false;
	return true;
}

// Kept in this browser per video, so a reload keeps the rows (a convenience: lost rows only mean packed afresh).
const STORE = (videoKey: string) => `komoray.rows.${videoKey}`;
export function loadRows(videoKey: string): RowMemo {
	try {
		const saved = JSON.parse(localStorage.getItem(STORE(videoKey)) ?? "{}") as Record<string, RowEntry>;
		return new Map(Object.entries(saved).filter(([, e]) => e && typeof e.row === "number"));
	} catch {
		return new Map();
	}
}
export function saveRows(videoKey: string, memo: RowMemo) {
	try {
		localStorage.setItem(STORE(videoKey), JSON.stringify(Object.fromEntries(memo)));
	} catch {
		// not kept: rows are packed afresh next time
	}
}
