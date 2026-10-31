"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { createDebugLog, type DebugLog } from "@/lib/debug-log";
import { StudioEngine, type StudioMedia } from "@/lib/player/engine";
import { focusFor, framePiece } from "@/lib/framing";
import { FPS, zoomOf } from "@/lib/timeline";
import { PlayerFrame } from "./PlayerFrame";
import { type PreviewHandle, type PreviewProps, toPieces } from "./PreviewPlayer";

export type { StudioMedia };

type Props = Omit<PreviewProps, "src"> & {
	media: StudioMedia;
	onFail: (error: Error) => void; // can't play here: the page switches to the <video> player
};

const SAMPLE_MS = 250; // debug mode: how often the engine's state is written down

// The final video, played by our own engine (lib/player/engine.ts) on a canvas: smooth cuts on
// every browser, including Safari on iPhone, iPad and Mac. Same controls and subtitles as PreviewPlayer.
export const StudioPlayer = forwardRef<PreviewHandle, Props>(function StudioPlayer(
	{ media, segments, lines, subtitle, onSubtitleChange, onTime, onPlayingChange, onFail, banners, faces },
	ref,
) {
	const pieces = useMemo(() => toPieces(segments), [segments]);
	const last = pieces[pieces.length - 1];
	const total = last ? last.out + last.end - last.start : 0;
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const engineRef = useRef<StudioEngine | null>(null);
	const debugRef = useRef<DebugLog | null>(null);
	const startAt = useRef(0); // a jump asked for before the engine was ready (source seconds)
	const [loaded, setLoaded] = useState(false);
	const [playing, setPlaying] = useState(false);
	const [busy, setBusy] = useState(false);
	const [outTime, setOutTime] = useState(0);
	const [debugCount, setDebugCount] = useState<number | null>(null);
	// Keep the latest callbacks without restarting the engine when they change.
	const piecesRef = useRef(pieces);
	const onTimeRef = useRef(onTime);
	const onFailRef = useRef(onFail);
	useEffect(() => {
		onTimeRef.current = onTime;
		onFailRef.current = onFail;
	});

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const debug = createDebugLog({ engine: "studio", pieces: piecesRef.current.length });
		debugRef.current = debug.on ? debug : null;
		let failed = false;
		const engine = new StudioEngine(media, canvas, {
			onTime: (out) => {
				setOutTime(out);
				onTimeRef.current(engine.toSource(out));
			},
			onState: (s) => {
				setPlaying(s.playing);
				setBusy(s.busy);
			},
			onError: (error) => {
				if (failed) return;
				failed = true;
				debug.log("error", { message: error.message });
				debug.send("error");
				onFailRef.current(error);
			},
			log: (what, detail) => debug.log(what, detail),
		});
		engineRef.current = engine;
		engine
			.load(piecesRef.current, engine.toOut(startAt.current, piecesRef.current))
			.then(() => setLoaded(true))
			.catch((error: Error) => {
				debug.log("loadFailed", { message: error.message });
				debug.send("loadFailed");
				onFailRef.current(error);
			});
		const sampler = debug.on
			? setInterval(() => {
					debug.log("sample", engine.stats());
					setDebugCount(debug.count());
				}, SAMPLE_MS)
			: undefined;
		return () => {
			clearInterval(sampler);
			engine.destroy();
			engineRef.current = null;
			debug.close();
		};
		// media is the key of this component (ScriptView), so it never changes here
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Words deleted or restored.
	useEffect(() => {
		if (piecesRef.current === pieces) return;
		piecesRef.current = pieces;
		if (loaded) engineRef.current?.setPieces(pieces);
	}, [pieces, loaded]);

	useEffect(() => onPlayingChange(playing), [playing, onPlayingChange]);

	// Face crop and Auto zoom are drawn by the engine, frame by frame, so they change exactly at each cut.
	const focuses = useMemo(() => pieces.map((p) => focusFor(faces ?? null, p.start, p.end)), [pieces, faces]);
	useEffect(
		() => engineRef.current?.setFraming((piece, aspect) => framePiece(aspect, focuses[piece] ?? null, zoomOf(piece, subtitle.zoom))),
		[focuses, subtitle.zoom, loaded],
	);

	useImperativeHandle(
		ref,
		() => ({
			seek: (source: number) => {
				const engine = engineRef.current;
				if (!engine || !loaded) {
					startAt.current = source;
					return;
				}
				engine.seek(engine.toOut(source));
			},
			play: () => engineRef.current?.play(),
			pause: () => engineRef.current?.pause(),
		}),
		[loaded],
	);

	const line = lines.find((l) => outTime * FPS >= l.from && outTime * FPS < l.to);
	const toggle = () => {
		const engine = engineRef.current;
		if (!engine || !loaded) return;
		debugRef.current?.send(playing ? "userPause" : "userPlay");
		if (playing) engine.pause();
		else engine.play();
	};

	return (
		<PlayerFrame
			playing={playing}
			outTime={outTime}
			total={total}
			line={line ?? null}
			banners={banners}
			subtitle={subtitle}
			onSubtitleChange={onSubtitleChange}
			onToggle={toggle}
			onScrub={(out) => engineRef.current?.seek(out)}
			debugCount={debugCount}
			busy={!loaded || busy}
		>
			<canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
		</PlayerFrame>
	);
});
