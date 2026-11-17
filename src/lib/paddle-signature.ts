// Is this webhook really from Paddle? Its Paddle-Signature header is "ts=<unix seconds>;h1=<hex>" (more than one h1
// while a secret is being rotated). h1 is HMAC-SHA256 of "<ts>:<raw body>" with the notification destination's secret
// (developer.paddle.com/webhooks/about/signature-verification). Done with Web Crypto, so no Paddle package is needed.
// Too old a ts is refused too: someone who saw one delivery can't send it again later (Paddle signs each retry anew).
export const SIGNATURE_MAX_AGE_SECONDS = 30; // Paddle's own SDK allows 5; a little more for clocks that differ

export async function paddleSigned(rawBody: string, header: string, secret: string, nowSeconds = Date.now() / 1000) {
	if (!header || !secret) return false;
	const parts = header.split(";").map((p) => p.trim().split("="));
	const ts = parts.find(([k]) => k === "ts")?.[1] ?? "";
	const sent = parts.filter(([k]) => k === "h1").map(([, v]) => (v ?? "").toLowerCase());
	if (!/^\d+$/.test(ts) || !sent.length) return false;
	if (Math.abs(nowSeconds - Number(ts)) > SIGNATURE_MAX_AGE_SECONDS) return false;
	const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}:${rawBody}`)));
	const want = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
	return sent.some((h) => sameText(h, want));
}

// Compared in the same time whatever the text, so the time taken gives nothing away.
function sameText(a: string, b: string) {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}
