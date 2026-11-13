"use client";

import { useEffect, useState } from "react";
import { AccountBar, SignInCard, useUser } from "@/components/Account";
import { PlayerFrame } from "@/components/PlayerFrame";
import { SubtitleControls } from "@/components/SubtitleControls";
import { DEFAULT_STYLE, type SubtitleStyle } from "@/lib/subtitle-style";
import type { Line } from "@/lib/timeline";

// Sample subtitle lines; the second word is shown as "being said" for the Highlight style.
const SAMPLES = {
	english: ["Your", " brand", " look"],
	thai: ["สไตล์", "ของ", "คุณ"],
};
const sampleLine = (parts: string[]): Line => ({
	from: 0,
	to: 90,
	text: parts.join(""),
	parts: parts.map((text, k) => ({ text, from: k * 10 })),
});

type Kit = { id: string; name: string; style: SubtitleStyle };
type KitFile = { kits: Kit[]; defaultId: string | null };

// Brand Kits: subtitle looks (style, font, colour, channel name), one per channel if you like (coach, 13 Nov). New
// videos start with the starred one, or the one picked when uploading. Each video can still be changed on its own
// in the editor without touching a Brand Kit.
export default function BrandPage() {
	const user = useUser();
	const [file, setFile] = useState<KitFile | null>(null);
	const [kitId, setKitId] = useState<string | null>(null); // the kit shown; null: a first one, not saved yet
	const [style, setStyle] = useState<SubtitleStyle | null>(null);
	const [name, setName] = useState("");
	const [changed, setChanged] = useState(false);
	const [sample, setSample] = useState<keyof typeof SAMPLES>("thai");
	const [status, setStatus] = useState<"saving" | "saved" | "failed" | null>(null);
	const [error, setError] = useState("");

	function show(next: KitFile, id: string | null) {
		const kit = next.kits.find((k) => k.id === id) ?? next.kits.find((k) => k.id === next.defaultId) ?? next.kits[0];
		setFile(next);
		setKitId(kit?.id ?? null);
		setStyle(kit?.style ?? DEFAULT_STYLE);
		setName(kit?.name ?? "My brand");
		setChanged(false);
	}

	useEffect(() => {
		if (!user) return;
		fetch("/api/brand")
			.then((res) => res.json() as Promise<Partial<KitFile>>)
			.then((data) => show({ kits: data.kits ?? [], defaultId: data.defaultId ?? null }, null))
			.catch(() => show({ kits: [], defaultId: null }, null));
	}, [user]);

	function change(next: SubtitleStyle) {
		setStyle(next);
		setChanged(true);
		setStatus(null);
	}

	async function call(method: "PUT" | "PATCH" | "DELETE", body: object) {
		setError("");
		const res = await fetch("/api/brand", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
		const data = (await res?.json().catch(() => null)) as (KitFile & { error?: string }) | null;
		if (!res?.ok || !data?.kits) {
			setError(data?.error ?? "That didn't work. Please try again.");
			return null;
		}
		return data;
	}

	async function save() {
		if (!style) return;
		setStatus("saving");
		const data = await call("PUT", { style, name, ...(kitId && { kitId }) });
		setStatus(data ? "saved" : "failed");
		if (data) show(data, kitId ?? data.kits[data.kits.length - 1]?.id ?? null);
	}

	// Another kit: unsaved changes are asked about first.
	const leave = () => !changed || window.confirm("You haven't saved this Brand Kit. Leave it without saving?");
	function open(id: string) {
		if (file && leave()) show(file, id);
	}
	async function make(copy: boolean) {
		if (!file || !leave()) return;
		const named = window.prompt("Name the new Brand Kit (a channel name, say):", copy ? `${name} copy` : `Brand Kit ${file.kits.length + 1}`);
		if (named === null) return;
		const data = await call("PUT", { style: copy && style ? style : DEFAULT_STYLE, name: named });
		if (data) show(data, data.kits[data.kits.length - 1]?.id ?? null);
	}
	async function rename() {
		const kit = file?.kits.find((k) => k.id === kitId);
		if (!kit || !name.trim() || name.trim() === kit.name) return;
		const data = await call("PATCH", { kitId, name });
		if (data) setFile(data);
	}
	async function star() {
		const data = await call("PATCH", { kitId, star: true });
		if (data) setFile(data);
	}
	async function remove() {
		const kit = file?.kits.find((k) => k.id === kitId);
		if (!kit || !window.confirm(`Delete the Brand Kit "${kit.name}"? Videos you already made keep their look.`)) return;
		const data = await call("DELETE", { kitId });
		if (data) show(data, null);
	}

	if (user === undefined) return <main className="min-h-screen" />;
	if (user === null) {
		return (
			<main className="font-sans mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-4">
				<SignInCard title="Sign in to set up your Brand Kit" />
			</main>
		);
	}

	return (
		<main className="font-sans mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-4 sm:p-8">
			<AccountBar user={user} />
			<div className="flex flex-col gap-2">
				<h1 className="text-3xl font-bold tracking-tight">Brand Kit</h1>
				<p className="text-sm text-foreground/70">
					Set your subtitle look once, one per channel if you like. New videos start with the starred one ⭐, or the one you pick when
					uploading. You can still change one video in the editor without changing your Brand Kits.
				</p>
			</div>

			{file && (
				<div className="flex flex-col gap-2">
					<div className="flex flex-wrap items-center gap-1.5">
						{file.kits.map((k) => (
							<button
								key={k.id}
								onClick={() => open(k.id)}
								className={`rounded-full border px-3 py-1 text-sm ${k.id === kitId ? "border-blue-600 bg-blue-600/10 font-medium" : "border-foreground/20 hover:bg-foreground/5"}`}
							>
								{k.id === file.defaultId && <span aria-label="Starred">⭐ </span>}
								{k.name}
							</button>
						))}
						{file.kits.length > 0 && (
							<>
								<button onClick={() => void make(false)} className="rounded-full border border-dashed border-foreground/30 px-3 py-1 text-sm text-foreground/70 hover:bg-foreground/5">
									+ New
								</button>
								<button onClick={() => void make(true)} className="rounded-full px-2 py-1 text-sm text-foreground/60 hover:text-foreground" title="A new Brand Kit that starts as a copy of this one">
									Duplicate
								</button>
							</>
						)}
					</div>
					<div className="flex flex-wrap items-center gap-2 text-sm">
						<label className="flex items-center gap-2">
							<span className="text-foreground/70">Name</span>
							<input
								value={name}
								maxLength={40}
								onChange={(e) => setName(e.target.value)}
								onBlur={() => void rename()}
								onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
								className="w-48 rounded-md border border-foreground/20 bg-background px-2 py-1"
							/>
						</label>
						{kitId && kitId !== file.defaultId && (
							<button onClick={() => void star()} className="rounded-md border border-foreground/20 px-2.5 py-1 hover:bg-foreground/5" title="New videos start with this one">
								⭐ Make it my default
							</button>
						)}
						{kitId && file.kits.length > 1 && (
							<button onClick={() => void remove()} className="rounded-md px-2.5 py-1 text-foreground/60 hover:bg-red-600/10 hover:text-red-600">
								Delete
							</button>
						)}
					</div>
					{error && <p className="text-sm text-red-600">{error}</p>}
				</div>
			)}

			{!style ? (
				<p className="text-sm text-foreground/60">Loading…</p>
			) : (
				<div className="grid gap-6 sm:grid-cols-[minmax(0,260px)_minmax(0,1fr)] sm:items-start">
					<div className="flex flex-col gap-2">
						<PlayerFrame
							playing={false}
							outTime={1 / 3 + 0.01}
							total={0}
							line={sampleLine(SAMPLES[sample])}
							subtitle={style}
							onSubtitleChange={change}
							onToggle={() => {}}
							onScrub={() => {}}
							debugCount={null}
							bare
						>
							<div className="absolute inset-0 bg-gradient-to-b from-slate-500 via-slate-600 to-slate-800" />
						</PlayerFrame>
						<div className="flex self-center rounded-lg border border-foreground/20 p-0.5 text-xs">
							{(["thai", "english"] as const).map((s) => (
								<button
									key={s}
									onClick={() => setSample(s)}
									className={`rounded-md px-2.5 py-1 ${sample === s ? "bg-foreground text-background" : "text-foreground/70"}`}
								>
									{s === "thai" ? "ไทย" : "English"}
								</button>
							))}
						</div>
					</div>
					<div className="flex flex-col gap-3">
						<SubtitleControls style={style} onChange={change} thai={false} />
						<div className="flex flex-wrap items-center gap-2">
							<button
								onClick={() => void save()}
								disabled={status === "saving"}
								className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
							>
								{status === "saving" ? "Saving…" : kitId ? "Save Brand Kit" : "Save my first Brand Kit"}
							</button>
							<button
								onClick={() => change(DEFAULT_STYLE)}
								className="rounded-lg border border-foreground/20 px-3 py-2 text-sm hover:bg-foreground/5"
							>
								Back to the default look
							</button>
							{status === "saved" && <span className="text-sm text-green-600">Saved.{kitId === file?.defaultId ? " Your next videos start with this look." : ""}</span>}
							{status === "failed" && <span className="text-sm text-red-600">Could not save. Please try again.</span>}
						</div>
						<p className="text-xs text-foreground/60">
							English-only fonts are skipped for Thai videos, which use Kanit instead.
						</p>
					</div>
				</div>
			)}
		</main>
	);
}
