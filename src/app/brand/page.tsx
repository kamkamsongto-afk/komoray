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

// Brand Kit: the subtitle look (style, font, colour, channel name) every new video starts with.
// Each video can still be changed on its own in the editor without touching the Brand Kit.
export default function BrandPage() {
	const user = useUser();
	const [style, setStyle] = useState<SubtitleStyle | null>(null);
	const [sample, setSample] = useState<keyof typeof SAMPLES>("thai");
	const [status, setStatus] = useState<"saving" | "saved" | "failed" | null>(null);

	useEffect(() => {
		if (!user) return;
		fetch("/api/brand")
			.then((res) => res.json() as Promise<{ style?: SubtitleStyle | null }>)
			.then((data) => setStyle(data.style ?? DEFAULT_STYLE))
			.catch(() => setStyle(DEFAULT_STYLE));
	}, [user]);

	function change(next: SubtitleStyle) {
		setStyle(next);
		setStatus(null);
	}

	async function save() {
		if (!style) return;
		setStatus("saving");
		const res = await fetch("/api/brand", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ style }) }).catch(() => null);
		if (res?.ok) {
			const data = (await res.json()) as { style: SubtitleStyle };
			setStyle(data.style);
		}
		setStatus(res?.ok ? "saved" : "failed");
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
					Set your subtitle look once. Every new video starts with it, so your videos always look like you. You can still change one
					video in the editor without changing your Brand Kit.
				</p>
			</div>

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
								{status === "saving" ? "Saving…" : "Save Brand Kit"}
							</button>
							<button
								onClick={() => change(DEFAULT_STYLE)}
								className="rounded-lg border border-foreground/20 px-3 py-2 text-sm hover:bg-foreground/5"
							>
								Back to the default look
							</button>
							{status === "saved" && <span className="text-sm text-green-600">✓ Saved. Your next videos start with this look.</span>}
							{status === "failed" && <span className="text-sm text-red-600">❌ Could not save. Please try again.</span>}
						</div>
						<p className="text-xs text-foreground/60">
							English-only fonts (Poppins, Anton, Bebas Neue) are skipped for Thai videos, which use Kanit instead.
						</p>
					</div>
				</div>
			)}
		</main>
	);
}
