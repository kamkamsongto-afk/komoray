"use client";

import { useEffect, useState } from "react";
import { projectFileSrc } from "./media-library";

// How long each project clip is, for Trim (coach 19 Nov): a trim stops at the clip's real end. Read once per file from
// its header only (preload "metadata", a few KB), then kept for the page, so dragging never waits on it.
const lengths = new Map<string, Promise<number | null>>();

function lengthOf(file: string): Promise<number | null> {
	let known = lengths.get(file);
	if (!known) {
		known = new Promise((resolve) => {
			const video = document.createElement("video");
			const done = (seconds: number | null) => {
				video.removeAttribute("src");
				video.load();
				resolve(seconds);
			};
			video.preload = "metadata";
			video.muted = true;
			video.onloadedmetadata = () => done(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null);
			video.onerror = () => done(null);
			video.src = projectFileSrc(file);
		});
		lengths.set(file, known);
	}
	return known;
}

// The lengths of these clips, seconds, by file name: a file not read yet (or unreadable) is missing, and a trim then
// only stops at the clip's start.
export function useClipLengths(files: string[]): Record<string, number> {
	const [found, setFound] = useState<Record<string, number>>({});
	const wanted = [...new Set(files)].sort().join("\n");
	useEffect(() => {
		let gone = false;
		for (const file of wanted ? wanted.split("\n") : []) {
			void lengthOf(file).then((seconds) => {
				if (!gone && seconds) setFound((was) => (was[file] === seconds ? was : { ...was, [file]: seconds }));
			});
		}
		return () => {
			gone = true;
		};
	}, [wanted]);
	return found;
}
