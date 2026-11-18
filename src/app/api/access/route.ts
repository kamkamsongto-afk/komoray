import { accessFor } from "@/lib/access";
import { watermarkOn } from "@/lib/watermark-on";
import { currentUser } from "@/lib/supabase/server";

// The signed-in user's own standing: invited or not, and the minutes left this month.
export async function GET() {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	const access = await accessFor(user.email);
	return Response.json({ email: user.email, ...access, perks: { ...access.perks, watermark: watermarkOn(access) } });
}
