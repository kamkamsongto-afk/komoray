// The storage reminder emails (Terms "Storage"; coach 18 Nov: no discount for now, invite them back and say what's new).
// Sent by the daily clean-up (lib/storage-cleanup.ts) through Brevo (lib/mail.ts), once per stage:
// - a plan that ended: when the 20-day countdown starts, and again 7 days before;
// - Free, not opened for a while: 7 days before.

// What's new, for the "come back" part. Only things that are on komoray.com for everyone today: add here as they ship.
export const WHATS_NEW = [
	"Folders in My projects, and Duplicate to make another version of a video in one click",
	"Layout: split the screen with a picture or clip, with slide and flash transitions",
	"Frame Me: you inside a circle, heart, star or other shape, over a blurred or picture background",
	"Several Brand Kits, each with its own logo",
];

export type StorageMailKind = "plan ended" | "plan ended, 7 days" | "not used";

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });

export function storageMail(kind: StorageMailKind, due: string, site: string) {
	const date = day(due);
	const keep = kind === "not used" ? `${site}/projects` : `${site}/pricing`;
	const subject =
		kind === "not used" ? `Your Komoray videos will be cleared on ${date}` : kind === "plan ended" ? `Your Komoray videos will be deleted on ${date}` : `7 days left: your Komoray videos go on ${date}`;
	const lead =
		kind === "not used"
			? [`You haven't opened Komoray for a while, so on ${date} we'll clear the videos in your Free storage.`, "To keep them, just open Komoray before then. Your account, your words and your Brand Kit stay either way."]
			: [
					`Your Komoray plan has ended, and we've kept your videos for you. On ${date} they will be deleted.`,
					"Start a plan again before then and everything stays, just as you left it. Or download what you want to keep from My projects. Your account, your words and your Brand Kit stay either way.",
				];
	const button = kind === "not used" ? "Open My projects" : "Keep my videos";
	const text = [
		"Hi,",
		"",
		...lead.flatMap((line) => [line, ""]),
		`${button}: ${keep}`,
		"",
		"New in Komoray:",
		...WHATS_NEW.map((item) => `- ${item}`),
		"",
		"Questions? Just reply to this email.",
		"",
		"You shoot. Komoray makes you shine.",
		"The Komoray team",
	].join("\n");
	const html = `<div style="font-family:sans-serif;font-size:16px;line-height:1.5;color:#111">
<p>Hi,</p>
${lead.map((line) => `<p>${escape(line)}</p>`).join("\n")}
<p><a href="${keep}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${button}</a></p>
<p style="margin-bottom:4px"><b>New in Komoray:</b></p>
<ul style="margin-top:0">${WHATS_NEW.map((item) => `<li>${escape(item)}</li>`).join("")}</ul>
<p>Questions? Just reply to this email.</p>
<p>You shoot. Komoray makes you shine.<br>The Komoray team</p>
</div>`;
	return { subject, text, html };
}
