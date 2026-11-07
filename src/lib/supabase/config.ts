// Public values: safe in the browser (Row Level Security in the database decides what each user can see).
// Kept in code rather than env vars so the Cloudflare build doesn't need extra settings.
// staging.komoray.com has its own database: `npm run deploy:staging` builds with NEXT_PUBLIC_KOMORAY_STAGE=staging
// (written straight into the code at build time, so the browser gets the right one too).
export const IS_STAGING = process.env.NEXT_PUBLIC_KOMORAY_STAGE === "staging";
const LIVE = { url: "https://icjjeinussbapihdjiym.supabase.co", key: "sb_publishable_d0jo4S-cv0_bEhHjXLsnyg_ZiwSlCLo" };
const STAGING = { url: "STAGING_SUPABASE_URL", key: "STAGING_SUPABASE_KEY" };
export const SUPABASE_URL = IS_STAGING ? STAGING.url : LIVE.url;
export const SUPABASE_PUBLISHABLE_KEY = IS_STAGING ? STAGING.key : LIVE.key;

// The only account allowed on /admin.
export const ADMIN_EMAIL = "kamkamsongto@gmail.com";
