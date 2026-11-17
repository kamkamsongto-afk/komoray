// The user's logo pictures, shown in a corner of every video whose style has logoImage { version }. Each upload is
// its own file, named by its version, so each Brand Kit (one per channel) keeps its own logo (coach, 17 Nov: there
// was one picture per account, so a new logo for one channel changed every channel's). Kept next to the own font.
// Logos uploaded before then are the one file without a version: a version with no file of its own falls back to it.
export const logoKey = (userId: string, version?: number) => (version ? `fonts/${userId}/logo-${version}` : `fonts/${userId}/logo`);
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
