"use client";

import { useEffect, useRef } from "react";

// A name on one line that, only when it is too long for its place, stays still for a few seconds, then slides slowly to
// the left until its end shows, rests there and starts again (coach 25 Nov). With reduced motion it stays still; the
// whole name also shows when the mouse rests on it.
const WAIT = 3; // seconds still before it moves
const SPEED = 30; // px a second
const REST = 1.5; // seconds its end stays before it jumps back

export function ScrollName({ text }: { text: string }) {
	const outer = useRef<HTMLSpanElement>(null);
	const inner = useRef<HTMLSpanElement>(null);
	useEffect(() => {
		const place = outer.current;
		const name = inner.current;
		if (!place || !name || typeof name.animate !== "function") return;
		let moving: Animation | undefined;
		const start = () => {
			moving?.cancel();
			const over = name.offsetWidth - place.clientWidth;
			if (over <= 1 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
			const slide = over / SPEED;
			const total = WAIT + slide + REST;
			moving = name.animate(
				[
					{ transform: "translateX(0)", offset: 0 },
					{ transform: "translateX(0)", offset: WAIT / total },
					{ transform: `translateX(${-over}px)`, offset: (WAIT + slide) / total },
					{ transform: `translateX(${-over}px)`, offset: 1 },
				],
				{ duration: total * 1000, iterations: Infinity },
			);
		};
		// Measured again whenever its place changes width (the box resized, the web font arriving).
		const watch = new ResizeObserver(start);
		watch.observe(place);
		watch.observe(name);
		return () => {
			watch.disconnect();
			moving?.cancel();
		};
	}, [text]);
	return (
		<span ref={outer} title={text} className="block min-w-0 flex-1 overflow-hidden">
			<span ref={inner} className="inline-block whitespace-nowrap">
				{text}
			</span>
		</span>
	);
}
