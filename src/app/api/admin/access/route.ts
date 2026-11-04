import { addPerson, listPeople, removePerson, sameOrigin } from "@/lib/access";
import { currentUser, isAdmin } from "@/lib/supabase/server";

// The admin's list of invited people.
//   GET                { people: [{ email, at, used }] }
//   POST { email }     invite
//   DELETE ?email=…    take the invite back (their videos and minutes stay)
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function adminOnly() {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	if (!isAdmin(user.email)) return Response.json({ error: "This page is for the Komoray team only" }, { status: 403 });
	return null;
}

export async function GET() {
	return (await adminOnly()) ?? Response.json({ people: await listPeople() });
}

export async function POST(request: Request) {
	const denied = await adminOnly();
	if (denied) return denied;
	if (!sameOrigin(request)) return Response.json({ error: "Not allowed" }, { status: 403 });
	const { email } = (await request.json().catch(() => ({}))) as { email?: unknown };
	const clean = String(email ?? "").trim().toLowerCase();
	if (clean.length > 254 || !EMAIL.test(clean)) return Response.json({ error: "Please enter a valid email address" }, { status: 400 });
	await addPerson(clean);
	return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
	const denied = await adminOnly();
	if (denied) return denied;
	if (!sameOrigin(request)) return Response.json({ error: "Not allowed" }, { status: 403 });
	const email = new URL(request.url).searchParams.get("email");
	if (!email) return Response.json({ error: "Which email?" }, { status: 400 });
	await removePerson(email);
	return Response.json({ ok: true });
}
