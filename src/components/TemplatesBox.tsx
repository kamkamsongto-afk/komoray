"use client";

import { LayoutTemplate, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { leftOutText, type LeftOut, TEMPLATE, type TemplateCard, type TemplateLook } from "@/lib/templates";
import { Confirm } from "./ConfirmDelete";

type Props = {
	look: TemplateLook; // this video's look now
	seconds: number; // how long it runs once cut
	checkingTakes: boolean; // bad takes are still being looked for, so the end may move
	// Puts a template's look (as sent by the server, not yet fitted to this video) on this video.
	onUse: (name: string, look: TemplateLook, seconds: number, left: LeftOut, withStyle: boolean) => void;
};
type Answer = { templates?: TemplateCard[]; limit?: number; template?: { name: string; seconds: number; look: TemplateLook }; left?: LeftOut; error?: string };
type Asking = { kind: "use" | "update" | "delete"; card: TemplateCard };

const INCLUDES = "Includes subtitle style, shape, logo, zoom, Banners, Frame Me and Layout. Cutout is not included.";
const count = (n: number, one: string, many = `${one}s`) => (n ? `${n} ${n > 1 ? many : one}` : "");

// The header button and its box: save this video's look as a template, and use, update, rename or delete one
// (coach 26 Nov: a template is made from a real video and can be changed any time).
export function TemplatesButton(props: Props) {
	const [open, setOpen] = useState(false);
	const close = useCallback(() => setOpen(false), []);
	return (
		<>
			<button onClick={() => setOpen(true)} title="Save this video's look, or use a saved one" className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/20 px-2.5 py-1.5 text-sm hover:bg-foreground/5">
				<LayoutTemplate className="h-3.5 w-3.5 shrink-0" aria-hidden />
				Templates
			</button>
			{open && <TemplatesBox {...props} onClose={close} />}
		</>
	);
}

function TemplatesBox({ look, seconds, checkingTakes, onUse, onClose }: Props & { onClose: () => void }) {
	const [cards, setCards] = useState<TemplateCard[] | null>(null);
	const [limit, setLimit] = useState(0);
	const [name, setName] = useState("");
	const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
	const [asking, setAsking] = useState<Asking | null>(null);
	const stopAsking = useCallback(() => setAsking(null), []);
	// "Keep all same with logo" (coach 26 Nov): ticked every time Use is pressed; unticked, this video's own subtitle
	// style and logo stay and the rest of the template comes.
	const [withStyle, setWithStyle] = useState(true);
	const [busy, setBusy] = useState(false);
	const [note, setNote] = useState("");
	const [error, setError] = useState("");
	const box = useRef<HTMLDivElement>(null);

	// One question to the server. null: it didn't work (said in red). A list in the answer is shown.
	const ask = useCallback(async (url: string, init?: RequestInit) => {
		setBusy(true);
		setError("");
		setNote("");
		const res = await fetch(url, init).catch(() => null);
		const data = (await res?.json().catch(() => null)) as Answer | null;
		setBusy(false);
		if (!res?.ok || !data) {
			setError(data?.error ?? "Could not reach your templates. Please try again.");
			return null;
		}
		if (data.templates) {
			setCards(data.templates);
			setLimit(data.limit ?? 0);
		}
		return data;
	}, []);
	const send = (method: "POST" | "PUT", body: object) => ask("/api/templates", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

	useEffect(() => {
		let gone = false;
		void (async () => {
			const res = await fetch("/api/templates").catch(() => null);
			const data = (await res?.json().catch(() => null)) as Answer | null;
			if (gone) return;
			if (!res?.ok || !data?.templates) return setError(data?.error ?? "Could not reach your templates. Please try again.");
			setCards(data.templates);
			setLimit(data.limit ?? 0);
		})();
		return () => {
			gone = true;
		};
	}, []);

	// While open, keys belong to it: Delete, space or Ctrl+Z must not reach the script and timeline behind. Esc closes
	// it (a question over it handles its own keys). Typing still works: only the page's listeners are kept from them.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (document.querySelector("[role='alertdialog']")) return;
			e.stopPropagation();
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey, true);
		box.current?.focus();
		return () => window.removeEventListener("keydown", onKey, true);
	}, [onClose]);

	async function save() {
		const data = await send("POST", { name, seconds, look });
		if (!data) return;
		setName("");
		setNote(`Saved. ${data.left ? leftOutText(data.left) : ""}`.trim());
	}
	async function confirmed({ kind, card }: Asking) {
		setAsking(null);
		if (kind === "delete") {
			if (await ask(`/api/templates?id=${encodeURIComponent(card.id)}`, { method: "DELETE" })) setNote(`Deleted "${card.name}".`);
		} else if (kind === "update") {
			const data = await send("PUT", { id: card.id, seconds, look });
			if (data) setNote(`"${card.name}" now has this video's look. ${data.left ? leftOutText(data.left) : ""}`.trim());
		} else {
			const data = await ask(`/api/templates?id=${encodeURIComponent(card.id)}`);
			if (!data?.template || !data.left) return;
			onUse(data.template.name, data.template.look, data.template.seconds, data.left, withStyle);
			onClose();
		}
	}
	async function rename() {
		if (!renaming) return;
		if (await send("PUT", { id: renaming.id, name: renaming.name })) setRenaming(null);
	}

	const full = cards !== null && cards.length >= limit;
	const question: Record<Asking["kind"], { title: (n: string) => string; body: string; action: string; danger?: boolean }> = {
		use: {
			title: (n) => `Use "${n}" on this video?`,
			body: withStyle
				? "It replaces this video's subtitle style, shape, logo, zoom, Banners, Frame Me and Layout. Your script, cuts and Cutout stay. You can undo it right after."
				: "It replaces this video's shape, zoom, Banners, Frame Me and Layout. Your subtitle style, logo, script, cuts and Cutout stay. You can undo it right after.",
			action: "Use template",
		},
		update: { title: (n) => `Update "${n}"?`, body: "The template takes this video's look in place of its own. Videos made with it before don't change.", action: "Update" },
		delete: { title: (n) => `Delete "${n}"?`, body: "The template goes. Videos made with it and your files stay.", action: "Delete", danger: true },
	};
	const action = "flex items-center gap-1 rounded-md border border-foreground/20 px-2 py-1 hover:bg-foreground/5 disabled:opacity-40";

	return createPortal(
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="presentation" onClick={onClose}>
			<div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Templates" onClick={(e) => e.stopPropagation()} className="flex max-h-[85vh] w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-xl border border-foreground/15 bg-background p-4 text-foreground shadow-2xl outline-none">
				<div className="flex items-start justify-between gap-3">
					<div className="flex flex-col gap-1">
						<h2 className="text-lg font-semibold">
							Templates {cards !== null && <span className="text-sm font-normal text-foreground/60">{cards.length} of {limit}</span>}
						</h2>
						<p className="text-xs text-foreground/60">
							Save how this video looks and put it on your next ones. Items that end in the last {TEMPLATE.tail} seconds stick to the end of the new video.
						</p>
					</div>
					<button onClick={onClose} aria-label="Close" className="rounded p-1 text-foreground/50 hover:bg-foreground/5 hover:text-foreground">
						<X className="h-4 w-4" aria-hidden />
					</button>
				</div>

				<form
					className="flex flex-col gap-1.5 rounded-lg border border-blue-600/40 bg-blue-600/5 p-3"
					onSubmit={(e) => {
						e.preventDefault();
						void save();
					}}
				>
					<span className="text-sm font-medium">Save this video as a template</span>
					<div className="flex flex-wrap gap-2">
						<input value={name} maxLength={TEMPLATE.maxName} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Weekly show" aria-label="Template name" className="min-w-0 flex-1 rounded-md border border-foreground/20 bg-background px-2 py-1 text-sm" />
						<button disabled={busy || cards === null || full} className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40">
							Save template
						</button>
					</div>
					<span className="text-xs text-foreground/60">{INCLUDES}</span>
					{full && <span className="text-xs text-foreground/60">{limit ? "No room for another: update or delete one below." : "Templates come with a paid plan."}</span>}
				</form>

				<div aria-live="polite" className="flex flex-col gap-1 empty:hidden">
					{note && <p className="text-xs text-(--ok)">{note}</p>}
					{error && <p className="text-xs text-red-500">{error}</p>}
				</div>

				{cards === null ? (
					!error && <p className="text-sm text-foreground/60">Loading your templates…</p>
				) : !cards.length ? (
					<p className="text-sm text-foreground/60">No templates yet. Set up a video the way you like it, then save it here.</p>
				) : (
					<ul className="grid gap-3 sm:grid-cols-2">
						{cards.map((c) => (
							<li key={c.id} className="flex flex-col gap-2 rounded-lg border border-foreground/15 p-3">
								{renaming?.id === c.id ? (
									<form
										className="flex gap-2"
										onSubmit={(e) => {
											e.preventDefault();
											void rename();
										}}
									>
										<input autoFocus value={renaming.name} maxLength={TEMPLATE.maxName} onChange={(e) => setRenaming({ id: c.id, name: e.target.value })} aria-label="New name" className="min-w-0 flex-1 rounded-md border border-foreground/20 bg-background px-2 py-1 text-sm" />
										<button disabled={busy} className="rounded-md bg-blue-600 px-2 py-1 text-sm text-white">Save</button>
										<button type="button" onClick={() => setRenaming(null)} className="text-sm text-foreground/60 hover:underline">
											Cancel
										</button>
									</form>
								) : (
									<p className="truncate font-medium" title={c.name}>
										{c.name}
									</p>
								)}
								<p className="text-xs text-foreground/60">{[c.shape, count(c.banners, "banner"), count(c.frames, "Frame Me", "Frame Me"), count(c.layouts, "layout")].filter(Boolean).join(" · ")}</p>
								<p className="text-[11px] text-foreground/50">Everything on it is included, except Cutout.</p>
								{c.locked && <p className="text-xs text-(--warn)">Over your plan&apos;s count. Upgrade to use it again.</p>}
								<div className="mt-auto flex flex-wrap gap-2 text-xs">
									<button onClick={() => { setWithStyle(true); setAsking({ kind: "use", card: c }); }} disabled={busy || c.locked} className="rounded-md bg-blue-600 px-3 py-1 font-medium text-white hover:bg-blue-700 disabled:opacity-40">
										Use
									</button>
									<button onClick={() => setAsking({ kind: "update", card: c })} disabled={busy || c.locked} title="Put this video's look into this template" className={action}>
										<RefreshCw className="h-3 w-3" aria-hidden /> Update
									</button>
									<button onClick={() => setRenaming({ id: c.id, name: c.name })} disabled={busy} className={action}>
										<Pencil className="h-3 w-3" aria-hidden /> Rename
									</button>
									<button onClick={() => setAsking({ kind: "delete", card: c })} disabled={busy} aria-label={`Delete ${c.name}`} title="Delete" className={`${action} ml-auto text-foreground/50 hover:text-red-600`}>
										<Trash2 className="h-3 w-3" aria-hidden />
									</button>
								</div>
							</li>
						))}
					</ul>
				)}
				{checkingTakes && <p className="text-xs text-(--warn)">Bad takes are still being checked. Use a template after that, so the items at the end land at the end.</p>}
				<p className="text-[11px] text-foreground/50">Use a template after your cuts are done. If you cut more afterwards, use it again to move the end items.</p>
			</div>
			{asking && (
				// Its own clicks stay its own: the question is drawn on the page, but React still hands them up to this box.
				<span onClick={(e) => e.stopPropagation()}>
					<Confirm title={question[asking.kind].title(asking.card.name)} body={question[asking.kind].body} action={question[asking.kind].action} danger={question[asking.kind].danger} onCancel={stopAsking} onConfirm={() => void confirmed(asking)}>
						{asking.kind === "use" && (
							<label className="flex items-start gap-2 text-sm">
								<input type="checkbox" checked={withStyle} onChange={(e) => setWithStyle(e.target.checked)} className="mt-0.5 accent-blue-600" />
								<span className="flex flex-col">
									Keep all same with logo
									<span className="text-[11px] text-foreground/60">Untick to keep this video&apos;s own subtitle style and logo.</span>
								</span>
							</label>
						)}
					</Confirm>
				</span>
			)}
		</div>,
		document.body,
	);
}
