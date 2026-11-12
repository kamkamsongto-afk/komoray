"use client";

import { ArrowDown, ArrowUp, MapPin } from "lucide-react";

type Props = {
	onMoveHere: () => void; // start it where the blue line on the timeline is, same length
	onUp?: () => void; // left out: this kind has no layers to swap
	onDown?: () => void;
	place?: { at: number; of: number } | null; // its layer among the things showing with it
};

// Under an open banner, picture, clip or text: put it where the video is now (coach, 12 Nov: a new one seemed to
// land at the start and people pressed again and again), and move it over or under the ones showing with it.
export function LayerTools({ onMoveHere, onUp, onDown, place }: Props) {
	const button = "inline-flex items-center gap-1 rounded-md border border-foreground/20 px-1.5 py-0.5 hover:bg-foreground/5 disabled:opacity-30";
	return (
		<div className="flex flex-wrap items-center gap-1.5 text-xs text-foreground/70">
			<button onClick={onMoveHere} title="Start it where the blue line on the timeline is now. It keeps its length." className={button}>
				<MapPin className="h-3 w-3" aria-hidden /> Move here
			</button>
			{onUp && onDown && (
				<>
					<span className="ml-auto">{place ? `Layer ${place.at} of ${place.of}` : "Layer"}</span>
					<button onClick={onUp} disabled={!place || place.at === place.of} title={place ? "Bring it in front of the one over it" : "Nothing else shows at the same time"} aria-label="Bring forward" className={button}>
						<ArrowUp className="h-3 w-3" aria-hidden />
					</button>
					<button onClick={onDown} disabled={!place || place.at === 1} title={place ? "Send it behind the one under it" : "Nothing else shows at the same time"} aria-label="Send backward" className={button}>
						<ArrowDown className="h-3 w-3" aria-hidden />
					</button>
				</>
			)}
		</div>
	);
}
