// Uploading into My files from the browser (coach 21 Nov): the person only picks files; each goes where it belongs by
// itself (a picture, a clip or a font, never asked). The server checks the bytes again (api/files).
import { clipLength, hasClearParts } from "./media-library";
import { MY_FILE_KINDS, type MyFile, type MyFileKind } from "./my-files";

export type UploadResult = { file: MyFile; same?: boolean } | { conflict: MyFile } | { error: string };
export const MY_FILES_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,.mov,.ttf,.otf,font/ttf,font/otf";
export const PICTURES_CLIPS_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,.mov";

// Which part of My files a file goes into, by its type and ending (the server then checks its first bytes).
export function kindForUpload(file: File): MyFileKind | null {
	const name = file.name.toLowerCase();
	if (/^image\/(jpeg|png|webp|gif)$/.test(file.type) || /\.(jpe?g|png|webp|gif)$/.test(name)) return "image";
	if (/^video\/(mp4|quicktime)$/.test(file.type) || /\.(mp4|mov)$/.test(name)) return "video";
	if (/\.(ttf|otf)$/.test(name) || /^font\/(ttf|otf)$/.test(file.type)) return "font";
	return null;
}

// A clip's id: SHA-256 of its size, its first 8 MB and its last 8 MB (agent review 22 Nov: reading all 150 MB at once
// could reload the page on an iPad). Two different clips with the same size, start and end are not a real case; the id is
// the browser's word anyway (api/files clipUpload).
const SAMPLE = 8 * 1024 * 1024;
async function clipId(file: File) {
	const parts = file.size <= 2 * SAMPLE ? [file] : [file.slice(0, SAMPLE), file.slice(file.size - SAMPLE)];
	const bytes = [new TextEncoder().encode(`${file.size}:`), ...(await Promise.all(parts.map(async (p) => new Uint8Array(await p.arrayBuffer()))))];
	const all = new Uint8Array(bytes.reduce((n, b) => n + b.length, 0));
	bytes.reduce((at, b) => (all.set(b, at), at + b.length), 0);
	const digest = await crypto.subtle.digest("SHA-256", all);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// A PUT that says how far it has got (0..100), for the progress shown while a clip goes up.
function putWithProgress(url: string, file: File, type: string, onProgress?: (percent: number) => void) {
	return new Promise<boolean>((resolve) => {
		const xhr = new XMLHttpRequest();
		xhr.open("PUT", url);
		xhr.setRequestHeader("Content-Type", type);
		xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
		xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
		xhr.onerror = () => resolve(false);
		xhr.send(file);
	});
}

// One file into My files. then: the answer to "a file with this name is already there" (use that one / keep both).
export async function uploadToMyFiles(file: File, then?: "use" | "keep", only?: MyFileKind[], onProgress?: (percent: number) => void): Promise<UploadResult> {
	const kind = kindForUpload(file);
	if (!kind || (only && !only.includes(kind))) return { error: `${file.name}: use a JPG, PNG, WebP or GIF picture, an MP4 or MOV clip${only && !only.includes("font") ? "" : ", or a TTF or OTF font"}` };
	const { maxBytes, label } = MY_FILE_KINDS[kind];
	if (file.size > maxBytes) return { error: `${file.name}: too big (a ${label} can be up to ${Math.round(maxBytes / 1_000_000)} MB)` };
	type Sent = { ok: { file?: MyFile; same?: boolean; uploadUrl?: string; upload?: string } } | { conflict: MyFile } | { error: string };
	const answer = async (res: Response | null): Promise<Sent> => {
		const data = (await res?.json().catch(() => null)) as { file?: MyFile; same?: boolean; conflict?: MyFile; error?: string; uploadUrl?: string; upload?: string } | null;
		if (res?.status === 409 && data?.conflict) return { conflict: data.conflict };
		if (!res?.ok || !data) return { error: `${file.name}: ${data?.error ?? "could not upload"}` };
		return { ok: data };
	};

	if (kind === "video") {
		const [id, seconds] = await Promise.all([clipId(file), clipLength(file)]);
		const type = file.type === "video/quicktime" || file.name.toLowerCase().endsWith(".mov") ? "video/quicktime" : "video/mp4";
		const body = { id, name: file.name, size: file.size, type, seconds, ...(then && { then }) };
		const started = await answer(await fetch("/api/files?kind=video&step=start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null));
		if (!("ok" in started)) return started;
		if (started.ok.file) return { file: started.ok.file, same: started.ok.same };
		if (!started.ok.uploadUrl) return { error: `${file.name}: could not upload` };
		if (!(await putWithProgress(started.ok.uploadUrl, file, type, onProgress))) return { error: `${file.name}: the upload stopped` };
		const done = await answer(await fetch("/api/files?kind=video&step=done", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, upload: started.ok.upload }) }).catch(() => null));
		if (!("ok" in done)) return done;
		return done.ok.file ? { file: done.ok.file, same: done.ok.same } : { error: `${file.name}: the upload stopped` };
	}

	const clear = kind === "image" && (await hasClearParts(file));
	const query = new URLSearchParams({ kind, name: file.name, ...(then && { then }), ...(clear && { clear: "1" }) });
	const sent = await answer(await fetch(`/api/files?${query}`, { method: "POST", body: file }).catch(() => null));
	if (!("ok" in sent)) return sent;
	return sent.ok.file ? { file: sent.ok.file, same: sent.ok.same } : { error: `${file.name}: could not upload` };
}
