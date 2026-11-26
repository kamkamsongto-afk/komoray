import { getJson, listObjects } from "./r2";
import { readLook, type Template } from "./templates";

// Where templates are kept in R2 (server only): one file each, no shared list file.
export const templatesPrefix = (userId: string) => `templates/${userId}/`;
export const templateKey = (userId: string, id: string) => `${templatesPrefix(userId)}${id}.json`;

// Every file as kept, unchecked: for counting which My files they point at (lib/my-files-usage.ts). A failed read throws.
export async function rawTemplatesOf(userId: string) {
	const keys = (await listObjects(templatesPrefix(userId))).map((o) => o.key).filter((k) => k.endsWith(".json"));
	const found = await Promise.all(keys.map((k) => getJson<Template>(k)));
	return found.filter((t): t is Template => !!t);
}

// Their templates, checked, oldest first (the order the plan's count goes by). A failed read throws.
export async function templatesOf(userId: string): Promise<Template[]> {
	return (await rawTemplatesOf(userId))
		.flatMap((t) => {
			const look = readLook(t.look);
			return look && typeof t.id === "string" ? [{ ...t, look }] : [];
		})
		.sort((a, b) => a.at.localeCompare(b.at));
}
