import { accessFor } from "@/lib/access";
import { markActive } from "@/lib/storage";
import { watermarkOn } from "@/lib/watermark-on";
import { currentUser } from "@/lib/supabase/server";

// The signed-in user's own standing: invited or not, and the minutes left this month.
export async function GET() {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	const access = await accessFor(user.email);
	if (user.email) await markActive(user.email); // opening Komoray signed in (the Free plan's 30 days, lib/storage.ts)
	return Response.json({ email: user.email, ...access, perks: { ...access.perks, watermark: watermarkOn(access) } });
}
