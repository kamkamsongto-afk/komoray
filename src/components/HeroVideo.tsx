"use client";

import { useEffect, useRef, useState } from "react";

// The manta rays behind the home page's banner. The picture shows first; the video fades in once it really
// plays, so a phone that refuses to autoplay, or someone who asked for less motion, keeps the still picture.
// The file comes through /api/hero-video because iPhones and iPads need HTTP Range, which static files here don't answer.
export function HeroVideo() {
	const video = useRef<HTMLVideoElement>(null);
	const [playing, setPlaying] = useState(false);

	useEffect(() => {
		const element = video.current;
		if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		element.muted = true; // as a property too: iPhones check it before they allow autoplay
		element.src = `/api/hero-video?size=${window.matchMedia("(max-width: 680px)").matches ? "small" : "large"}`;
		element.play().catch(() => {});
	}, []);

	return <video ref={video} className={`k-video ${playing ? "k-video-on" : ""}`} muted loop playsInline preload="auto" onPlaying={() => setPlaying(true)} />;
}
