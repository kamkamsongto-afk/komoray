// Sound played faster without the voice going high: short overlapping pieces are laid closer together,
// each one picked where its wave lines up with the last, so voices don't warble (WSOLA).
const WINDOW = 720; // samples per piece: 30 ms at 24 kHz
const HOP = WINDOW / 2; // pieces overlap by half
const SEARCH = 170; // how far (samples) a piece may move to line up: 7 ms
const COMPARE_STEP = 2; // comparing every other sample is enough, and twice as fast

const HANN = Float32Array.from({ length: WINDOW }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WINDOW));

// `input` at `rate` times the speed (1.5 = takes two thirds of the time), same pitch.
export function stretch(input: Float32Array, rate: number): Float32Array {
	if (rate === 1 || input.length < WINDOW + SEARCH) return input;
	const length = Math.round(input.length / rate);
	const output = new Float32Array(length);
	const weight = new Float32Array(length);
	let previous = 0;
	for (let at = 0; at < length; at += HOP) {
		const wanted = Math.round(at * rate);
		const follow = previous + HOP; // what would carry on the last piece's wave without a jump
		let from = Math.min(wanted, input.length - WINDOW);
		if (at > 0) {
			let best = -Infinity;
			const low = Math.max(0, wanted - SEARCH);
			const high = Math.min(input.length - WINDOW, wanted + SEARCH);
			for (let candidate = low; candidate <= high; candidate++) {
				let match = 0;
				for (let i = 0; i < HOP; i += COMPARE_STEP) match += input[candidate + i] * input[follow + i];
				if (match > best) [best, from] = [match, candidate];
			}
		}
		from = Math.max(0, from);
		for (let i = 0; i < WINDOW && at + i < length; i++) {
			output[at + i] += (input[from + i] ?? 0) * HANN[i];
			weight[at + i] += HANN[i];
		}
		previous = from;
	}
	for (let i = 0; i < length; i++) if (weight[i] > 0.001) output[i] /= weight[i];
	return output;
}
