// An email as the name of its files in R2 (access/people/<hash>.json and the like): SHA-256 of it, trimmed and in
// lower case. No server code here, so the pricing page can work out the same name for the checkout (lib/billing-store.ts).
export async function hashEmail(email: string) {
	const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.trim().toLowerCase())));
	return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
