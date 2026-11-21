// The user's logo pictures, shown in a corner of every video whose style has logoImage { version }. Each upload is
// its own file, named by its version, so each Brand Kit (one per channel) keeps its own logo (coach, 17 Nov: there
// was one picture per account, so a new logo for one channel changed every channel's). Kept next to the own font.
// A version is always its own file and nothing else: never written over, and never stood in for by another picture.
// A version with no file of its own is missing: the preview says so and Make video stops (coach 21 Nov: the old single
// file was used instead, it had been written over with another kit's Komoray logo, and the coach's video came out with
// it while the preview, from the browser's copy, still showed the coach's own logo). The old single file
// (fonts/<id>/logo, from before 17 Nov) is never read.
export const logoKey = (userId: string, version: number) => `fonts/${userId}/logo-${version}`;
// Where the preview reads a version's picture. `own=1` is part of the address only so browsers drop the copies they kept
// (a year, immutable) from when a missing version was answered with the old single file: those copies showed the
// coach's logo while the video got Komoray's. Keep it; take it out and those old copies come back.
export const logoUrl = (version: number) => `/api/logo?v=${version}&own=1`;
export const logoVersion = (value: unknown) => (typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined);
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

// PNG, JPEG or WebP by the first bytes of the file (what the final video's FFmpeg reads), else null.
export function logoType(bytes: Uint8Array): string | null {
	const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
	if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
	if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
	if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "image/webp";
	return null;
}
