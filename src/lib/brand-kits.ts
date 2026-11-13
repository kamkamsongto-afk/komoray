import { getJson } from "./r2";
import { readStyle, type SubtitleStyle } from "./subtitle-style";

// Brand Kits (api/brand): several named subtitle looks, one starred as what new videos start with. A file from before
// 13 Nov held one look ({ style }); it reads as one kit called "My brand", so nobody loses theirs.
export type BrandKit = { id: string; name: string; style: SubtitleStyle };
export type BrandFile = { kits: BrandKit[]; defaultId: string | null };
export const MAX_KITS = 20;
export const MAX_KIT_NAME = 40;
export const kitId = () => crypto.randomUUID().slice(0, 8);
const KIT_ID = /^[a-z0-9-]{1,40}$/;
export const isKitId = (id: unknown): id is string => typeof id === "string" && KIT_ID.test(id);

export async function readKits(key: string): Promise<BrandFile> {
	const saved = await getJson<{ style?: unknown; kits?: unknown; defaultId?: unknown }>(key);
	if (Array.isArray(saved?.kits)) {
		const kits = (saved.kits as Partial<BrandKit>[])
			.filter((k) => isKitId(k?.id) && typeof k.name === "string" && k.style)
			.slice(0, MAX_KITS)
			.map((k) => ({ id: k.id!, name: k.name!.slice(0, MAX_KIT_NAME), style: readStyle(k.style) }));
		const defaultId = kits.some((k) => k.id === saved.defaultId) ? (saved.defaultId as string) : (kits[0]?.id ?? null);
		return { kits, defaultId };
	}
	if (saved?.style) return { kits: [{ id: "main", name: "My brand", style: readStyle(saved.style) }], defaultId: "main" };
	return { kits: [], defaultId: null };
}
