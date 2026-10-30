import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { ADMIN_EMAIL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";

// For route handlers: acts as the signed-in user, so database rules only show their own rows.
export async function supabaseServer() {
	const cookieStore = await cookies();
	return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
		cookies: {
			getAll: () => cookieStore.getAll(),
			setAll: (toSet) => toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
		},
	});
}

export async function currentUser() {
	const supabase = await supabaseServer();
	const { data } = await supabase.auth.getUser();
	return { supabase, user: data.user };
}

export const isAdmin = (email?: string | null) => email?.toLowerCase() === ADMIN_EMAIL;

// Is this video the signed-in user's? (The database only returns rows they own.)
export async function ownsVideo(key: string) {
	const { supabase, user } = await currentUser();
	if (!user) return false;
	const id = key.split("/")[1]; // uploads/<id>/<name>
	const { data } = await supabase.from("projects").select("id").eq("id", id).eq("video_key", key).maybeSingle();
	return Boolean(data);
}
