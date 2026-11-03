import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isAdmin } from "./supabase/server";

// Until paid plans have quotas, this keeps one account from running up the speech-to-text and render bills.
const UPLOADS_PER_DAY = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

// A message to show if this user has uploaded too much today, else null. The database only counts their own rows.
export async function uploadLimitReached(supabase: SupabaseClient, user: User) {
	if (isAdmin(user.email)) return null;
	const since = new Date(Date.now() - DAY_MS).toISOString();
	const { count, error } = await supabase.from("projects").select("id", { count: "exact", head: true }).gte("created_at", since);
	if (error) return "Could not check your uploads. Please try again.";
	return (count ?? 0) >= UPLOADS_PER_DAY ? `You've reached ${UPLOADS_PER_DAY} uploads in 24 hours. Please try again later, or email hello@komoray.com for more.` : null;
}
