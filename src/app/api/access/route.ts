import { accessFor } from "@/lib/access";
import { currentUser } from "@/lib/supabase/server";

// The signed-in user's own standing: invited or not, and the minutes left this month.
export async function GET() {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	return Response.json({ email: user.email, ...(await accessFor(user.email)) });
}
