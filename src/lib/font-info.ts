// Reads what we need from a .ttf / .otf file the user uploads: its family name (the name the final
// video's subtitle renderer looks it up by) and its full height in ems (see FONTS[].height in
// subtitle-style.ts). Null if it isn't a font we can use (font collections are not supported).
export type FontInfo = { family: string; height: number };
// A user's uploaded font (one per account); version changes with every upload.
export type OwnFont = FontInfo & { version: number };
export const fontKeys = (userId: string) => ({ file: `fonts/${userId}/font`, info: `fonts/${userId}/font.json` });

export function readFontInfo(bytes: Uint8Array): FontInfo | null {
	if (bytes.length < 12) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const version = view.getUint32(0);
	// TrueType (0x00010000 or "true") or OpenType with CFF outlines ("OTTO").
	if (version !== 0x00010000 && version !== 0x74727565 && version !== 0x4f54544f) return null;
	const tables = new Map<string, { offset: number; length: number }>();
	const count = view.getUint16(4);
	for (let i = 0; i < count; i++) {
		const at = 12 + i * 16;
		if (at + 16 > bytes.length) return null;
		const tag = String.fromCharCode(...bytes.subarray(at, at + 4));
		tables.set(tag, { offset: view.getUint32(at + 8), length: view.getUint32(at + 12) });
	}
	const inside = (t?: { offset: number; length: number }, need = 0) => t && t.offset + Math.max(t.length, need) <= bytes.length;
	const head = tables.get("head");
	const os2 = tables.get("OS/2");
	const hhea = tables.get("hhea");
	const name = tables.get("name");
	if (!inside(head, 20) || !inside(name, 6)) return null;
	const unitsPerEm = view.getUint16(head!.offset + 18);
	if (!unitsPerEm) return null;
	// libass sizes letters by usWinAscent + usWinDescent, else by the hhea ascender and descender.
	let height = 0;
	if (inside(os2, 78)) height = (view.getUint16(os2!.offset + 74) + view.getUint16(os2!.offset + 76)) / unitsPerEm;
	else if (inside(hhea, 8)) height = (view.getInt16(hhea!.offset + 4) - view.getInt16(hhea!.offset + 6)) / unitsPerEm;
	if (!(height > 0.5 && height < 4)) return null;

	// The family name (name ID 1): Windows English (UTF-16) first, else Mac Roman.
	const base = name!.offset;
	const records = view.getUint16(base + 2);
	const strings = base + view.getUint16(base + 4);
	let family = "";
	let rank = 0;
	for (let i = 0; i < records; i++) {
		const r = base + 6 + i * 12;
		if (r + 12 > bytes.length) break;
		const [platform, , language, nameId, length, offset] = [0, 2, 4, 6, 8, 10].map((o) => view.getUint16(r + o));
		if (nameId !== 1 || strings + offset + length > bytes.length) continue;
		const text = bytes.subarray(strings + offset, strings + offset + length);
		const windows = platform === 3 || platform === 0;
		const thisRank = windows ? (language === 0x409 ? 3 : 2) : 1;
		if (thisRank <= rank) continue;
		// UTF-16 big-endian by hand: not every runtime's TextDecoder knows it.
		family = windows ? Array.from({ length: text.length >> 1 }, (_, k) => String.fromCharCode((text[2 * k] << 8) | text[2 * k + 1])).join("") : String.fromCharCode(...text);
		rank = thisRank;
	}
	family = family.replace(/[\\{},\n\r]/g, "").trim().slice(0, 60);
	return family ? { family, height: Math.round(height * 1000) / 1000 } : null;
}
