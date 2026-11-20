"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { signInWithGoogle } from "@/components/Account";
import { keepPending } from "@/lib/pending-upload";
import { supabaseBrowser } from "@/lib/supabase/browser";

// The home page's own clips, all filmed by the coach (20 Nov: no AI-made pictures). They come through /api/home-video
// because iPhones and iPads need HTTP Range, which static files here don't answer. Each loads only when it comes
// near the screen and stops when it leaves, so the page stays light; reduced motion keeps the still picture.
export type HomeClip = "before" | "after" | "words" | "frame" | "cutout" | "layout" | "zoom" | "banner";

const still = (name: HomeClip) => `/landing/${name}-poster.webp`;

// Plays while on screen. play: what to do once it is on screen (the After clip starts with sound).
function useOnScreen(ref: React.RefObject<HTMLVideoElement | null>, name: HomeClip, play: (v: HTMLVideoElement) => void) {
	useEffect(() => {
		const v = ref.current;
		if (!v || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const seen = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting) {
					if (!v.src) v.src = `/api/home-video?name=${name}`;
					play(v);
				} else v.pause();
			},
			{ rootMargin: "200px" },
		);
		seen.observe(v);
		return () => seen.disconnect();
	}, [ref, name, play]);
}

const playMuted = (v: HTMLVideoElement) => {
	v.muted = true; // as a property too: iPhones check it before they allow autoplay
	v.play().catch(() => {});
};

// A silent clip that loops.
export function LoopVideo({ name, className, poster = true }: { name: Exclude<HomeClip, "cutout">; className?: string; poster?: boolean }) {
	const ref = useRef<HTMLVideoElement>(null);
	useOnScreen(ref, name, playMuted);
	return <video ref={ref} className={className} poster={poster ? still(name) : undefined} muted loop playsInline preload="none" aria-hidden />;
}

// The After clip, with its sound (coach 20 Nov). Browsers only allow sound after someone has touched the page, so
// it starts silent if it must, and the first tap anywhere (or the button) turns the sound on.
export function AfterVideo() {
	const ref = useRef<HTMLVideoElement>(null);
	const [muted, setMuted] = useState(true);
	const chose = useRef(false); // they pressed the sound button: leave it as they set it

	const start = useCallback((v: HTMLVideoElement) => {
		v.muted = chose.current ? v.muted : false;
		v.play()
			.then(() => setMuted(v.muted))
			.catch(() => {
				v.muted = true;
				setMuted(true);
				v.play().catch(() => {});
			});
	}, []);
	useOnScreen(ref, "after", start);

	useEffect(() => {
		const unmute = () => {
			const v = ref.current;
			if (!v || chose.current || !v.muted || v.paused) return;
			v.muted = false;
			setMuted(false);
		};
		window.addEventListener("pointerdown", unmute, { once: true });
		window.addEventListener("keydown", unmute, { once: true });
		return () => {
			window.removeEventListener("pointerdown", unmute);
			window.removeEventListener("keydown", unmute);
		};
	}, []);

	return (
		<>
			<video ref={ref} poster={still("after")} loop playsInline preload="none" muted />
			<button
				type="button"
				className="k-sound"
				aria-label={muted ? "Turn the sound on" : "Turn the sound off"}
				onClick={() => {
					const v = ref.current;
					if (!v) return;
					chose.current = true;
					v.muted = !v.muted;
					setMuted(v.muted);
					if (v.paused) v.play().catch(() => {});
				}}
			>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
					<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
					{muted ? <path d="M17 9l5 6M22 9l-5 6" /> : <path d="M17 8.5a5 5 0 0 1 0 7M19.5 6a8.5 8.5 0 0 1 0 12" />}
				</svg>
				{muted ? "Sound on" : "Sound off"}
			</button>
		</>
	);
}

// Cutout: the clip holds the picture on top and the person's matte below (made with MODNet, the model behind Cutout
// Balanced), so here the person is drawn without the room, over whatever sits behind the canvas.
export function CutoutVideo({ className }: { className?: string }) {
	const ref = useRef<HTMLVideoElement>(null);
	const canvas = useRef<HTMLCanvasElement>(null);
	const [drawn, setDrawn] = useState(false); // till then (and with reduced motion) the still cut-out picture shows
	useOnScreen(ref, "cutout", playMuted);

	useEffect(() => {
		const v = ref.current;
		const out = canvas.current?.getContext("2d");
		if (!v || !out) return;
		const work = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
		if (!work) return;
		let stop = false;
		const draw = () => {
			const w = v.videoWidth;
			const h = v.videoHeight / 2;
			if (!w || !h) return;
			if (work.canvas.width !== w) [work.canvas.width, work.canvas.height, out.canvas.width, out.canvas.height] = [w, h * 2, w, h];
			work.drawImage(v, 0, 0);
			const all = work.getImageData(0, 0, w, h * 2).data;
			const pic = new ImageData(w, h);
			const n = w * h * 4;
			for (let i = 0; i < n; i += 4) {
				pic.data[i] = all[i];
				pic.data[i + 1] = all[i + 1];
				pic.data[i + 2] = all[i + 2];
				pic.data[i + 3] = all[n + i];
			}
			out.putImageData(pic, 0, 0);
			setDrawn(true);
		};
		type Frames = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
		const fv = v as Frames;
		const loop = () => {
			if (stop) return;
			if (!v.paused) draw();
			if (fv.requestVideoFrameCallback) fv.requestVideoFrameCallback(loop);
			else requestAnimationFrame(loop);
		};
		const first = () => draw();
		v.addEventListener("loadeddata", first);
		v.addEventListener("play", loop, { once: true });
		return () => {
			stop = true;
			v.removeEventListener("loadeddata", first);
		};
	}, []);

	return (
		<>
			<video ref={ref} muted loop playsInline preload="none" style={{ display: "none" }} />
			<canvas ref={canvas} className={className} aria-hidden />
			{!drawn && <Image className={className} src={still("cutout")} alt="" width={480} height={854} unoptimized />}
		</>
	);
}

// The left of the banner: drop a video to try it (coach 20 Nov). It is kept in this browser while Google signs the
// person in, then the upload page takes it (lib/pending-upload.ts). Already signed in: straight there.
export function HeroDrop() {
	const [dragging, setDragging] = useState(false);
	const [busy, setBusy] = useState(false);
	const router = useRouter();

	const take = async (file: File | undefined) => {
		if (!file || busy) return;
		setBusy(true);
		await keepPending(file);
		const { data } = await supabaseBrowser().auth.getUser();
		if (data.user) router.push("/upload?pending=1");
		else void signInWithGoogle("/upload?pending=1");
	};

	return (
		<label
			className={`k-drop ${dragging ? "k-drop-on" : ""}`}
			onDragOver={(e) => {
				e.preventDefault();
				setDragging(true);
			}}
			onDragLeave={() => setDragging(false)}
			onDrop={(e) => {
				e.preventDefault();
				setDragging(false);
				void take(e.dataTransfer.files[0]);
			}}
		>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
				<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
			</svg>
			<span className="k-droptitle">{busy ? "Opening Google sign-in…" : dragging ? "Release to try it" : "Drop your video here"}</span>
			<span className="k-dropnote">or click to choose a file · MP4 or MOV · then sign in with Google</span>
			<input
				type="file"
				accept="video/mp4,video/quicktime"
				disabled={busy}
				onChange={(e) => {
					void take(e.target.files?.[0]);
					e.target.value = "";
				}}
			/>
		</label>
	);
}
