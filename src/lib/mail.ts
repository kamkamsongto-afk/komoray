import { getCloudflareContext } from "@opennextjs/cloudflare";

// Email we send ourselves (not Supabase's sign-in mail), through Brevo's API: komoray.com's domain is verified there,
// with DKIM and SPF (PROGRESS.md, Email). The key is a Worker secret, BREVO_API_KEY (.dev.vars on this computer).
// No key: nothing is sent and the caller says so, so the rest still works.
type MailEnv = { BREVO_API_KEY?: string };
export type MailResult = "sent" | "not set up" | "failed";

const FROM = { name: "Komoray", email: "hello@komoray.com" };

export async function sendMail(to: string, subject: string, text: string, html: string): Promise<MailResult> {
	const key = (getCloudflareContext().env as unknown as MailEnv).BREVO_API_KEY;
	if (!key) return "not set up";
	const res = await fetch("https://api.brevo.com/v3/smtp/email", {
		method: "POST",
		headers: { "api-key": key, "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify({ sender: FROM, replyTo: FROM, to: [{ email: to }], subject, textContent: text, htmlContent: html }),
	}).catch(() => null);
	if (!res?.ok) console.error("mail failed:", res?.status, await res?.text().catch(() => ""));
	return res?.ok ? "sent" : "failed";
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// The admin pressed Add email (or Invite on the early access list): tell them they can start.
export function inviteMail(email: string, site: string, minutes: number, perVideo: number) {
	const link = `${site}/upload`;
	const subject = "You're in: your Komoray invite";
	const lines = [
		"Hi,",
		"",
		"Your spot in the Komoray beta is ready.",
		"",
		`Sign in with Google using this email (${email}) and upload your first video:`,
		link,
		"",
		`During the beta you have ${minutes} minutes to try, up to ${perVideo} minutes per video.`,
		"Questions or something not working? Just reply to this email.",
		"",
		"You shoot. Komoray makes you shine.",
		"The Komoray team",
	];
	const html = `<div style="font-family:sans-serif;font-size:16px;line-height:1.5;color:#111">
<p>Hi,</p>
<p>Your spot in the Komoray beta is ready.</p>
<p>Sign in with Google using this email (<b>${escape(email)}</b>) and upload your first video:</p>
<p><a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Upload a video</a></p>
<p>During the beta you have ${minutes} minutes to try, up to ${perVideo} minutes per video.<br>Questions or something not working? Just reply to this email.</p>
<p>You shoot. Komoray makes you shine.<br>The Komoray team</p>
</div>`;
	return { subject, text: lines.join("\n"), html };
}
