import { sameOrigin } from "@/lib/access";
import { deleteObject, getJson, listObjects, putObject } from "@/lib/r2";
import { currentUser, isAdmin } from "@/lib/supabase/server";

// What beta users think, one file each at feedback/<time>-<id>.json (outside uploads/, so it stays).
//   POST { easy, result, pay, note, key }  signed-in users. easy and result: 1 to 5. pay: yes, maybe or no.
//   GET                                    for the admin: { answers }
const MAX_BODY = 8 * 1024;
const MAX_NOTE = 2000;
const SHOW = 500;

const score = (n: unknown) => (Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 5 ? (n as number) : null);

export async function POST(request: Request) {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	if (Number(request.headers.get("content-length")) > MAX_BODY) return Response.json({ error: "Too long" }, { status: 413 });
	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const easy = score(body.easy);
	const result = score(body.result);
	const pay = body.pay === "yes" || body.pay === "maybe" || body.pay === "no" ? body.pay : null;
	const note = String(body.note ?? "").trim().slice(0, MAX_NOTE);
	if (!easy && !result && !pay && !note) return Response.json({ error: "Please answer at least one question" }, { status: 400 });
	const at = new Date().toISOString();
	const answer = { email: user.email ?? "", at, easy, result, pay, note, key: String(body.key ?? "").slice(0, 200) };
	await putObject(`feedback/${at}-${crypto.randomUUID().slice(0, 8)}.json`, JSON.stringify(answer), "application/json");
	return Response.json({ ok: true });
}

export async function GET() {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	if (!isAdmin(user.email)) return Response.json({ error: "This page is for the Komoray team only" }, { status: 403 });
	const files = (await listObjects("feedback/")).sort((a, b) => b.key.localeCompare(a.key)).slice(0, SHOW);
	const answers = await Promise.all(files.map(async (file) => {
		const answer = await getJson<Record<string, unknown>>(file.key).catch(() => null);
		return answer && { ...answer, file: file.key };
	}));
	return Response.json({ answers: answers.filter(Boolean) });
}

// The admin removes one answer.
export async function DELETE(request: Request) {
	const { user } = await currentUser();
	if (!user || !isAdmin(user.email)) return Response.json({ error: "This page is for the Komoray team only" }, { status: 403 });
	if (!sameOrigin(request)) return Response.json({ error: "Not allowed" }, { status: 403 });
	const file = new URL(request.url).searchParams.get("file");
	if (!file || !/^feedback\/[^/]+\.json$/.test(file)) return Response.json({ error: "Unknown answer" }, { status: 404 });
	await deleteObject(file);
	return Response.json({ ok: true });
}
