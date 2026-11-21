// Uploading into My files from the browser (coach 21 Nov): the person only picks files; each goes where it belongs by
// itself (a picture, a clip or a font, never asked). The server checks the bytes again (api/files).
import { clipLength, hasClearParts } from "./media-library";
import { MY_FILE_KINDS, type MyFile, type MyFileKind } from "./my-files";

export type UploadResult = { file: MyFile; same?: boolean } | { conflict: MyFile } | { error: string };
export const MY_FILES_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,video/mp4,.ttf,.otf,font/ttf,font/otf";
export const PICTURES_CLIPS_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,video/mp4";

// Which part of My files a file goes into, by its type and ending (the server then checks its first bytes).
export function kindForUpload(file: File): MyFileKind | null {
	const name = file.name.toLowerCase();
	if (/^image\/(jpeg|png|webp|gif)$/.test(file.type) || /\.(jpe?g|png|webp|gif)$/.test(name)) return "image";
	if (file.type === "video/mp4" || name.endsWith(".mp4")) return "video";
	if (/\.(ttf|otf)$/.test(name) || /^font\/(ttf|otf)$/.test(file.type)) return "font";
	return null;
}

async function sha256(file: File) {
	const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// One file into My files. then: the answer to "a file with this name is already there" (use that one / keep both).
export async function uploadToMyFiles(file: File, then?: "use" | "keep", only?: MyFileKind[]): Promise<UploadResult> {
	const kind = kindForUpload(file);
	if (!kind || (only && !only.includes(kind))) return { error: `${file.name}: use a JPG, PNG, WebP or GIF picture, an MP4 clip${only && !only.includes("font") ? "" : ", or a TTF or OTF font"}` };
	const { maxBytes, label } = MY_FILE_KINDS[kind];
	if (file.size > maxBytes) return { error: `${file.name}: too big (a ${label} can be up to ${Math.round(maxBytes / 1_000_000)} MB)` };
	type Sent = { ok: { file?: MyFile; same?: boolean; uploadUrl?: string } } | { conflict: MyFile } | { error: string };
	const answer = async (res: Response | null): Promise<Sent> => {
		const data = (await res?.json().catch(() => null)) as { file?: MyFile; same?: boolean; conflict?: MyFile; error?: string; uploadUrl?: string } | null;
		if (res?.status === 409 && data?.conflict) return { conflict: data.conflict };
		if (!res?.ok || !data) return { error: `${file.name}: ${data?.error ?? "could not upload"}` };
		return { ok: data };
	};

	if (kind === "video") {
		const [id, seconds] = await Promise.all([sha256(file), clipLength(file)]);
		const body = { id, name: file.name, size: file.size, seconds, ...(then && { then }) };
		const started = await answer(await fetch("/api/files?kind=video&step=start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null));
		if (!("ok" in started)) return started;
		if (started.ok.file) return { file: started.ok.file, same: started.ok.same };
		if (!started.ok.uploadUrl) return { error: `${file.name}: could not upload` };
		const put = await fetch(started.ok.uploadUrl, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: file }).catch(() => null);
		if (!put?.ok) return { error: `${file.name}: the upload stopped` };
		const done = await answer(await fetch("/api/files?kind=video&step=done", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null));
		if (!("ok" in done)) return done;
		return done.ok.file ? { file: done.ok.file, same: done.ok.same } : { error: `${file.name}: the upload stopped` };
	}

	const clear = kind === "image" && (await hasClearParts(file));
	const query = new URLSearchParams({ kind, name: file.name, ...(then && { then }), ...(clear && { clear: "1" }) });
	const sent = await answer(await fetch(`/api/files?${query}`, { method: "POST", body: file }).catch(() => null));
	if (!("ok" in sent)) return sent;
	return sent.ok.file ? { file: sent.ok.file, same: sent.ok.same } : { error: `${file.name}: could not upload` };
}
