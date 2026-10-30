import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";

// For "use client" pages. Keeps the session in cookies so our API routes can read it too.
export const supabaseBrowser = () => createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
