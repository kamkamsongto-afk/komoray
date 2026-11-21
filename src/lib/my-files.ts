// My files (coach 21 Nov): one place per account for the files used again and again (logos now; fonts, pictures and
// clips next), so they are uploaded once and picked from then on. Rules, agreed after the logo swap of 21 Nov:
// - A file is named by what is in it (SHA-256 of its bytes): the same name is always the same picture, so the preview
//   and the final video can't get different files, and the browser may keep it for good.
// - Never written over (putIfAbsent). Uploading the same file again gives back the one already there.
// - Brand Kits, Templates and projects only point at a file by its id. A project keeps the id it was given, so changing a
//   Brand Kit never changes a project made before.
// - A file that can't be found is missing: never another file in its place (api/render stops, the preview says so).
// In R2, per file: files/<user id>/<id> (the bytes) and files/<user id>/<id>.json (its card, below). No shared list
// file, so two uploads at once can't overwrite each other's entry.
export type MyFileKind = "logo" | "font" | "image" | "video"; // logo: a picture kept from Brand Kit; image: any other picture
export type MyFile = {
	id: string; // SHA-256 of the bytes, 64 hex
	kind: MyFileKind;
	name: string; // what the customer sees (renamed freely: the id never changes)
	type: string; // its content type
	size: number; // bytes
	at: string; // when it was first uploaded
	family?: string; // a font: the name it is asked for by (lib/font-info.ts)
	height?: number; // a font: its full height in ems (FONTS[].height in subtitle-style.ts)
	seconds?: number; // a clip: how long it plays
	clear?: boolean; // a picture with see-through parts
};

export const MY_FILE_ID = /^[0-9a-f]{64}$/;
export const MY_FILE_KINDS: Record<MyFileKind, { maxBytes: number; label: string }> = {
	logo: { maxBytes: 2 * 1024 * 1024, label: "logo" },
	font: { maxBytes: 5 * 1024 * 1024, label: "font" },
	image: { maxBytes: 10_000_000, label: "picture" }, // as a project's Import (LIBRARY in media-library.ts)
	video: { maxBytes: 150_000_000, label: "clip" },
};
// What My files shows apart (coach 21 Nov): Video, Audio (sound files, to come) and File (pictures and fonts).
export const MY_FILE_SECTION: Record<MyFileKind, "video" | "file"> = { video: "video", logo: "file", image: "file", font: "file" };

// A project points at a picture or clip in My files by this name instead of keeping a copy (coach 21 Nov): banners,
// Pic/Clip, Frame Me and Layout take it wherever they take a file of the project's own. It ends in the file's type, so
// everything that tells a clip from a picture or a GIF by the ending still does. The server reads it from
// files/<owner>/<id> (lib/project-files.ts); the owner is the project's.
export const MY_REF = /^my-([0-9a-f]{64})\.(jpg|png|webp|gif|mp4)$/;
const REF_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4" };
export const myRefOf = (f: Pick<MyFile, "id" | "type">) => (REF_EXT[f.type] ? `my-${f.id}.${REF_EXT[f.type]}` : null);
export const refId = (name: string) => MY_REF.exec(name)?.[1] ?? null;
export const MAX_FILE_NAME = 60;

export const myFileKey = (userId: string, id: string) => `files/${userId}/${id}`;
export const myFileCardKey = (userId: string, id: string) => `files/${userId}/${id}.json`;
export const myFilesPrefix = (userId: string) => `files/${userId}/`;
// Where the browser reads one (only its owner, signed in). The bytes behind an id never change.
export const myFileUrl = (id: string) => `/api/files?id=${id}`;
// A clip's: a short-lived link straight to it, so the browser can read it piece by piece (Range).
export const myClipUrl = (id: string) => `/api/files?id=${id}&link=1`;
// A font in My files as a style or banner pins it (OwnFont in lib/font-info.ts). Here, not in use-my-fonts, so the server can call it.
export const asOwnFont = (f: MyFile) => ({ family: f.family ?? f.name, height: f.height ?? 1.58, version: 0, file: f.id });

export async function fileId(bytes: Uint8Array<ArrayBuffer>) {
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The name from an uploaded file's name: no ending, no odd characters, never empty.
export function cleanFileName(raw: unknown, fallback: string) {
	const name = (typeof raw === "string" ? raw : "")
		.replace(/\.[a-z0-9]{1,5}$/i, "")
		.replace(/[\u0000-\u001f\\{}<>]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, MAX_FILE_NAME);
	return name || fallback;
}

// "Logo" → "Logo (2)", "Logo (3)"… the first that no other file of the list has.
export function freeName(name: string, taken: string[]) {
	const used = new Set(taken.map((n) => n.toLowerCase()));
	if (!used.has(name.toLowerCase())) return name;
	for (let i = 2; ; i++) {
		const next = `${name.slice(0, MAX_FILE_NAME - 5)} (${i})`;
		if (!used.has(next.toLowerCase())) return next;
	}
}
