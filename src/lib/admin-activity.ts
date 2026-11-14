// One row per person for the admin's Activity tab: how far each beta user got. Works from what is already in
// R2, so it adds nothing to the normal work of the site. Only videos still there are counted: uploads/ deletes
// itself after 14 days, which is why the numbers can go down.
export const OWNER_FILE = "owner.json"; // uploads/<id>/owner.json: { email }, written when the video becomes someone's

export type FolderFile = { name: string; lastModified: string };
export type VideoFacts = { email: string | null; files: FolderFile[]; words: number; fixed: number };

export type Activity = {
	email: string | null; // null: videos from before owners were written down
	videos: number;
	listened: number;
	listenFailed: number;
	made: number;
	madeFailed: number;
	words: number;
	fixed: number;
	lastActive: string | null;
};

const has = (files: FolderFile[], name: string) => files.some((file) => file.name === name);
// The video they sent, not one made by us (same rule as the Videos tab in api/admin/jobs).
export const isUpload = (file: FolderFile) => /\.(mp4|mov)$/i.test(file.name) && !["final.mp4", "proxy.mp4", "part.mp4"].includes(file.name) && !file.name.includes("-before.");

function emptyRow(email: string | null): Activity {
	return { email, videos: 0, listened: 0, listenFailed: 0, made: 0, madeFailed: 0, words: 0, fixed: 0, lastActive: null };
}

// How many words a video's fixes cover. A fix replaces its words from..to with new text.
export function wordsFixed(fixes: unknown) {
	if (!Array.isArray(fixes)) return 0;
	return fixes.reduce((sum: number, fix: { from?: unknown; to?: unknown }) => {
		const { from, to } = fix ?? {};
		return typeof from === "number" && typeof to === "number" && to >= from ? sum + to - from + 1 : sum;
	}, 0);
}

// Everyone invited gets a row, even with no videos: "invited but never started" is what we most want to see.
export function summarize(invited: string[], videos: VideoFacts[]): Activity[] {
	const rows = new Map<string | null, Activity>(invited.map((email) => [email, emptyRow(email)]));
	for (const video of videos) {
		if (!video.files.some(isUpload)) continue; // the upload never finished
		if (!rows.has(video.email)) rows.set(video.email, emptyRow(video.email));
		const row = rows.get(video.email)!;
		row.videos += 1;
		if (has(video.files, "analyze-error.json")) row.listenFailed += 1;
		else if (has(video.files, "edit.json")) row.listened += 1;
		if (has(video.files, "render-error.json")) row.madeFailed += 1;
		else if (has(video.files, "final.mp4")) row.made += 1;
		row.words += video.words;
		row.fixed += video.fixed;
		for (const file of video.files) {
			if (!row.lastActive || file.lastModified > row.lastActive) row.lastActive = file.lastModified;
		}
	}
	return [...rows.values()].sort((a, b) => {
		if (a.email === null) return 1;
		if (b.email === null) return -1;
		return (b.lastActive ?? "").localeCompare(a.lastActive ?? "") || a.email.localeCompare(b.email);
	});
}
