import { sameOrigin } from "@/lib/access";
import { deleteObject } from "@/lib/r2";
import { currentUser, isAdmin } from "@/lib/supabase/server";

// Remove one browser report. Only the reports right in logs/: nothing else can be named here.
const REPORT = /^logs\/[^/]+\.json$/;

export async function DELETE(request: Request) {
	const { user } = await currentUser();
	if (!user || !isAdmin(user.email)) return Response.json({ error: "This page is for the Komoray team only" }, { status: 403 });
	if (!sameOrigin(request)) return Response.json({ error: "Not allowed" }, { status: 403 });
	const file = new URL(request.url).searchParams.get("file");
	if (!file || !REPORT.test(file)) return Response.json({ error: "Unknown report" }, { status: 404 });
	await deleteObject(file);
	return Response.json({ ok: true });
}
