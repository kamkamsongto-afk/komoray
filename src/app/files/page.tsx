"use client";

import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AccountBar, SignInCard, useUser } from "@/components/Account";
import { MY_FILE_SECTION, type MyFile, type MyFileKind, myClipUrl, myFileUrl } from "@/lib/my-files";
import { MY_FILES_ACCEPT, uploadToMyFiles } from "@/lib/my-files-upload";
import { ClashNote } from "@/components/MyFilePickers";

// My files (coach 21 Nov): the logos and fonts kept once per account (lib/my-files.ts), where each one is used, and the
// storage they and the videos take. Rename and Replace never change a file's bytes (a new file is made); Delete only
// when nothing uses it, so no Brand Kit or project loses what it shows.
type Use = { kits: string[]; banners: number; projects: number };
type Storage = { used: number; files: number; storageGb: number | null };
const GB = 1024 ** 3;
const size = (bytes: number) => (bytes >= GB ? `${(bytes / GB).toFixed(1)} GB` : bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
// What Replace takes for each kind (a clip can't be replaced yet: it goes up straight to R2, api/files clipUpload).
const KINDS: Record<MyFileKind, { label: string; accept: string | null }> = {
	logo: { label: "Logo", accept: "image/png,image/jpeg,image/webp" },
	image: { label: "Picture", accept: "image/png,image/jpeg,image/webp,image/gif" },
	font: { label: "Font", accept: ".ttf,.otf,font/ttf,font/otf" },
	video: { label: "Clip", accept: null },
};
// The parts of My files (coach 21 Nov): Video, Audio (sound files, coming) and File (pictures and fonts).
const SECTIONS = [
	{ id: "file", title: "File" },
	{ id: "video", title: "Video" },
	{ id: "audio", title: "Audio" },
] as const;
const unused = (u?: Use) => !u || (u.kits.length === 0 && !u.banners && u.projects === 0);
const usedText = (u?: Use) => {
	if (unused(u)) return "Not used";
	const kits = u!.kits.length ? `Brand Kit${u!.kits.length > 1 ? "s" : ""}: ${u!.kits.join(", ")}` : "";
	const banners = u!.banners ? `${u!.banners} saved banner${u!.banners > 1 ? "s" : ""}` : "";
	const projects = u!.projects ? `${u!.projects} project${u!.projects > 1 ? "s" : ""}` : "";
	return `Used in ${[kits, banners, projects].filter(Boolean).join(" · ")}`;
};

// A font's own letters, loaded once under a name of its own (the same file the videos get).
function FontSample({ file }: { file: MyFile }) {
	const name = `komoray-file-${file.id.slice(0, 16)}`;
	const [ready, setReady] = useState(false);
	useEffect(() => {
		if (typeof FontFace === "undefined") return;
		new FontFace(name, `url(${myFileUrl(file.id)})`)
			.load()
			.then((face) => {
				document.fonts.add(face);
				setReady(true);
			})
			.catch(() => {});
	}, [name, file.id]);
	return <span style={{ fontFamily: ready ? `"${name}"` : undefined, fontSize: 28, lineHeight: 1.2 }}>Aa Bb กขค 123</span>;
}

export default function FilesPage() {
	const user = useUser();
	const [files, setFiles] = useState<MyFile[] | null>(null);
	const [use, setUse] = useState<Record<string, Use>>({});
	const [storage, setStorage] = useState<Storage | null>(null);
	const [tab, setTab] = useState<(typeof SECTIONS)[number]["id"]>("file");
	const [clash, setClash] = useState<{ file: File; conflict: { name: string } } | null>(null);
	const pickRef = useRef<HTMLInputElement>(null);
	const [onlyUnused, setOnlyUnused] = useState(false);
	const [busy, setBusy] = useState<string | null>(null); // the file being renamed, replaced or deleted
	const [note, setNote] = useState("");
	const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

	const load = () => {
		void fetch("/api/files?all=1")
			.then((res) => res.json() as Promise<{ files?: MyFile[]; use?: Record<string, Use>; error?: string }>)
			.then((data) => {
				if (!data.files) return setNote(data.error ?? "Could not load your files");
				setFiles(data.files);
				setUse(data.use ?? {});
			})
			.catch(() => setNote("Could not load your files"));
		void fetch("/api/storage")
			.then((res) => (res.ok ? (res.json() as Promise<Storage>) : null))
			.then((data) => data && setStorage(data))
			.catch(() => {});
	};
	useEffect(() => {
		if (user) load();
	}, [user]);

	// + Upload: each file into its own part (lib/my-files-upload.ts). One file named like one already there asks first.
	async function uploadAll(picked: File[], then?: "use" | "keep") {
		setBusy("upload");
		setNote("");
		setClash(null);
		const failed: string[] = [];
		for (const file of picked) {
			const sent = await uploadToMyFiles(file, then ?? (picked.length > 1 ? "keep" : undefined));
			if ("conflict" in sent) setClash({ file, conflict: sent.conflict });
			else if ("error" in sent) failed.push(sent.error);
			else setTab(MY_FILE_SECTION[sent.file.kind]);
		}
		setBusy(null);
		if (failed.length) setNote(failed.join(" · "));
		load();
	}

	async function rename(id: string, name: string) {
		setBusy(id);
		setNote("");
		const res = await fetch("/api/files", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, name }) }).catch(() => null);
		const data = (await res?.json().catch(() => ({}))) as { file?: MyFile; error?: string };
		setBusy(null);
		if (!res?.ok || !data.file) return setNote(data?.error ?? "Could not rename it");
		setRenaming(null);
		setFiles((list) => list?.map((f) => (f.id === id ? data.file! : f)) ?? list);
	}

	async function replace(old: MyFile, file: File) {
		setBusy(old.id);
		setNote("");
		const query = new URLSearchParams({ kind: old.kind, replace: old.id, name: file.name });
		const res = await fetch(`/api/files?${query}`, { method: "POST", body: file }).catch(() => null);
		const data = (await res?.json().catch(() => ({}))) as { file?: MyFile; kits?: string[]; error?: string };
		setBusy(null);
		if (!res?.ok || !data.file) return setNote(data?.error ?? "Could not replace it");
		const kits = data.kits ?? [];
		const projects = use[old.id]?.projects ?? 0;
		setNote(
			`Replaced "${old.name}".${kits.length ? ` Brand Kit${kits.length > 1 ? "s" : ""} now using the new one: ${kits.join(", ")}.` : ""}${projects ? ` The ${projects} project${projects > 1 ? "s" : ""} made before keep the old one.` : ""}`,
		);
		load();
	}

	async function remove(file: MyFile) {
		if (!window.confirm(`Delete "${file.name}"? This can't be undone.`)) return;
		setBusy(file.id);
		setNote("");
		const res = await fetch(`/api/files?id=${file.id}`, { method: "DELETE" }).catch(() => null);
		const data = (await res?.json().catch(() => ({}))) as { error?: string; use?: Use };
		setBusy(null);
		if (res?.status === 409) {
			setNote(`"${file.name}" is still ${usedText(data.use).toLowerCase()}. Take it out of those first.`);
			return load();
		}
		if (!res?.ok) return setNote(data?.error ?? "Could not delete it");
		load();
	}

	if (user === undefined) return <main className="min-h-screen" />;
	if (!user) {
		return (
			<main className="font-sans mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-4">
				<SignInCard title="Sign in to see your files" />
			</main>
		);
	}

	const shown = (files ?? []).filter((f) => MY_FILE_SECTION[f.kind] === tab && (!onlyUnused || unused(use[f.id])));
	const unusedCount = (files ?? []).filter((f) => unused(use[f.id])).length;
	const videos = storage ? storage.used - storage.files : 0;
	return (
		<main className="font-sans mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-4 sm:p-8">
			<AccountBar user={user} />
			<div className="flex flex-col gap-1">
				<h1 className="text-2xl font-semibold">My files</h1>
				<p className="text-sm text-foreground/60">Everything you upload is kept here once, ready for every video and Brand Kit: pictures, clips, logos and fonts.</p>
			</div>

			{storage && (
				<section className="flex flex-col gap-2 rounded-lg border border-foreground/15 p-3 text-sm">
					<div className="flex items-baseline justify-between gap-3">
						<span className="font-medium">Storage</span>
						<span className="tabular-nums text-foreground/70">{storage.storageGb === null ? `${size(storage.used)} used · no limit during the beta` : `${size(storage.used)} of ${storage.storageGb} GB used`}</span>
					</div>
					{storage.storageGb !== null && (
						<div className="flex h-2 overflow-hidden rounded-full bg-foreground/10" role="progressbar" aria-label="Storage used" aria-valuenow={Math.round((storage.used / (storage.storageGb * GB)) * 100)}>
							<div className="h-full bg-blue-600" style={{ width: `${Math.min(100, (videos / (storage.storageGb * GB)) * 100)}%` }} />
							<div className="h-full bg-amber-500" style={{ width: `${Math.min(100, (storage.files / (storage.storageGb * GB)) * 100)}%` }} />
						</div>
					)}
					<div className="flex flex-wrap gap-4 text-xs text-foreground/70">
						<span className="flex items-center gap-1.5">
							<span className="inline-block h-2 w-2 rounded-full bg-blue-600" /> Videos {size(videos)}
						</span>
						<span className="flex items-center gap-1.5">
							<span className="inline-block h-2 w-2 rounded-full bg-amber-500" /> My files {size(storage.files)}
						</span>
					</div>
				</section>
			)}

			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex gap-1 rounded-lg border border-foreground/20 p-0.5 text-sm" role="tablist">
					{SECTIONS.map((k) => (
						<button key={k.id} role="tab" aria-selected={tab === k.id} onClick={() => setTab(k.id)} className={`rounded-md px-3 py-1 ${tab === k.id ? "bg-foreground text-background" : "hover:bg-foreground/5"}`}>
							{k.title} ({(files ?? []).filter((f) => MY_FILE_SECTION[f.kind] === k.id).length})
						</button>
					))}
				</div>
				{/* One + Upload for everything: each file goes into its part by itself (coach 21 Nov). */}
				<button onClick={() => pickRef.current?.click()} disabled={!!busy} className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
					<Plus size={14} /> {busy === "upload" ? "Uploading…" : "Upload"}
				</button>
				<input
					ref={pickRef}
					type="file"
					multiple
					accept={MY_FILES_ACCEPT}
					className="hidden"
					onChange={(e) => {
						const picked = [...(e.target.files ?? [])];
						e.target.value = "";
						if (picked.length) void uploadAll(picked);
					}}
				/>
				<label className="flex items-center gap-2 text-sm text-foreground/70">
					<input type="checkbox" checked={onlyUnused} onChange={(e) => setOnlyUnused(e.target.checked)} />
					Only files not used ({unusedCount})
				</label>
			</div>

			{note && <p className="rounded-md border border-foreground/15 bg-foreground/5 px-3 py-2 text-sm">{note}</p>}
			{clash && <ClashNote clash={clash} what="file" onUse={() => void uploadAll([clash.file], "use")} onKeep={() => void uploadAll([clash.file], "keep")} onCancel={() => setClash(null)} />}

			{files === null ? (
				<p className="text-sm text-foreground/60">Loading…</p>
			) : tab === "audio" ? (
				<p className="text-sm text-foreground/60">Music and sound effects to put under your videos are coming here soon.</p>
			) : shown.length === 0 ? (
				<p className="text-sm text-foreground/60">{onlyUnused ? "Nothing here." : tab === "video" ? "No clips yet. + Upload an MP4 (up to 150 MB)." : "No pictures or fonts yet. + Upload a JPG, PNG, WebP, GIF, TTF or OTF."}</p>
			) : (
				<ul className="grid gap-3 sm:grid-cols-2">
					{shown.map((f) => (
						<li key={f.id} className={`flex flex-col gap-2 rounded-lg border border-foreground/15 p-3 ${busy === f.id ? "opacity-50" : ""}`}>
							<div className="flex h-20 items-center justify-center overflow-hidden rounded-md bg-[repeating-conic-gradient(rgba(127,127,127,0.18)_0%_25%,transparent_0%_50%)] bg-[length:16px_16px]">
								{f.kind === "font" ? (
									<FontSample file={f} />
								) : f.kind === "video" ? (
									<video src={`${myClipUrl(f.id)}#t=0.5`} muted playsInline preload="metadata" controls className="max-h-20 max-w-full" />
								) : (
									// eslint-disable-next-line @next/next/no-img-element -- the person's own picture, by its id
									<img src={myFileUrl(f.id)} alt="" className="max-h-16 max-w-full object-contain" />
								)}
							</div>
							{renaming?.id === f.id ? (
								<form
									className="flex gap-2"
									onSubmit={(e) => {
										e.preventDefault();
										void rename(f.id, renaming.name);
									}}
								>
									<input autoFocus value={renaming.name} maxLength={60} onChange={(e) => setRenaming({ id: f.id, name: e.target.value })} className="min-w-0 flex-1 rounded-md border border-foreground/20 bg-background px-2 py-1 text-sm" />
									<button className="rounded-md bg-blue-600 px-2 py-1 text-sm text-white">Save</button>
									<button type="button" onClick={() => setRenaming(null)} className="text-sm text-foreground/60 hover:underline">
										Cancel
									</button>
								</form>
							) : (
								<p className="truncate font-medium" title={f.name}>
									{f.name}
								</p>
							)}
							<p className="text-xs text-foreground/60">
								{f.kind === "font" ? `Font · ${f.family ?? ""}` : f.kind === "video" && f.seconds ? `Clip · ${Math.round(f.seconds)}s` : KINDS[f.kind].label} · {size(f.size)} · {new Date(f.at).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}
							</p>
							<p className={`text-xs ${unused(use[f.id]) ? "text-foreground/50" : "text-green-700 dark:text-green-400"}`}>{usedText(use[f.id])}</p>
							<div className="flex flex-wrap gap-2 text-xs">
								<button onClick={() => setRenaming({ id: f.id, name: f.name })} disabled={!!busy} className="flex items-center gap-1 rounded-md border border-foreground/20 px-2 py-1 hover:bg-foreground/5">
									<Pencil size={12} /> Rename
								</button>
								{KINDS[f.kind].accept && (
									<label className={`flex cursor-pointer items-center gap-1 rounded-md border border-foreground/20 px-2 py-1 hover:bg-foreground/5 ${busy ? "pointer-events-none opacity-50" : ""}`} title="Upload a new file in its place. Brand Kits using it change to the new one; videos made before keep this one.">
										<RefreshCw size={12} /> Replace
										<input
											type="file"
											accept={KINDS[f.kind].accept ?? undefined}
											className="hidden"
											onChange={(e) => {
												const file = e.target.files?.[0];
												if (file) void replace(f, file);
												e.target.value = "";
											}}
										/>
									</label>
								)}
								<button
									onClick={() => void remove(f)}
									disabled={!!busy || !unused(use[f.id])}
									title={unused(use[f.id]) ? "Delete this file" : "Still used: take it out of those first"}
									className="flex items-center gap-1 rounded-md border border-foreground/20 px-2 py-1 text-red-600 hover:bg-red-600/10 disabled:cursor-not-allowed disabled:opacity-40"
								>
									<Trash2 size={12} /> Delete
								</button>
							</div>
						</li>
					))}
				</ul>
			)}
		</main>
	);
}
