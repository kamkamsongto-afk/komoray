// newmm for the browser, loaded only when a video has Thai typed into it (its dictionary is ~310 KB zipped): fixed Thai
// becomes words in the subtitles there too, cut the same way as the render and translate routes cut it (lib/edit.ts).
import { useEffect, useState } from "react";
import type { ThaiCut } from "./edit";

const THAI = /[฀-๿]/;
let loaded: ThaiCut | null = null;
let loading: Promise<ThaiCut> | null = null;

export function loadThaiCut(): Promise<ThaiCut> {
	loading ??= import("./newmm").then((m) => (loaded = m.cutThaiWords));
	return loading;
}

// Whether any fix has Thai in it: only then is newmm worth loading.
export const fixesNeedThaiCut = (fixes: { text: string }[] | undefined) => Boolean(fixes?.some((f) => THAI.test(f.text)));

// The cutter once loaded, else undefined (the fix stays one word until then, as before).
export function useThaiCut(needed: boolean): ThaiCut | undefined {
	// () => loaded, never useState(loaded): given a function, React CALLS it to get the first value, so once the cutter was
	// loaded (a second video opened from My projects) the state became cutThaiWords(undefined) = [] and the AI studio
	// crashed with "r is not a function" (coach 18 Nov, docs/bugs.md).
	const [cut, setCut] = useState<ThaiCut | null>(() => loaded);
	useEffect(() => {
		if (!needed || cut) return;
		let gone = false;
		void loadThaiCut().then((c) => !gone && setCut(() => c));
		return () => {
			gone = true;
		};
	}, [needed, cut]);
	return cut ?? undefined;
}
