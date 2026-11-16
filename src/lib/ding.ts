// Two soft rising tones, made in the browser so there is no sound file to load. Browsers only play sound after a click,
// so the AudioContext is made on one (Make video, picking a file to upload) and kept for when the work is done.
export function ding(audio: AudioContext | null) {
	if (!audio) return;
	[880, 1320].forEach((freq, i) => {
		const osc = audio.createOscillator();
		const gain = audio.createGain();
		const at = audio.currentTime + i * 0.18;
		osc.frequency.value = freq;
		gain.gain.setValueAtTime(0.0001, at);
		gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
		gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
		osc.connect(gain).connect(audio.destination);
		osc.start(at);
		osc.stop(at + 0.4);
	});
}
