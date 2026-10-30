// Public values: safe in the browser (Row Level Security in the database decides what each user can see).
// Kept in code rather than env vars so the Cloudflare build doesn't need extra settings.
export const SUPABASE_URL = "https://icjjeinussbapihdjiym.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_d0jo4S-cv0_bEhHjXLsnyg_ZiwSlCLo";

// The only account allowed on /admin.
export const ADMIN_EMAIL = "kamkamsongto@gmail.com";
