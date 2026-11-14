"use client";

import { Film, ImageIcon, Layers, Plus, Tag, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { clipLength, hasClearParts, LIBRARY, LIBRARY_ACCEPT, type LibraryItem, projectFileSrc } from "@/lib/media-library";
import { ConfirmDelete } from "./ConfirmDelete";
import { ViewSwitch, useListView } from "./ViewSwitch";

type Props = {
	onUseAsBanner: (item: LibraryItem) => void; // over the speaker, where the video is now
	onUseInPicClip?: (item: LibraryItem) => void; // behind the speaker (Cutout). Left out: Cutout isn't on for this person
	usedNow: Set<string>; // files on the video right now (they can't be deleted)
};

const size = (bytes: number) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`);
const videoKey = () => new URLSearchParams(window.location.search).get("key");

// The editor's Import box: pictures and clips kept in this project, to use as a banner or in Pic/Clip as
// often as you like without uploading again (lib/media-library.ts).
export function ImportControls({ onUseAsBanner, onUseInPicClip, usedNow }: Props) {
	const [items, setItems] = useState<LibraryItem[] | null>(null);
	const [note, setNote] = useState("");
	const [uploading, setUploading] = useState<string | null>(null); // "2 of 5"
	const [removing, setRemoving] = useState<LibraryItem | null>(null);
	const fileRef = useRef<HTMLInputElement>(null);
	const [view, setView] = useListView("komoray.importView");

	const load = useCallback(
		() =>
			fetch(`/api/library?key=${encodeURIComponent(videoKey() ?? "")}`)
				.then(async (res) => (res.ok ? ((await res.json()) as { items?: LibraryItem[] }) : {}))
				.then((data: { items?: LibraryItem[] }) => setItems(data.items ?? []))
				.catch(() => setItems([])),
		[],
	);
	useEffect(() => {
		void fetch(`/api/library?key=${encodeURIComponent(videoKey() ?? "")}`)
			.then(async (res) => (res.ok ? ((await res.json()) as { items?: LibraryItem[] }) : {}))
			.then((data: { items?: LibraryItem[] }) => setItems(data.items ?? []))
			.catch(() => setItems([]));
	}, []);

	async function upload(files: File[]) {
		const key = videoKey();
		if (!key) return;
		setNote("");
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
		if (failed.length) setNote(failed.join(" · "));
		await load();
	}

	async function remove(item: LibraryItem) {
		const key = videoKey();
		if (!key) return;
		const res = await fetch("/api/library", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, file: item.file }) }).catch(() => null);
		const data = (await res?.json().catch(() => null)) as { error?: string } | null;
		if (!res?.ok) setNote(data?.error ?? "Could not delete it. Please try again.");
		await load();
	}

	const full = (items?.length ?? 0) >= LIBRARY.maxItems;
	return (
		<div className="flex flex-col gap-2 p-3 pt-1">
			<span className="flex items-center gap-2">
				<button onClick={() => fileRef.current?.click()} disabled={uploading !== null || full} className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-dashed border-foreground/30 px-2 py-1 text-sm hover:bg-foreground/5 disabled:opacity-40">
					<Plus className="h-3.5 w-3.5" aria-hidden /> {uploading !== null ? `Uploading${uploading ? ` ${uploading}` : ""}…` : "Import pictures or clips"}
				</button>
				{items && items.length > 0 && <ViewSwitch view={view} onChange={setView} />}
			</span>
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
				<p className="text-xs text-foreground/60">Loading…</p>
			) : items.length === 0 ? (
				<p className="text-xs text-foreground/60">
					Bring in the pictures and clips you use often (JPG, PNG, WebP, GIF up to {LIBRARY.maxBytes.image / 1_000_000} MB, MP4 up to {LIBRARY.maxBytes.video / 1_000_000} MB). They stay in this project: use each one as a banner or in Pic/Clip as often as you like.
				</p>
			) : view === "list" ? (
				<ul className="flex flex-col gap-1">
					{items.map((item) => {
						const used = usedNow.has(item.file) || item.used;
						return (
							<li key={item.file} className="flex items-center gap-2 rounded-md border border-foreground/15 bg-foreground/5 p-1 text-xs">
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
										{used && <span className="rounded bg-green-600 px-1 text-white">On the video</span>}
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
								<button
									onClick={() => setRemoving(item)}
									disabled={used}
									title={used ? "It is on your video: delete it from Banners, Pic/Clip, Frame Me or Layout first" : "Delete from this project"}
									aria-label={`Delete ${item.name}`}
									className="rounded p-1 text-foreground/50 hover:bg-red-500/10 hover:text-red-600 disabled:opacity-30"
								>
									<Trash2 className="h-3 w-3" aria-hidden />
								</button>
							</li>
						);
					})}
				</ul>
			) : (
				<ul className="grid grid-cols-2 gap-2">
					{items.map((item) => {
						const used = usedNow.has(item.file) || item.used;
						return (
							<li key={item.file} className="flex flex-col overflow-hidden rounded-md border border-foreground/15 bg-foreground/5 text-xs">
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
									{used && <span className="absolute top-1 right-1 rounded bg-green-600 px-1 text-[10px] text-white">On the video</span>}
								</div>
								<div className="flex items-center gap-1 px-1.5 pt-1">
									<span className="min-w-0 flex-1 truncate" title={item.name}>
										{item.name}
									</span>
									<button
										onClick={() => setRemoving(item)}
										disabled={used}
										title={used ? "It is on your video: delete it from Banners, Pic/Clip, Frame Me or Layout first" : "Delete from this project"}
										aria-label={`Delete ${item.name}`}
										className="rounded p-0.5 text-foreground/50 hover:bg-red-500/10 hover:text-red-600 disabled:opacity-30"
									>
										<Trash2 className="h-3 w-3" aria-hidden />
									</button>
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
					})}
				</ul>
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
