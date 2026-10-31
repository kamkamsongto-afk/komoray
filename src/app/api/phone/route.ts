import { getCloudflareContext } from "@opennextjs/cloudflare";
import { hmac, verifyCallback } from "@/lib/callback";
import { exists, getJson, putObject, signedUrl } from "@/lib/r2";
import { currentUser } from "@/lib/supabase/server";

// Upload from a phone without signing in there. The computer (signed in) makes a link with a
// QR code; the phone can put one video into one new folder with it, for 15 minutes; then the
// computer claims the video as its own project. The link never gives the phone access to anything else.
//   POST { action: "create" }                                  computer → { link, id }
//   POST { action: "upload", t, filename, contentType, size }  phone    → { uploadUrl }
//   POST { action: "uploaded", t }                             phone    → { ok }
//   POST { action: "claim", id }                               computer → { status, key? }
// What happened so far is kept in uploads/<id>/phone.json (deleted with the folder after 14 days).

const LINK_MINUTES = 15;
const ALLOWED_TYPES = ["video/mp4", "video/quicktime"]; // same as /api/upload-url
const MAX_SIZE = 500 * 1024 * 1024;
const UPLOAD_LINK_SECONDS = 3600; // a big file over mobile data can take a while

type Handoff = {
	userId: string;
	expires: number; // ms
	status: "waiting" | "uploading" | "done" | "claimed";
	key?: string;
	filename?: string;
	size?: number;
};

const handoffKey = (id: string) => `uploads/${id}/phone.json`;
const secret = () => (getCloudflareContext().env as unknown as { RENDER_TOKEN: string }).RENDER_TOKEN;

// t = <folder id>.<expiry ms>.<signature>
async function readToken(t: unknown) {
	const [id, expires, sig] = typeof t === "string" ? t.split(".") : [];
	if (!id || !/^[0-9a-f-]{36}$/.test(id) || !expires || !sig) return null;
	if (Number(expires) < Date.now()) return null;
	if (!(await verifyCallback(`phone:${id}.${expires}`, sig, secret()))) return null;
	return id;
}

export async function POST(request: Request) {
	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

	if (body.action === "create") {
		const { user } = await currentUser();
		if (!user) return Response.json({ error: "Please sign in first" }, { status: 401 });
		const id = crypto.randomUUID();
		const expires = Date.now() + LINK_MINUTES * 60 * 1000;
		const handoff: Handoff = { userId: user.id, expires, status: "waiting" };
		await putObject(handoffKey(id), JSON.stringify(handoff), "application/json");
		const t = `${id}.${expires}.${await hmac(secret(), `phone:${id}.${expires}`)}`;
		return Response.json({ id, link: new URL(`/phone?t=${t}`, request.url).toString(), expires });
	}

	if (body.action === "upload" || body.action === "uploaded") {
		const id = await readToken(body.t);
		if (!id) return Response.json({ error: "This QR code has expired. Make a new one on your computer." }, { status: 403 });
		const handoff = await getJson<Handoff>(handoffKey(id));
		if (!handoff || handoff.status === "claimed" || handoff.status === "done") {
			return Response.json({ error: "This QR code was already used. Make a new one on your computer." }, { status: 409 });
		}

		if (body.action === "upload") {
			const contentType = String(body.contentType ?? "");
			const size = Number(body.size);
			if (!ALLOWED_TYPES.includes(contentType)) return Response.json({ error: "Only .mp4 and .mov videos are allowed" }, { status: 400 });
			if (!size || size > MAX_SIZE) return Response.json({ error: "File must be 500 MB or smaller" }, { status: 400 });
			const filename = String(body.filename ?? "video");
			const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100) || "video";
			const key = `uploads/${id}/${safeName}`;
			await putObject(handoffKey(id), JSON.stringify({ ...handoff, status: "uploading", key, filename, size }), "application/json");
			return Response.json({ uploadUrl: await signedUrl(key, "PUT", UPLOAD_LINK_SECONDS, contentType) });
		}

		if (!handoff.key || !(await exists(handoff.key))) return Response.json({ error: "The video did not arrive. Please try again." }, { status: 400 });
		await putObject(handoffKey(id), JSON.stringify({ ...handoff, status: "done" }), "application/json");
		return Response.json({ ok: true });
	}

	if (body.action === "claim") {
		const { supabase, user } = await currentUser();
		if (!user) return Response.json({ error: "Please sign in first" }, { status: 401 });
		const id = String(body.id ?? "");
		if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ error: "Unknown link" }, { status: 404 });
		const handoff = await getJson<Handoff>(handoffKey(id));
		if (!handoff || handoff.userId !== user.id) return Response.json({ error: "Unknown link" }, { status: 404 });
		if (handoff.status === "claimed") return Response.json({ status: "claimed", key: handoff.key, filename: handoff.filename });
		if (handoff.status !== "done") {
			const expired = handoff.status === "waiting" && handoff.expires < Date.now();
			return Response.json({ status: expired ? "expired" : handoff.status });
		}
		// The video becomes the computer user's project, like an upload made on the computer.
		const { error } = await supabase.from("projects").insert({ id, video_key: handoff.key, filename: handoff.filename, size: handoff.size });
		if (error) return Response.json({ error: "Could not save your project" }, { status: 500 });
		await putObject(handoffKey(id), JSON.stringify({ ...handoff, status: "claimed" }), "application/json");
		return Response.json({ status: "claimed", key: handoff.key, filename: handoff.filename });
	}

	return Response.json({ error: "Unknown action" }, { status: 400 });
}
