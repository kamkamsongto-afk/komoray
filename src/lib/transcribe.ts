// The only file that knows about Deepgram. To switch speech-to-text provider,
// rewrite transcribe() and keep returning the same Transcript shape.

export type Word = { text: string; start: number; end: number }; // seconds
export type Transcript = { duration: number; words: Word[] };

type DeepgramResponse = {
	metadata: { duration: number };
	results: {
		channels: { alternatives: { words: { word: string; punctuated_word?: string; start: number; end: number }[] }[] }[];
	};
};

export async function transcribe(mediaUrl: string, apiKey: string, language = "en"): Promise<Transcript> {
	const params = new URLSearchParams({ model: "nova-3", smart_format: "true", language });
	const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
		method: "POST",
		headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
		body: JSON.stringify({ url: mediaUrl }),
	});
	if (!res.ok) throw new Error(`Deepgram error ${res.status}: ${(await res.text()).slice(0, 200)}`);

	const data = (await res.json()) as DeepgramResponse;
	const words = data.results.channels[0]?.alternatives[0]?.words ?? [];
	return {
		duration: data.metadata.duration,
		words: words.map((w) => ({ text: w.punctuated_word ?? w.word, start: w.start, end: w.end })),
	};
}
