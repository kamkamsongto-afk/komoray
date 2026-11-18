"use client";

import { Clapperboard, Copy, FileVideo, Folder, FolderPlus, LayoutGrid, List, type LucideIcon, MoreHorizontal, Scissors, Sparkles, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AccountBar, SignInCard, useUser } from "@/components/Account";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Project = { id: string; video_key: string; filename: string; size: number; created_at: string; folder_id?: string | null };
type FolderRow = { id: string; name: string };
type View = "list" | "grid";
const ALL = "all"; // the folder chip that shows every video

// Folders (coach, 18 Nov): supabase/migrations/003_folders.sql. Until that has run on a database, the folders table and
// projects.folder_id don't exist: the page then loads as before and simply shows no folders.
function FolderBar({
	folders,
	counts,
	current,
	pick,
	onChange,
	onError,
}: {
	folders: FolderRow[];
	counts: Record<string, number>;
	current: string;
	pick: (id: string) => void;
	onChange: (folders: FolderRow[]) => void;
	onError: (error: string) => void;
}) {
	const [naming, setNaming] = useState<"new" | "rename" | null>(null);
	const [name, setName] = useState("");
	const [asking, setAsking] = useState(false); // "Delete folder" pressed once
	const open = folders.find((f) => f.id === current);

	async function save() {
		const clean = name.trim().slice(0, 60);
		if (!clean) return setNaming(null);
		const db = supabaseBrowser();
		if (naming === "rename" && open) {
			const { error } = await db.from("folders").update({ name: clean }).eq("id", open.id);
			if (error) return onError("Could not rename the folder. Please try again.");
			onChange(folders.map((f) => (f.id === open.id ? { ...f, name: clean } : f)));
		} else {
			const { data, error } = await db.from("folders").insert({ name: clean }).select("id, name").single();
			if (error || !data) return onError("Could not make the folder. Please try again.");
			onChange([...folders, data]);
			pick(data.id);
		}
		setNaming(null);
	}

	// The videos inside stay: the database moves them back to All videos (on delete set null).
	async function remove() {
		if (!open) return;
		const { error } = await supabaseBrowser().from("folders").delete().eq("id", open.id);
		setAsking(false);
		if (error) return onError("Could not delete the folder. Please try again.");
		onChange(folders.filter((f) => f.id !== open.id));
		pick(ALL);
	}

	const chip = (id: string, label: string, count: number) => (
		<button
			key={id}
			onClick={() => {
				pick(id);
				setAsking(false);
				setNaming(null);
			}}
			className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${current === id ? "border-foreground bg-foreground text-background" : "border-foreground/20 hover:bg-foreground/5"}`}
		>
			{id !== ALL && <Folder className="h-3.5 w-3.5" aria-hidden />}
			{label}
			<span className="text-xs opacity-60">{count}</span>
		</button>
	);

	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-wrap items-center gap-2" aria-label="Folders">
				{chip(ALL, "All videos", counts[ALL] ?? 0)}
				{folders.map((f) => chip(f.id, f.name, counts[f.id] ?? 0))}
				{naming ? (
					<form
						onSubmit={(e) => {
							e.preventDefault();
							void save();
						}}
						className="flex items-center gap-1"
					>
						<input
							autoFocus
							value={name}
							maxLength={60}
							onChange={(e) => setName(e.target.value)}
							onKeyDown={(e) => e.key === "Escape" && setNaming(null)}
							placeholder="Folder name"
							aria-label="Folder name"
							className="w-40 rounded-full border border-foreground/30 bg-background px-3 py-1 text-sm"
						/>
						<button type="submit" className="rounded-full bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700">
							Save
						</button>
						<button type="button" onClick={() => setNaming(null)} className="rounded-full px-2 py-1 text-sm text-foreground/60 hover:text-foreground">
							Cancel
						</button>
					</form>
				) : (
					<button
						onClick={() => {
							setName("");
							setNaming("new");
						}}
						className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-foreground/30 px-3 py-1 text-sm text-foreground/70 hover:bg-foreground/5"
					>
						<FolderPlus className="h-3.5 w-3.5" aria-hidden />
						New folder
					</button>
				)}
			</div>
			{open && !naming && (
				<div className="flex flex-wrap items-center gap-3 text-xs text-foreground/60">
					<button
						onClick={() => {
							setName(open.name);
							setNaming("rename");
						}}
						className="underline hover:text-foreground"
					>
						Rename folder
					</button>
					{asking ? (
						<span className="flex items-center gap-2">
							Delete &quot;{open.name}&quot;? Its videos stay in All videos.
							<button onClick={() => void remove()} className="rounded-md bg-red-600 px-2 py-0.5 font-medium text-white hover:bg-red-700">
								Delete folder
							</button>
							<button onClick={() => setAsking(false)} className="underline hover:text-foreground">
								Cancel
							</button>
						</span>
					) : (
						<button onClick={() => setAsking(true)} className="underline hover:text-red-600">
							Delete folder
						</button>
					)}
				</div>
			)}
		</div>
	);
}

// Which folder a video is in, changed right here (only folder_id may change: 003_folders.sql).
function MoveTo({ project, folders, onMoved, onError }: { project: Project; folders: FolderRow[]; onMoved: (folderId: string | null) => void; onError: (error: string) => void }) {
	return (
		<select
			value={project.folder_id ?? ""}
			onChange={async (e) => {
				const folderId = e.target.value || null;
				const { error } = await supabaseBrowser().from("projects").update({ folder_id: folderId }).eq("id", project.id);
				if (error) onError(`Could not move ${project.filename}. Please try again.`);
				else onMoved(folderId);
			}}
			aria-label={`Folder for ${project.filename}`}
			title="Move to a folder"
			className="max-w-28 shrink-0 rounded-md border border-foreground/20 bg-background px-1 py-1 text-xs text-foreground/70"
		>
			<option value="">No folder</option>
			{folders.map((f) => (
				<option key={f.id} value={f.id}>
					{f.name}
				</option>
			))}
		</select>
	);
}

const KEEP_DAYS = 14; // beta: R2 deletes uploads after 14 days
const DAY_MS = 24 * 60 * 60 * 1000;
const VIEW_PREF = "komoray.projectsView"; // remembers list or thumbnails in this browser

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const GB = 1024 ** 3;
const size = (bytes: number) => (bytes >= GB ? `${(bytes / GB).toFixed(1)} GB` : mb(bytes));
type Storage = {
	used: number;
	perProject: Record<string, number>;
	gone: string[];
	storageGb: number | null;
	deletion: { at: string; why: "plan ended" | "not used"; countdown: boolean } | null;
};

// How much of their plan's storage their projects take (Terms "Storage"), and, once a plan has ended, the days left before
// the files are deleted (from 20 days before, lib/storage.ts). Only with a plan's storage: the beta has none.
function StorageBar({ storage }: { storage: Storage }) {
	const [now] = useState(() => Date.now()); // when the page opened: days left are counted from then
	if (storage.storageGb === null) return null;
	const cap = storage.storageGb * GB;
	const share = Math.min(1, storage.used / cap);
	const left = storage.deletion ? Math.max(0, Math.ceil((new Date(storage.deletion.at).getTime() - now) / DAY_MS)) : 0;
	return (
		<div className="flex flex-col gap-2">
			{storage.deletion?.countdown && (
				<p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
					Your plan has ended. Your videos will be deleted in <span className="font-semibold">{left} {left === 1 ? "day" : "days"}</span> (
					{new Date(storage.deletion.at).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}). Download what you
					want to keep, or{" "}
					<Link href="/pricing" className="font-medium underline">
						start a plan again
					</Link>{" "}
					to keep everything.
				</p>
			)}
			<div className="flex max-w-md flex-col gap-1">
				<div className="flex items-center justify-between text-xs text-foreground/70">
					<span>Storage</span>
					<span>
						{size(storage.used)} of {storage.storageGb} GB used
					</span>
				</div>
				<div className="h-1.5 overflow-hidden rounded-full bg-foreground/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} aria-label="Storage used">
					<div className={`h-full rounded-full ${share >= 0.9 ? "bg-amber-500" : "bg-blue-600"}`} style={{ width: `${Math.max(share * 100, storage.used ? 1 : 0)}%` }} />
				</div>
				{share >= 1 && <p className="text-xs text-amber-700 dark:text-amber-400">Your storage is full. Delete videos to upload new ones.</p>}
			</div>
		</div>
	);
}

// What a new user sees before their first video.
const FIRST_STEPS: [LucideIcon, string, string][] = [
	[Upload, "Upload a video", "Straight from your computer, or send it from your phone with a QR code."],
	[Scissors, "Komoray does the first cut", "It cuts the silences and the takes you said again, and writes your script with subtitles."],
	[Sparkles, "Make it yours", "Fix any word, pick a subtitle style, then press Make video. Your fixes are remembered next time."],
];

// The video's picture (made with its preview copy); a plain tile until it exists.
function Thumb({ videoKey }: { videoKey: string }) {
	const [failed, setFailed] = useState(false);
	return failed ? (
		<Clapperboard className="h-8 w-8 text-foreground/40" aria-hidden />
	) : (
		// eslint-disable-next-line @next/next/no-img-element -- a private picture from our own API
		<img src={`/api/thumb?key=${encodeURIComponent(videoKey)}`} alt="" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
	);
}

// Duplicate (coach, 18 Nov): the page does the work (duplicate() below) and keeps a "Duplicating…" card meanwhile;
// this blinks clearly while it runs, so it's plain something is happening.
function DuplicateButton({ project, busy, onClick }: { project: Project; busy: boolean; onClick: () => void }) {
	return (
		<button
			onClick={onClick}
			disabled={busy}
			aria-label={`Duplicate ${project.filename}`}
			title={busy ? "Duplicating…" : "Duplicate: a copy with all your edits, to make another version"}
			className={`shrink-0 rounded-lg p-2 ${busy ? "blink-strong" : "text-foreground/50 hover:bg-foreground/10 hover:text-foreground"}`}
		>
			<Copy className="h-4 w-4" aria-hidden />
		</button>
	);
}

// The name, with a ⋯ menu to rename it (only the name in My projects: the file itself keeps its name).
function NameLine({ project, href, onRenamed, onError }: { project: Project; href: string; onRenamed: (name: string) => void; onError: (error: string) => void }) {
	const [menu, setMenu] = useState(false);
	const [editing, setEditing] = useState(false);
	const [name, setName] = useState(project.filename);

	async function save() {
		const clean = name.trim().slice(0, 120);
		setEditing(false);
		if (!clean || clean === project.filename) return;
		const { error } = await supabaseBrowser().from("projects").update({ filename: clean }).eq("id", project.id);
		if (error) onError(`Could not rename ${project.filename}. Please try again.`);
		else onRenamed(clean);
	}

	if (editing) {
		return (
			<form
				onSubmit={(e) => {
					e.preventDefault();
					void save();
				}}
				className="flex min-w-0 flex-1 items-center gap-1"
			>
				<input
					autoFocus
					value={name}
					maxLength={120}
					onChange={(e) => setName(e.target.value)}
					onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
					onBlur={() => void save()}
					aria-label="Video name"
					className="min-w-0 flex-1 rounded-md border border-foreground/30 bg-background px-2 py-0.5 text-sm"
				/>
			</form>
		);
	}
	return (
		<div className="relative flex min-w-0 flex-1 items-center gap-1">
			<Link href={href} className="min-w-0 flex-1 truncate text-sm font-medium" title={project.filename}>
				{project.filename}
			</Link>
			<button onClick={() => setMenu((m) => !m)} aria-label={`More for ${project.filename}`} title="More" className="shrink-0 rounded-md p-1 text-foreground/50 hover:bg-foreground/10 hover:text-foreground">
				<MoreHorizontal className="h-4 w-4" aria-hidden />
			</button>
			{menu && (
				<div className="absolute top-full right-0 z-10 mt-1 flex min-w-28 flex-col rounded-lg border border-foreground/15 bg-background p-1 text-sm shadow-lg" onMouseLeave={() => setMenu(false)}>
					<button
						onClick={() => {
							setMenu(false);
							setName(project.filename);
							setEditing(true);
						}}
						className="rounded-md px-3 py-1.5 text-left hover:bg-foreground/10"
					>
						Rename
					</button>
				</div>
			)}
		</div>
	);
}

// The bin, which asks once more before deleting: a deleted video can't come back.
function DeleteButton({ project, onDeleted, onError }: { project: Project; onDeleted: () => void; onError: (error: string) => void }) {
	const [state, setState] = useState<"idle" | "asking" | "deleting">("idle");

	async function remove() {
		setState("deleting");
		const res = await fetch(`/api/projects?key=${encodeURIComponent(project.video_key)}`, { method: "DELETE" }).catch(() => null);
		if (res?.ok) return onDeleted();
		setState("idle");
		onError(`Could not delete ${project.filename}. Please try again.`);
	}

	if (state === "idle") {
		return (
			<button
				onClick={() => setState("asking")}
				aria-label={`Delete ${project.filename}`}
				title="Delete this video"
				className="shrink-0 rounded-lg p-2 text-foreground/50 hover:bg-red-600/10 hover:text-red-600"
			>
				<Trash2 className="h-4 w-4" aria-hidden />
			</button>
		);
	}
	return (
		<div className="flex shrink-0 items-center gap-1 text-xs">
			<button
				onClick={() => void remove()}
				disabled={state === "deleting"}
				className="rounded-md bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-60"
			>
				{state === "deleting" ? "Deleting…" : "Delete"}
			</button>
			<button onClick={() => setState("idle")} disabled={state === "deleting"} className="rounded-md border border-foreground/20 px-2 py-1 hover:bg-foreground/5 disabled:opacity-60">
				Cancel
			</button>
		</div>
	);
}

export default function ProjectsPage() {
	const user = useUser();
	const [projects, setProjects] = useState<Project[] | null>(null);
	const [error, setError] = useState("");
	const [view, setView] = useState<View>("list");
	const [folders, setFolders] = useState<FolderRow[] | null>(null); // null: no folders on this database yet
	const [current, setCurrent] = useState(ALL);
	const [copying, setCopying] = useState<Project[]>([]); // "Duplicating…" cards, one per copy on its way (id: the original's)
	const [storage, setStorage] = useState<Storage | null>(null);

	// What their projects take, against their plan's storage (api/storage). Asked again after a delete or a copy.
	const loadStorage = () =>
		void fetch("/api/storage")
			.then((r) => (r.ok ? (r.json() as Promise<Storage>) : null))
			.then((s) => s && setStorage(s))
			.catch(() => {});

	useEffect(() => {
		try {
			if (localStorage.getItem(VIEW_PREF) === "grid") setView("grid");
		} catch {
			// no browser storage here: start with the list
		}
	}, []);

	function changeView(next: View) {
		setView(next);
		try {
			localStorage.setItem(VIEW_PREF, next);
		} catch {
			// not remembered this time
		}
	}

	useEffect(() => {
		if (!user) return;
		// The database only returns this user's rows (Row Level Security). With folder_id first; a database without
		// folders yet (003_folders.sql not run) refuses that column, so ask again without it and show no folders.
		const db = supabaseBrowser();
		const load = (columns: string) => db.from("projects").select(columns).order("created_at", { ascending: false }).returns<Project[]>();
		void (async () => {
			let { data, error } = await load("id, video_key, filename, size, created_at, folder_id");
			if (error) ({ data, error } = await load("id, video_key, filename, size, created_at"));
			else {
				const kept = await db.from("folders").select("id, name").order("created_at");
				if (!kept.error) setFolders(kept.data);
			}
			if (error) setError("Could not load your projects");
			else setProjects(data);
		})();
		loadStorage();
	}, [user]);

	if (user === undefined) return <main className="min-h-screen" />;
	if (user === null) {
		return (
			<main className="font-sans mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-4">
				<SignInCard title="Sign in to see your projects" />
			</main>
		);
	}

	const daysLeft = (createdAt: string) => KEEP_DAYS - Math.floor((Date.now() - new Date(createdAt).getTime()) / DAY_MS);
	// With a plan's storage (lib/storage.ts), videos stay until they delete them (or the clean-up does, which marks them
	// gone): no 14 days. Without one (the beta), R2 deletes them after 14 days, as before.
	// The 14-day filter only once we know it's the beta (agent review 19 Nov): while /api/storage loads, or if it fails, a
	// paying person's older videos would vanish from the list for a moment.
	const capped = storage?.storageGb != null;
	const beta = storage !== null && storage.storageGb === null;
	const gone = new Set(storage?.gone ?? []);
	const live = projects?.filter((p) => (beta ? daysLeft(p.created_at) > 0 : !gone.has(p.id))) ?? [];
	const bytesOf = (p: Project) => storage?.perProject[p.id] ?? p.size;
	const editLink = (p: Project) => `/edit?key=${encodeURIComponent(p.video_key)}`; // the editor sends videos without a script yet back to the upload page
	const deleted = (p: Project) => {
		setProjects((list) => list?.filter((x) => x.id !== p.id) ?? null);
		loadStorage();
	};
	// A deleted folder's videos are in no folder now (the database did it: on delete set null), so say so here too.
	const foldersChanged = (next: FolderRow[]) => {
		setFolders(next);
		setProjects((list) => list?.map((p) => (p.folder_id && !next.some((f) => f.id === p.folder_id) ? { ...p, folder_id: null } : p)) ?? null);
	};
	const renamed = (p: Project, filename: string) => setProjects((list) => list?.map((x) => (x.id === p.id ? { ...x, filename } : x)) ?? null);
	// The copy can take a while (the whole video is copied in storage): its card shows at once and blinks until it's done.
	async function duplicate(p: Project) {
		setError("");
		setCopying((list) => [{ ...p, filename: `${p.filename} (copy)` }, ...list]);
		const res = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: p.video_key }) }).catch(() => null);
		const data = (await res?.json().catch(() => null)) as { project?: Project; error?: string } | null;
		setCopying((list) => list.filter((x) => x.id !== p.id));
		const copy = data?.project;
		if (res?.ok && copy) {
			setProjects((list) => (list ? [copy, ...list] : [copy]));
			loadStorage();
		}
		else setError(data?.error ?? `Could not duplicate ${p.filename}. Please try again.`);
	}
	const busy = (p: Project) => copying.some((x) => x.id === p.id);
	const moved = (p: Project, folderId: string | null) => setProjects((list) => list?.map((x) => (x.id === p.id ? { ...x, folder_id: folderId } : x)) ?? null);
	const counts: Record<string, number> = { [ALL]: live.length };
	for (const p of live) if (p.folder_id) counts[p.folder_id] = (counts[p.folder_id] ?? 0) + 1;
	const shown = current === ALL ? live : live.filter((p) => p.folder_id === current);
	const waiting = copying.filter((c) => current === ALL || c.folder_id === current);
	const moveTo = (p: Project) => folders && <MoveTo project={p} folders={folders} onMoved={(id) => moved(p, id)} onError={setError} />;
	const details = (p: Project) => `${new Date(p.created_at).toLocaleDateString()} · ${size(bytesOf(p))}${capped ? "" : ` · deleted in ${daysLeft(p.created_at)} days`}`;

	return (
		<main className="font-sans mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-4 sm:p-8">
			<AccountBar user={user} />
			<div className="flex items-center justify-between gap-3">
				<h1 className="text-3xl font-bold tracking-tight">My projects</h1>
				{live.length > 0 && (
					<div className="flex rounded-lg border border-foreground/20 p-0.5" role="radiogroup" aria-label="How to show your projects">
						{(
							[
								["list", List, "List"],
								["grid", LayoutGrid, "Thumbnails"],
							] as const
						).map(([id, Icon, name]) => (
							<button
								key={id}
								role="radio"
								aria-checked={view === id}
								aria-label={name}
								title={name}
								onClick={() => changeView(id)}
								className={`rounded-md p-1.5 ${view === id ? "bg-foreground text-background" : "text-foreground/60 hover:text-foreground"}`}
							>
								<Icon className="h-4 w-4" aria-hidden />
							</button>
						))}
					</div>
				)}
			</div>

			{error && <p className="text-sm text-red-600">{error}</p>}
			{!projects && !error && <p className="text-sm text-foreground/60">Loading…</p>}
			{projects && live.length === 0 && (
				<div className="flex max-w-xl flex-col gap-5 rounded-2xl border border-foreground/15 p-6">
					<p className="text-lg font-medium">Your first video takes about 3 minutes.</p>
					<ol className="flex flex-col gap-3 text-sm text-foreground/80">
						{FIRST_STEPS.map(([Icon, title, text], i) => (
							<li key={title} className="flex gap-3">
								<Icon className="mt-0.5 h-5 w-5 shrink-0 text-foreground/60" aria-hidden />
								<span>
									<span className="font-medium text-foreground">
										{i + 1}. {title}
									</span>
									<br />
									{text}
								</span>
							</li>
						))}
					</ol>
					<div className="flex flex-wrap items-center gap-3">
						<Link href="/upload" className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700">
							Upload your first video
						</Link>
						<Link href="/brand" className="text-sm text-foreground/70 underline hover:text-foreground">
							or set up your Brand Kit first
						</Link>
					</div>
				</div>
			)}

			{storage && <StorageBar storage={storage} />}
			{folders && live.length > 0 && <FolderBar folders={folders} counts={counts} current={current} pick={setCurrent} onChange={foldersChanged} onError={setError} />}
			{current !== ALL && shown.length === 0 && waiting.length === 0 && <p className="text-sm text-foreground/60">No videos in this folder yet. Pick it in the folder box next to a video to move it here.</p>}

			{view === "list" ? (
				<ul className="flex flex-col divide-y divide-foreground/10 rounded-xl border border-foreground/15 empty:hidden">
					{waiting.map((c) => (
						<li key={`copy-${c.id}`} className="flex items-center gap-3 p-3 text-foreground/60">
							<Copy className="blink-strong h-7 w-7 shrink-0 rounded-md p-1.5" aria-hidden />
							<span className="min-w-0 flex-1 truncate font-medium">{c.filename}</span>
							<span className="text-xs">Duplicating…</span>
						</li>
					))}
					{shown.map((p) => (
						<li key={p.id} className="flex items-center gap-2 py-2 pr-2 pl-3 hover:bg-foreground/5">
							<FileVideo className="h-5 w-5 shrink-0 text-foreground/50" aria-hidden />
							<NameLine project={p} href={editLink(p)} onRenamed={(name) => renamed(p, name)} onError={setError} />
							<span className="hidden shrink-0 text-xs text-foreground/60 sm:inline">{details(p)}</span>
							{moveTo(p)}
							<DuplicateButton project={p} busy={busy(p)} onClick={() => void duplicate(p)} />
							<DeleteButton project={p} onDeleted={() => deleted(p)} onError={setError} />
						</li>
					))}
				</ul>
			) : (
				<ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
					{waiting.map((c) => (
						<li key={`copy-${c.id}`} className="flex flex-col overflow-hidden rounded-xl border border-dashed border-blue-500/60">
							<div className="flex aspect-[3/4] items-center justify-center bg-foreground/5">
								<Copy className="blink-strong h-12 w-12 rounded-xl p-3" aria-hidden />
							</div>
							<div className="flex flex-col gap-1 p-2 text-foreground/60">
								<span className="truncate text-sm font-medium">{c.filename}</span>
								<span className="text-xs">Duplicating…</span>
							</div>
						</li>
					))}
					{/* Card (coach, 18 Nov): name + ⋯ / days left / folder / Duplicate on the left, the bin on the right. */}
					{shown.map((p) => (
						<li key={p.id} className="flex flex-col overflow-hidden rounded-xl border border-foreground/15 hover:border-foreground/40">
							<Link href={editLink(p)} className="flex aspect-[3/4] items-center justify-center overflow-hidden bg-foreground/10">
								<Thumb videoKey={p.video_key} />
							</Link>
							<div className="flex flex-col gap-1 p-2">
								<NameLine project={p} href={editLink(p)} onRenamed={(name) => renamed(p, name)} onError={setError} />
								<span className="text-xs text-foreground/60">{capped ? size(bytesOf(p)) : `${daysLeft(p.created_at)} days left`}</span>
								{moveTo(p)}
								<div className="flex min-h-9 items-center justify-between gap-1">
									<DuplicateButton project={p} busy={busy(p)} onClick={() => void duplicate(p)} />
									<DeleteButton project={p} onDeleted={() => deleted(p)} onError={setError} />
								</div>
							</div>
						</li>
					))}
				</ul>
			)}

			{!capped && live.length > 0 && <p className="text-xs text-foreground/50">During the beta, videos are deleted automatically after {KEEP_DAYS} days.</p>}
		</main>
	);
}
