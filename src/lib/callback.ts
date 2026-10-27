// Signs callback URLs so only the service we sent the link to can report a result for that video.

async function hmac(secret: string, message: string) {
	const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
		"sign",
	]);
	const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
	return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signedCallbackUrl(base: string, key: string, secret: string) {
	const url = new URL(base);
	url.searchParams.set("key", key);
	url.searchParams.set("sig", await hmac(secret, key));
	return url.toString();
}

export async function verifyCallback(key: string, sig: string, secret: string) {
	const expected = await hmac(secret, key);
	// Constant-time compare so the signature can't be guessed byte by byte.
	if (sig.length !== expected.length) return false;
	let diff = 0;
	for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
	return diff === 0;
}
