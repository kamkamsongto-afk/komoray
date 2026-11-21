"use client";

import { FolderHeart, Film, ImageIcon, Layers, Plus, Tag, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { itemOfMyFile, knownLibrary, loadLibrary, type LibraryItem, projectFileSrc } from "@/lib/media-library";
import { PICTURES_CLIPS_ACCEPT, uploadToMyFiles } from "@/lib/my-files-upload";
import { ClashNote } from "./MyFilePickers";
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

// The editor's My files box (coach 21 Nov; was Import): + Upload puts pictures and clips into My files, + My files picks
// one from there, and the box shows what is on this video now. A project points at My files by reference, never a copy
// (MY_REF in lib/my-files.ts). Pictures and clips kept in a project before (its own Import) still show and work.
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

	const [clash, setClash] = useState<{ file: File; conflict: { name: string } } | null>(null);
	const [fresh, setFresh] = useState<string | null>(null); // the file just uploaded, shown first and marked in My files
	async function upload(files: File[], then?: "use" | "keep") {
		setNote("");
		setClash(null);
		onUploading?.(true);
		const failed: string[] = [];
		let last: string | null = null;
		for (const [n, file] of files.entries()) {
			setUploading(files.length > 1 ? `${n + 1} of ${files.length}` : "");
			// One file: a name already used is asked about (Use that one / Keep both). Several: both are kept.
			const count = files.length > 1 ? `${n + 1} of ${files.length}` : "";
			const sent = await uploadToMyFiles(file, then ?? (files.length > 1 ? "keep" : undefined), ["image", "video"], (percent) => setUploading(`${count} ${percent}%`.trim()));
			if ("conflict" in sent) {
				setClash({ file, conflict: sent.conflict });
				continue;
			}
			if ("error" in sent) failed.push(sent.error);
			else last = itemOfMyFile(sent.file).file;
		}
		setUploading(null);
		onUploading?.(false, last !== null);
		if (failed.length) setNote(failed.join(" · "));
		await load(true);
		if (last) {
			setFresh(last);
			setPicking(true);
		}
	}

	// + My files: everything kept there, Video and File (pictures) apart, to put on this video at once.
	const [picking, setPicking] = useState(false);
	const [section, setSection] = useState<"video" | "image">("image");

	async function remove(item: LibraryItem) {
		const key = videoKey();
		if (!key) return;
		const res = await fetch("/api/library", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, file: item.file }) }).catch(() => null);
		const data = (await res?.json().catch(() => null)) as { error?: string } | null;
		if (!res?.ok) setNote(data?.error ?? "Could not delete it. Please try again.");
		await load(true);
	}

	const isUsed = (item: LibraryItem) => usedNow.has(item.file) || !!item.used;
	const deleteButton = (item: LibraryItem, small: string) =>
		// Only a picture or clip kept in this project before can go from here; My files' own are deleted on the My files page.
		item.mine ? null : (
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
		<li key={item.file} className={`flex items-center gap-2 rounded-md border bg-background/60 p-1 text-xs ${item.file === fresh ? "border-blue-600" : "border-foreground/15"}`}>
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
		<li key={item.file} className={`flex flex-col overflow-hidden rounded-md border bg-background/60 text-xs ${item.file === fresh ? "border-blue-600" : "border-foreground/15"}`}>
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
			{/* Only two ways in (coach 21 Nov): + Upload (into My files) and + My files (pick one). */}
			<span className="grid grid-cols-2 gap-2">
				<button onClick={() => fileRef.current?.click()} disabled={uploading !== null} className="inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-md border border-dashed border-foreground/30 px-1.5 py-1.5 text-xs hover:bg-foreground/5 disabled:opacity-40">
					<Plus className="h-3.5 w-3.5" aria-hidden /> {uploading !== null ? `Uploading${uploading ? ` ${uploading}` : ""}…` : "Upload"}
				</button>
				<button
					onClick={() => {
						if (!picking) void load(true); // anything added on the My files page meanwhile (agent review 22 Nov)
						setPicking(!picking);
					}}
					aria-expanded={picking} className={`inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-md border border-dashed px-1.5 py-1.5 text-xs ${picking ? "border-blue-600 bg-blue-600/10" : "border-foreground/30 hover:bg-foreground/5"}`}>
					<FolderHeart className="h-3.5 w-3.5" aria-hidden /> My files
				</button>
			</span>
			<input
				ref={fileRef}
				type="file"
				multiple
				accept={PICTURES_CLIPS_ACCEPT}
				className="hidden"
				onChange={(e) => {
					const files = [...(e.target.files ?? [])];
					e.target.value = "";
					if (files.length) void upload(files);
				}}
			/>
			{clash && <ClashNote clash={clash} what="file" onUse={() => void upload([clash.file], "use")} onKeep={() => void upload([clash.file], "keep")} onCancel={() => setClash(null)} />}
			{picking && (
				<section className="flex flex-col gap-1.5 rounded-lg border border-blue-600/40 bg-blue-600/5 p-2">
					<div className="flex items-center gap-1 text-xs" role="tablist">
						{(["image", "video"] as const).map((k) => (
							<button key={k} role="tab" aria-selected={section === k} onClick={() => setSection(k)} className={`rounded-md px-2 py-0.5 ${section === k ? "bg-foreground text-background" : "hover:bg-foreground/5"}`}>
								{k === "image" ? "File" : "Video"}
							</button>
						))}
						<a href="/files" target="_blank" className="ml-auto text-foreground/60 underline hover:text-foreground">
							Open My files
						</a>
					</div>
					{(() => {
						const list = (items ?? []).filter((i) => i.mine && i.media === section).sort((a, b) => (a.file === fresh ? -1 : b.file === fresh ? 1 : 0));
						if (items === null) return <p className="text-xs text-foreground/60">Loading My files…</p>;
						if (!list.length) return <p className="text-xs text-foreground/60">{section === "video" ? "No clips in My files yet. + Upload an MP4." : "No pictures in My files yet. + Upload a JPG, PNG, WebP or GIF."}</p>;
						return view === "list" ? <ul className="flex flex-col gap-1">{list.map(listRow)}</ul> : <ul className="grid grid-cols-2 gap-2">{list.map(gridCard)}</ul>;
					})()}
				</section>
			)}
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
			) : !items.some((i) => isUsed(i) || !i.mine) ? (
				<p className="text-xs text-foreground/60">
					Nothing on this video yet. + Upload pictures (JPG, PNG, WebP, GIF up to 10 MB) and clips (MP4 up to 150 MB): they are kept in My files for every video. Or pick one in + My files.
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
							{ title: "Kept in this video before", list: items.filter((i) => !i.mine && !isUsed(i)), tone: "border-foreground/15", head: "text-foreground/60" },
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
