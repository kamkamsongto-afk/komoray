"use client";

import { FolderHeart, Film, ImageIcon, Layers, Plus, Tag, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { clipLength, hasClearParts, knownLibrary, LIBRARY, LIBRARY_ACCEPT, loadLibrary, type LibraryItem, projectFileSrc } from "@/lib/media-library";
import { type MyFile, myFileUrl } from "@/lib/my-files";
import { ConfirmDelete } from "./ConfirmDelete";
import { ViewSwitch, useListView } from "./ViewSwitch";

type Props = {
	onUseAsBanner: (item: LibraryItem) => void; // over the speaker, where the video is now
	onUseInPicClip?: (item: LibraryItem) => void; // behind the speaker (Cutout). Left out: Cutout isn't on for this person
	usedNow: Set<string>; // files on the video right now (they can't be deleted)
	onUploading?: (busy: boolean, added?: boolean) => void; // the Import button's dot (ScriptView): blinks while uploading, green once in
};

const size = (bytes: number) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`);
const videoKey = () => new URLSearchParams(window.location.search).get("key");

// The editor's Import box: pictures and clips kept in this project, to use as a banner or in Pic/Clip as
// often as you like without uploading again (lib/media-library.ts).
export function ImportControls({ onUseAsBanner, onUseInPicClip, usedNow, onUploading }: Props) {
	// What this tab already knows at once (the editor asked as it opened), then the fresh list.
	const [items, setItems] = useState<LibraryItem[] | null>(() => (typeof window === "undefined" ? null : (knownLibrary(videoKey()) ?? null)));
	const [note, setNote] = useState("");
	const [uploading, setUploading] = useState<string | null>(null); // "2 of 5"
	const [removing, setRemoving] = useState<LibraryItem | null>(null);
	const fileRef = useRef<HTMLInputElement>(null);
	const [view, setView] = useListView("komoray.importView");

	// fresh: after an upload or a delete, not an answer asked before it.
	const load = useCallback(async (fresh = false) => {
		const key = videoKey();
		if (key) setItems(await loadLibrary(key, fresh));
	}, []);
	useEffect(() => {
		let gone = false;
		const key = videoKey();
		if (key) void loadLibrary(key).then((list) => !gone && setItems(list));
		return () => {
			gone = true;
		};
	}, []);

	async function upload(files: File[]) {
		const key = videoKey();
		if (!key) return;
		setNote("");
		onUploading?.(true);
		const failed: string[] = [];
		for (const [n, file] of files.entries()) {
			setUploading(files.length > 1 ? `${n + 1} of ${files.length}` : "");
			const [clear, seconds] = await Promise.all([hasClearParts(file), file.type.startsWith("video/") ? clipLength(file) : null]);
			const res = await fetch("/api/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, contentType: file.type, size: file.size }) }).catch(() => null);
			const data = (await res?.json().catch(() => null)) as { uploadUrl?: string; file?: string; error?: string } | null;
			if (!res?.ok || !data?.uploadUrl || !data.file) {
				failed.push(`${file.name}: ${data?.error ?? "could not upload"}`);
				continue;
			}
			const put = await fetch(data.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file }).catch(() => null);
			const done = put?.ok ? await fetch("/api/library", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, file: data.file, name: file.name, clear, seconds }) }).catch(() => null) : null;
			if (!done?.ok) failed.push(`${file.name}: the upload stopped`);
		}
		setUploading(null);
		onUploading?.(false, failed.length < files.length);
		if (failed.length) setNote(failed.join(" · "));
		await load(true);
	}

	// Import from My files (coach 21 Nov): their logos, picked once into this project (a copy: api/library fromMyFile).
	const [mine, setMine] = useState<MyFile[] | null>(null);
	const [picking, setPicking] = useState(false);
	function openMine() {
		setPicking((on) => !on);
		if (mine === null) {
			void fetch("/api/files?kind=logo")
				.then((res) => (res.ok ? (res.json() as Promise<{ files: MyFile[] }>) : { files: [] }))
				.then((data) => setMine(data.files))
				.catch(() => setMine([]));
		}
	}
	async function importMine(file: MyFile) {
		const key = videoKey();
		if (!key) return;
		setNote("");
		setUploading("");
		onUploading?.(true);
		const res = await fetch("/api/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, fromMyFile: file.id }) }).catch(() => null);
		const data = (await res?.json().catch(() => null)) as { error?: string } | null;
		setUploading(null);
		onUploading?.(false, !!res?.ok);
		if (!res?.ok) setNote(data?.error ?? "Could not bring it in. Please try again.");
		else setPicking(false);
		await load(true);
	}

	async function remove(item: LibraryItem) {
		const key = videoKey();
		if (!key) return;
		const res = await fetch("/api/library", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, file: item.file }) }).catch(() => null);
		const data = (await res?.json().catch(() => null)) as { error?: string } | null;
		if (!res?.ok) setNote(data?.error ?? "Could not delete it. Please try again.");
		await load(true);
	}

	const full = (items?.length ?? 0) >= LIBRARY.maxItems;
	const isUsed = (item: LibraryItem) => usedNow.has(item.file) || !!item.used;
	const deleteButton = (item: LibraryItem, small: string) => (
		<button
			onClick={() => setRemoving(item)}
			disabled={isUsed(item)}
			title={isUsed(item) ? "It is on your video: delete it from Banners, Pic/Clip, Frame Me or Layout first" : "Delete from this project"}
			aria-label={`Delete ${item.name}`}
			className={`rounded ${small} text-foreground/50 hover:bg-red-500/10 hover:text-red-600 disabled:opacity-30`}
		>
			<Trash2 className="h-3 w-3" aria-hidden />
		</button>
	);
	const listRow = (item: LibraryItem) => (
		<li key={item.file} className="flex items-center gap-2 rounded-md border border-foreground/15 bg-background/60 p-1 text-xs">
			<span className="relative h-9 w-9 shrink-0 overflow-hidden rounded bg-black/60">
				{item.media === "video" ? (
					<video src={`${projectFileSrc(item.file)}#t=0.5`} muted playsInline preload="metadata" className="absolute inset-0 h-full w-full object-cover" />
				) : (
					// eslint-disable-next-line @next/next/no-img-element -- a private link to the customer's own upload
					<img src={projectFileSrc(item.file)} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
				)}
			</span>
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="truncate" title={item.name}>
					{item.name}
				</span>
				<span className="flex items-center gap-1 text-[10px] text-foreground/50">
					{item.media === "video" ? <Film className="h-3 w-3" aria-hidden /> : <ImageIcon className="h-3 w-3" aria-hidden />}
					{item.media === "video" && item.seconds ? `${Math.round(item.seconds)}s` : size(item.size)}
				</span>
			</span>
			<button onClick={() => onUseAsBanner(item)} title="Put it over you as a banner, where the video is now" aria-label={`Use ${item.name} as a banner`} className="rounded border border-foreground/20 p-1 hover:bg-foreground/5">
				<Tag className="h-3 w-3" aria-hidden />
			</button>
			{onUseInPicClip && (
				<button onClick={() => onUseInPicClip(item)} title="Put it behind you (Cutout → Pic/Clip), where the video is now" aria-label={`Use ${item.name} in Pic/Clip`} className="rounded border border-foreground/20 p-1 hover:bg-foreground/5">
					<Layers className="h-3 w-3" aria-hidden />
				</button>
			)}
			{deleteButton(item, "p-1")}
		</li>
	);
	const gridCard = (item: LibraryItem) => (
		<li key={item.file} className="flex flex-col overflow-hidden rounded-md border border-foreground/15 bg-background/60 text-xs">
			<div className="relative aspect-video bg-black/60" style={item.clear ? { backgroundImage: "repeating-conic-gradient(#8884 0% 25%, transparent 0% 50%)", backgroundSize: "16px 16px" } : undefined}>
				{item.media === "video" ? (
					<video src={`${projectFileSrc(item.file)}#t=0.5`} muted playsInline preload="metadata" className="absolute inset-0 h-full w-full object-contain" />
				) : (
					// eslint-disable-next-line @next/next/no-img-element -- a private link to the customer's own upload
					<img src={projectFileSrc(item.file)} alt="" className="absolute inset-0 h-full w-full object-contain" />
				)}
				<span className="absolute top-1 left-1 inline-flex items-center gap-0.5 rounded bg-black/60 px-1 text-[10px] text-white">
					{item.media === "video" ? <Film className="h-3 w-3" aria-hidden /> : <ImageIcon className="h-3 w-3" aria-hidden />}
					{item.media === "video" && item.seconds ? `${Math.round(item.seconds)}s` : size(item.size)}
				</span>
			</div>
			<div className="flex items-center gap-1 px-1.5 pt-1">
				<span className="min-w-0 flex-1 truncate" title={item.name}>
					{item.name}
				</span>
				{deleteButton(item, "p-0.5")}
			</div>
			<div className="flex gap-1 p-1.5">
				<button onClick={() => onUseAsBanner(item)} title="Put it over you as a banner, where the video is now" className="inline-flex flex-1 items-center justify-center gap-0.5 rounded border border-foreground/20 px-1 py-0.5 hover:bg-foreground/5">
					<Tag className="h-3 w-3" aria-hidden /> Banner
				</button>
				{onUseInPicClip && (
					<button onClick={() => onUseInPicClip(item)} title="Put it behind you (Cutout → Pic/Clip), where the video is now" className="inline-flex flex-1 items-center justify-center gap-0.5 rounded border border-foreground/20 px-1 py-0.5 hover:bg-foreground/5">
						<Layers className="h-3 w-3" aria-hidden /> Pic/Clip
					</button>
				)}
			</div>
		</li>
	);
	return (
		<div className="flex flex-col gap-2 p-3 pt-1">
			{/* Where it comes from (coach 21 Nov): the computer, or the pictures already kept in My files. */}
			<span className="grid grid-cols-2 gap-2">
				<button onClick={() => fileRef.current?.click()} disabled={uploading !== null || full} className="inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-md border border-dashed border-foreground/30 px-1.5 py-1.5 text-xs hover:bg-foreground/5 disabled:opacity-40">
					<Plus className="h-3.5 w-3.5" aria-hidden /> {uploading !== null ? `Uploading${uploading ? ` ${uploading}` : ""}…` : "Import from computer"}
				</button>
				<button onClick={openMine} disabled={uploading !== null || full} aria-expanded={picking} className={`inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-md border border-dashed px-1.5 py-1.5 text-xs disabled:opacity-40 ${picking ? "border-blue-600 bg-blue-600/10" : "border-foreground/30 hover:bg-foreground/5"}`}>
					<FolderHeart className="h-3.5 w-3.5" aria-hidden /> Import from My files
				</button>
			</span>
			{picking && (
				<div className="flex flex-col gap-1.5 rounded-md border border-blue-600/40 bg-blue-600/5 p-2">
					{mine === null ? (
						<p className="text-xs text-foreground/60">Loading My files…</p>
					) : mine.length === 0 ? (
						<p className="text-xs text-foreground/60">No pictures in My files yet. Logos you upload in Brand Kit are kept there.</p>
					) : (
						<ul className="grid grid-cols-3 gap-1.5">
							{mine.map((f) => (
								<li key={f.id}>
									<button onClick={() => void importMine(f)} disabled={uploading !== null} title={`Bring "${f.name}" into this project`} className="flex w-full flex-col items-center gap-0.5 rounded border border-foreground/15 bg-background p-1 text-[10px] hover:border-blue-600 disabled:opacity-40">
										<span className="flex h-10 w-full items-center justify-center bg-[repeating-conic-gradient(rgba(127,127,127,0.18)_0%_25%,transparent_0%_50%)] bg-[length:10px_10px]">
											{/* eslint-disable-next-line @next/next/no-img-element -- their own picture, by its id */}
											<img src={myFileUrl(f.id)} alt="" className="max-h-9 max-w-full object-contain" />
										</span>
										<span className="w-full truncate">{f.name}</span>
									</button>
								</li>
							))}
						</ul>
					)}
				</div>
			)}
			<input
				ref={fileRef}
				type="file"
				multiple
				accept={LIBRARY_ACCEPT}
				className="hidden"
				onChange={(e) => {
					const files = [...(e.target.files ?? [])];
					e.target.value = "";
					if (files.length) void upload(files);
				}}
			/>
			{note && <p className="text-xs text-red-500">{note}</p>}
			{items === null ? (
				// Shaped like the files to come, so it reads as "on its way", not "empty".
				<div className="flex flex-col gap-2" aria-busy="true">
					<ul className="grid grid-cols-2 gap-2">
						{[0, 1, 2, 3].map((n) => (
							<li key={n} className="aspect-video animate-pulse rounded-md bg-foreground/10" />
						))}
					</ul>
					<p className="text-xs text-foreground/60">Loading your files…</p>
				</div>
			) : items.length === 0 ? (
				<p className="text-xs text-foreground/60">
					Bring in the pictures and clips you use often (JPG, PNG, WebP, GIF up to {LIBRARY.maxBytes.image / 1_000_000} MB, MP4 up to {LIBRARY.maxBytes.video / 1_000_000} MB). They stay in this project: use each one as a banner or in Pic/Clip as often as you like.
				</p>
			) : (
				// What is on the timeline now apart from the rest (coach 21 Nov), so it reads at once which ones are in use.
				<>
					{items && items.length > 0 && (
						<span className="flex justify-end">
							<ViewSwitch view={view} onChange={setView} />
						</span>
					)}
					{(
						[
							{ title: "On timeline now", list: items.filter(isUsed), tone: "border-green-600/40 bg-green-600/10", head: "text-green-700 dark:text-green-400" },
							{ title: "Not on the timeline yet", list: items.filter((i) => !isUsed(i)), tone: "border-foreground/15", head: "text-foreground/60" },
						] as const
					).map(
						(group) =>
							group.list.length > 0 && (
								<section key={group.title} className={`flex flex-col gap-1.5 rounded-lg border p-2 ${group.tone}`}>
									<p className={`text-xs font-semibold ${group.head}`}>
										{group.title} ({group.list.length})
									</p>
									{view === "list" ? <ul className="flex flex-col gap-1">{group.list.map(listRow)}</ul> : <ul className="grid grid-cols-2 gap-2">{group.list.map(gridCard)}</ul>}
								</section>
							),
					)}
				</>
			)}
			{items && items.length > 0 && <p className="text-xs text-foreground/60">Kept with this project: {items.length} of {LIBRARY.maxItems} files.</p>}
			{removing && (
				<ConfirmDelete
					name={`"${removing.name}"`}
					onCancel={() => setRemoving(null)}
					onConfirm={() => {
						const item = removing;
						setRemoving(null);
						void remove(item);
					}}
				/>
			)}
		</div>
	);
}
