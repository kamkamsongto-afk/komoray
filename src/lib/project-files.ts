import { myFileKey, refId } from "./my-files";
import { exists, siblingKey } from "./r2";

// Where a file a project shows is kept (server only): its own folder (media-…, banner-…, insert-…), or the owner's My
// files when the project points at one there (MY_REF, coach 21 Nov). Every server place that makes a link to a project's
// file goes through here (api/library, api/banner-file, api/cutout, api/render), so the preview and the final video
// always read the same file. ownerId: the signed-in user, who owns the project (checked by ownsVideo before).
export function projectFileKey(videoKey: string, file: string, ownerId: string) {
	const id = refId(file);
	return id ? myFileKey(ownerId, id) : siblingKey(videoKey, file);
}

// The My files references among these names whose file is gone: Make video stops for them (never a hole or another
// picture in their place, as for the logo). A failed check counts as gone.
export async function missingRefs(names: string[], ownerId: string) {
	const refs = [...new Set(names)].filter((n) => refId(n));
	const there = await Promise.all(refs.map((n) => exists(myFileKey(ownerId, refId(n)!)).catch(() => false)));
	return refs.filter((_, i) => !there[i]);
}
