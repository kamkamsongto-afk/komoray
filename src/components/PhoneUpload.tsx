"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

const POLL_MS = 2500;

type Link = { id: string; link: string; expires: number; qr: string };

// Upload page, on a computer: a QR code the phone scans to send a video without signing in there
// (see /api/phone). When the video has arrived it becomes this user's project and onArrived runs.
export function PhoneUpload({ onArrived, disabled }: { onArrived: (key: string, filename: string) => void; disabled?: boolean }) {
	const [link, setLink] = useState<Link | null>(null);
	const [state, setState] = useState<"waiting" | "uploading" | "expired" | "error">("waiting");
	const [error, setError] = useState("");

	async function create() {
		setError("");
		setState("waiting");
		const res = await fetch("/api/phone", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create" }) }).catch(
			() => null,
		);
		const data = (await res?.json().catch(() => ({}))) as Partial<Link> & { error?: string };
		if (!res?.ok || !data.link || !data.id) return setError(data?.error ?? "Could not make a QR code. Please try again.");
		const qr = await QRCode.toDataURL(data.link, { margin: 1, width: 240 });
		setLink({ id: data.id, link: data.link, expires: data.expires!, qr });
	}

	// Ask every few seconds whether the phone has sent the video.
	useEffect(() => {
		if (!link) return;
		let stopped = false;
		const timer = setInterval(async () => {
			const res = await fetch("/api/phone", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "claim", id: link.id }) }).catch(
				() => null,
			);
			const data = (await res?.json().catch(() => ({}))) as { status?: string; key?: string; filename?: string; error?: string };
			if (stopped || !res) return;
			if (!res.ok) {
				setState("error");
				setError(data.error ?? "Something went wrong");
				return clearInterval(timer);
			}
			if (data.status === "claimed" && data.key) {
				clearInterval(timer);
				setLink(null);
				onArrived(data.key, data.filename ?? data.key.split("/").pop()!);
			} else if (data.status === "expired") {
				clearInterval(timer);
				setState("expired");
			} else if (data.status === "uploading") setState("uploading");
		}, POLL_MS);
		return () => {
			stopped = true;
			clearInterval(timer);
		};
	}, [link, onArrived]);

	if (!link) {
		return (
			<div className="flex flex-col items-center gap-1">
				<button
					onClick={() => void create()}
					disabled={disabled}
					className="rounded-lg border border-foreground/20 px-4 py-2 text-sm hover:bg-foreground/5 disabled:opacity-50"
				>
					📱 Upload from your phone
				</button>
				{error && <p className="text-sm text-red-500">❌ {error}</p>}
			</div>
		);
	}

	return (
		<div className="flex flex-col items-center gap-3 rounded-2xl border border-foreground/15 p-6 text-center">
			{state === "expired" ? (
				<>
					<p className="text-foreground/70">This QR code has expired.</p>
					<button onClick={() => void create()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
						Make a new QR code
					</button>
				</>
			) : (
				<>
					{/* eslint-disable-next-line @next/next/no-img-element -- a data: URL made right here */}
					<img src={link.qr} alt="QR code to upload from your phone" width={240} height={240} className="rounded-lg bg-white p-2" />
					<p className="text-sm text-foreground/70">
						{state === "uploading"
							? "📲 Your phone is sending the video… this page continues by itself."
							: "Scan with your phone's camera, then pick a video. No need to sign in on the phone. The code works for 15 minutes."}
					</p>
					{state === "error" && <p className="text-sm text-red-500">❌ {error}</p>}
					<button onClick={() => setLink(null)} className="text-sm text-foreground/60 underline hover:text-foreground">
						Cancel
					</button>
				</>
			)}
		</div>
	);
}
