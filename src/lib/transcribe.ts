// The only file that knows about Deepgram. To switch speech-to-text provider,
// rewrite startTranscription() and readTranscript() and keep returning the same Transcript shape.

export type Word = { text: string; start: number; end: number }; // seconds
export type Transcript = { duration: number; words: Word[] };

type DeepgramResponse = {
	err_msg?: string;
	metadata?: { duration: number };
	results?: {
		channels: { alternatives: { words: { word: string; punctuated_word?: string; start: number; end: number }[] }[] }[];
	};
};

// Long videos take Deepgram minutes, longer than a request may stay open, so we don't wait:
// Deepgram answers right away and later POSTs the result to callbackUrl.
export async function startTranscription(mediaUrl: string, apiKey: string, language: string, callbackUrl: string) {
	// mip_opt_out: Deepgram must not keep or train on creators' audio (promised in our Privacy Policy).
	const params = new URLSearchParams({ model: "nova-3", smart_format: "true", language, callback: callbackUrl, mip_opt_out: "true" });
	const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
		method: "POST",
		headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
		body: JSON.stringify({ url: mediaUrl }),
	});
	if (!res.ok) throw new Error(`Deepgram error ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// Turn what Deepgram POSTs to the callback into our Transcript (throws if Deepgram reported a failure).
export function readTranscript(data: unknown): Transcript {
	const dg = data as DeepgramResponse;
	if (dg.err_msg || !dg.metadata || !dg.results) throw new Error(dg.err_msg ?? "Speech-to-text failed");
	const words = dg.results.channels[0]?.alternatives[0]?.words ?? [];
	return {
		duration: dg.metadata.duration,
		words: words.map((w) => ({ text: w.punctuated_word ?? w.word, start: w.start, end: w.end })),
	};
}
