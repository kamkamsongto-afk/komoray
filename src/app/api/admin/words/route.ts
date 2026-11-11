import { sameOrigin } from "@/lib/access";
import { changeCurated, curatable, readCurated } from "@/lib/shared-words";
import { currentUser, isAdmin } from "@/lib/supabase/server";

// Komoray's own word list (lib/shared-words.ts), for the admin page's Words tab:
//   GET                                   { th, latin }  every pair, newest first
//   POST   { pairs: [{ heard, fixed }] }  { added, skipped }  add or change pairs (skipped: ones curatable refused)
//   DELETE { heard, lang }                remove one
async function admin(request?: Request) {
	const { user } = await currentUser();
	if (!user || !isAdmin(user.email)) return false;
	return !request || sameOrigin(request);
}
const NOT_ADMIN = () => Response.json({ error: "This page is for the Komoray team only" }, { status: 403 });
const MAX_AT_ONCE = 2000;

export async function GET() {
	if (!(await admin())) return NOT_ADMIN();
	const [th, latin] = await Promise.all([readCurated("th"), readCurated("latin")]);
	return Response.json({ th, latin });
}

export async function POST(request: Request) {
	if (!(await admin(request))) return NOT_ADMIN();
	const body = (await request.json().catch(() => ({}))) as { pairs?: unknown };
	const pairs = (Array.isArray(body.pairs) ? body.pairs : []).slice(0, MAX_AT_ONCE) as { heard?: unknown; fixed?: unknown }[];
	const add: Record<"th" | "latin", { heard: string; fixed: string }[]> = { th: [], latin: [] };
	const skipped: string[] = [];
	for (const p of pairs) {
		const heard = String(p?.heard ?? "");
		const fixed = String(p?.fixed ?? "");
		const lang = curatable(heard, fixed);
		if (lang) add[lang].push({ heard, fixed });
		else skipped.push(`${heard} → ${fixed}`);
	}
	if (add.th.length) await changeCurated("th", add.th);
	if (add.latin.length) await changeCurated("latin", add.latin);
	return Response.json({ added: add.th.length + add.latin.length, skipped });
}

export async function DELETE(request: Request) {
	if (!(await admin(request))) return NOT_ADMIN();
	const { heard, lang } = (await request.json().catch(() => ({}))) as { heard?: unknown; lang?: unknown };
	if (typeof heard !== "string" || (lang !== "th" && lang !== "latin")) return Response.json({ error: "Which word?" }, { status: 400 });
	await changeCurated(lang, [], [heard]);
	return Response.json({ ok: true });
}
