"use client";

import { Film, Search, Upload } from "lucide-react";
import { type DragEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { knownLibrary, type LibraryItem, loadLibrary, projectFileSrc } from "@/lib/media-library";
import { MAIN_BUTTON, mainStyle, PICKED } from "./ToolGroup";
import { useListView, ViewSwitch } from "./ViewSwitch";

// One way to choose a picture or clip in every box (coach 26 Nov: Banners, Cutout, Frame Me, Layout, the same): the
// picked one as a row with the whole picture and Change; the choices as Pic | Clip, Upload, a search, an order, and
// square thumbnails or a list of names. It must stay usable with hundreds of files in My files: a few at a time.

const videoKey = () => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("key"));

// The pictures and clips a box can pick from (api/library): what the browser already has at once, then the fresh list.
// version: goes up when a file was added somewhere else; reload: after this box added one.
export function useLibrary(version = 0) {
	const [items, setItems] = useState<LibraryItem[] | null>(() => knownLibrary(videoKey()) ?? null);
	const [asked, setAsked] = useState(0);
	useEffect(() => {
		const key = videoKey();
		if (!key) return;
		let gone = false;
		void loadLibrary(key, version > 0 || asked > 0).then((list) => !gone && setItems(list));
		return () => {
			gone = true;
		};
	}, [version, asked]);
	const reload = useCallback(() => setAsked((n) => n + 1), []);
	return [items, reload] as const;
}

type Order = "latest" | "name" | "size";
const ORDERS: Record<Order, { label: string; sort: (a: LibraryItem, b: LibraryItem) => number }> = {
	latest: { label: "Latest", sort: (a, b) => b.at.localeCompare(a.at) },
	name: { label: "A–Z", sort: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) },
	size: { label: "Size", sort: (a, b) => b.size - a.size },
};
const ORDER_KEY = "komoray.pickerOrder";
const PAGE = 24; // shown at a time: a long list would load every picture and clip at once

function useOrder() {
	const [order, setOrder] = useState<Order>(() => {
		try {
			const kept = typeof window === "undefined" ? null : localStorage.getItem(ORDER_KEY);
			return kept && kept in ORDERS ? (kept as Order) : "latest";
		} catch {
			return "latest";
		}
	});
	const change = (next: Order) => {
		setOrder(next);
		try {
			localStorage.setItem(ORDER_KEY, next);
		} catch {
			// not remembered, that's fine
		}
	};
	return [order, change] as const;
}

const fileSize = (bytes: number) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`);

// A file in a square, all of it showing. onRatio: its width and height, once the browser knows them.
function Thumb({ file, media, onRatio }: { file: string; media: "image" | "video"; onRatio?: (width: number, height: number) => void }) {
	return media === "video" ? (
		<video src={`${projectFileSrc(file)}#t=0.5`} muted playsInline preload="metadata" onLoadedMetadata={(e) => onRatio?.(e.currentTarget.videoWidth, e.currentTarget.videoHeight)} className="pointer-events-none h-full w-full object-contain" />
	) : (
		// eslint-disable-next-line @next/next/no-img-element -- a private link to the customer's own upload
		<img src={projectFileSrc(file)} alt="" loading="lazy" onLoad={(e) => onRatio?.(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)} className="pointer-events-none h-full w-full object-contain" />
	);
}

// The file in use: its picture (all of it), its name, and Change.
export function PickedFile({ file, media, name, open, onToggle, onRatio }: { file: string; media: "image" | "video"; name: string; open: boolean; onToggle: () => void; onRatio?: (width: number, height: number) => void }) {
	return (
		<div className="flex items-center gap-2">
			<span className="relative h-14 w-14 shrink-0 overflow-hidden rounded border border-foreground/20 bg-neutral-500/20">
				<Thumb file={file} media={media} onRatio={onRatio} />
				{media === "video" && <Film className="absolute right-0.5 bottom-0.5 h-3 w-3 text-white drop-shadow" aria-hidden />}
			</span>
			<span className="min-w-0 flex-1 truncate text-xs" title={name}>
				{name}
			</span>
			<button onClick={onToggle} aria-expanded={open} className={MAIN_BUTTON} style={mainStyle(3)}>
				{open ? "Done" : "Change"}
			</button>
		</div>
	);
}

type Props = {
	items: LibraryItem[] | null; // what this box can show, null while it is being asked for
	current?: string; // the file in use, marked
	onPick: (item: LibraryItem) => void;
	upload?: { accept: string; onFile: (file: File) => void; busy?: number | boolean }; // from the computer; busy: percent, or just working
	floating?: boolean; // a pop-up under the row it was opened from, not part of the box
	disabled?: boolean; // the video has the most of these it can
	onDragStart?: (e: DragEvent, item: LibraryItem) => void; // can be dragged onto the video
	note?: string; // why an upload failed
	footer?: ReactNode;
};

export function FilePicker({ items, current, onPick, upload, floating, disabled, onDragStart, note, footer }: Props) {
	const fileRef = useRef<HTMLInputElement>(null);
	const [chosen, setChosen] = useState<LibraryItem["media"] | null>(null);
	const [search, setSearch] = useState("");
	const [order, setOrder] = useOrder();
	const [view, setView] = useListView("komoray.pickerView");
	const [shown, setShown] = useState(PAGE);

	const all = items ?? [];
	const count = (media: LibraryItem["media"]) => all.filter((i) => i.media === media).length;
	// The tab: the one pressed, else the kind in use now, else pictures unless there are only clips.
	const media = chosen ?? all.find((i) => i.file === current)?.media ?? (!count("image") && count("video") ? "video" : "image");
	const word = search.trim().toLocaleLowerCase();
	const found = all.filter((i) => i.media === media && (!word || i.name.toLocaleLowerCase().includes(word))).sort(ORDERS[order].sort);
	const working = upload?.busy !== undefined && upload.busy !== false;
	const again = () => setShown(PAGE); // another tab, search or order starts at the top

	const choice = (item: LibraryItem, className: string, children: ReactNode) => (
		<button
			key={item.file}
			onClick={() => onPick(item)}
			disabled={disabled}
			draggable={onDragStart ? true : undefined}
			onDragStart={onDragStart && ((e) => onDragStart(e, item))}
			title={item.name}
			aria-label={item.name}
			aria-pressed={current === item.file}
			className={`${className} border-2 disabled:opacity-40 ${current === item.file ? "border-[#4D8DBA]" : "border-transparent hover:border-foreground/30"}`}
		>
			{children}
		</button>
	);

	return (
		<div className={floating ? "absolute top-full right-0 left-0 z-40 mt-1 flex flex-col gap-1.5 rounded-lg border border-foreground/20 bg-background p-2 shadow-xl" : "flex flex-col gap-1.5"}>
			<div className="flex items-center gap-1.5">
				<div role="tablist" className="flex gap-0.5 rounded-md bg-foreground/5 p-0.5">
					{(
						[
							["image", "Pic"],
							["video", "Clip"],
						] as const
					).map(([id, name]) => (
						<button
							key={id}
							role="tab"
							aria-selected={media === id}
							onClick={() => {
								setChosen(id);
								again();
							}}
							className={`rounded px-2.5 py-0.5 text-xs ${media === id ? PICKED : "text-foreground/70 hover:text-foreground"}`}
						>
							{name} <span className="text-foreground/50 tabular-nums">{items ? count(id) : ""}</span>
						</button>
					))}
				</div>
				{upload && (
					<>
						<button onClick={() => fileRef.current?.click()} disabled={working || disabled} title="A picture or clip from your computer. It goes into My files too." className={`ml-auto disabled:opacity-40 ${MAIN_BUTTON}`} style={mainStyle(3)}>
							<Upload className="h-3 w-3 shrink-0" aria-hidden /> {typeof upload.busy === "number" ? `Uploading ${upload.busy}%` : working ? "Uploading…" : "Upload"}
						</button>
						<input
							ref={fileRef}
							type="file"
							accept={upload.accept}
							className="hidden"
							onChange={(e) => {
								const file = e.target.files?.[0];
								e.target.value = "";
								if (file) upload.onFile(file);
							}}
						/>
					</>
				)}
			</div>
			{note && <p className="text-xs text-red-500">{note}</p>}
			<div className="flex items-center gap-1.5">
				<label className="flex min-w-0 flex-1 items-center gap-1 rounded-md border border-foreground/20 bg-background px-1.5">
					<Search className="h-3 w-3 shrink-0 text-foreground/50" aria-hidden />
					<input
						type="search"
						value={search}
						onChange={(e) => {
							setSearch(e.target.value);
							again();
						}}
						placeholder="Search by name"
						aria-label="Search your files by name"
						className="min-w-0 flex-1 bg-transparent py-0.5 text-xs focus:outline-none"
					/>
				</label>
				<select
					value={order}
					onChange={(e) => {
						setOrder(e.target.value as Order);
						again();
					}}
					aria-label="Order of the files"
					title="Latest first, by name, or the largest first"
					className="shrink-0 rounded-md border border-foreground/20 bg-background px-1 py-0.5 text-xs"
				>
					{(Object.keys(ORDERS) as Order[]).map((id) => (
						<option key={id} value={id}>
							{ORDERS[id].label}
						</option>
					))}
				</select>
				<ViewSwitch view={view} onChange={setView} />
			</div>
			{items === null ? (
				<p className="text-xs text-foreground/60">Loading…</p>
			) : found.length === 0 ? (
				<p className="text-xs text-foreground/60">{word ? `No ${media === "image" ? "picture" : "clip"} with “${search.trim()}” in its name.` : `No ${media === "image" ? "pictures" : "clips"} yet.`}</p>
			) : (
				// p-px: the picked one's ring isn't cut off by the scrolling box.
				<div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto p-px">
					{view === "grid" ? (
						<div className="grid grid-cols-4 gap-1">
							{found.slice(0, shown).map((item) =>
								choice(
									item,
									"relative aspect-square w-full overflow-hidden rounded-md bg-neutral-500/20",
									<>
										<span className="absolute inset-0">
											<Thumb file={item.file} media={item.media} />
										</span>
										{item.media === "video" && <Film className="absolute right-0.5 bottom-0.5 h-3 w-3 text-white drop-shadow" aria-hidden />}
									</>,
								),
							)}
						</div>
					) : (
						<div className="flex flex-col gap-0.5">
							{found.slice(0, shown).map((item) =>
								choice(
									item,
									"flex w-full shrink-0 items-center gap-2 rounded-md px-1 py-0.5 text-left text-xs",
									<>
										<span className="h-7 w-7 shrink-0 overflow-hidden rounded bg-neutral-500/20">
											<Thumb file={item.file} media={item.media} />
										</span>
										<span className="min-w-0 flex-1 truncate">{item.name}</span>
										<span className="shrink-0 text-[11px] text-foreground/50 tabular-nums">{fileSize(item.size)}</span>
									</>,
								),
							)}
						</div>
					)}
					{found.length > shown && (
						<button onClick={() => setShown(shown + PAGE)} className="self-center rounded-md border border-foreground/20 px-2 py-0.5 text-xs hover:bg-foreground/5">
							Show more ({found.length - shown})
						</button>
					)}
				</div>
			)}
			{footer}
		</div>
	);
}
