import { accessFor } from "@/lib/access";
import { deletionFor, markActive, storageOf } from "@/lib/storage";
import { currentUser } from "@/lib/supabase/server";

// My projects' storage bar: what their projects take (each one and in all), their plan's storage, and when their files
// would be deleted (lib/storage.ts). Opening it counts as using Komoray (the Free plan's 30 days).
export async function GET() {
	const { supabase, user } = await currentUser();
	if (!user?.email) return Response.json({ error: "Please sign in" }, { status: 401 });
	const access = await accessFor(user.email);
	const [storage, deletion] = await Promise.all([storageOf(supabase), deletionFor(user.email, access), markActive(user.email)]);
	return Response.json({ used: storage.used, files: storage.files, perProject: storage.perProject, gone: storage.gone, storageGb: access.storageGb, deletion });
}
