// What a beta account may use. No server imports here, so pages can show the same numbers the server enforces.
export const BETA_MINUTES = 45; // in total for the whole beta, not per month
export const MINUTES_PER_VIDEO = 20;
export const MAX_FILE_GB = 2; // Deepgram refuses files over 2 GB: a larger limit needs the audio taken out of the video first
export const MAX_FILE_BYTES = MAX_FILE_GB * 1000 * 1000 * 1000;
// The admin's biggest file (coach 22 Nov): one R2 upload may be 5 GB. Over DEEPGRAM_MAX_BYTES the sound is taken out first (lib/audio-first.ts).
export const ADMIN_MAX_GB = 5;
export const DEEPGRAM_MAX_BYTES = 1_900_000_000; // Deepgram's own limit is 2 GB; a little under it
export const FILE_TOO_BIG = `File must be ${MAX_FILE_GB} GB or smaller`;
// The same, for a plan's own size (lib/plans.ts maxGb: Free 1 GB).
export const bytesOfGb = (gb: number) => gb * 1000 * 1000 * 1000;
export const fileTooBig = (gb: number) => `File must be ${gb} GB or smaller`;
export const OUT_OF_MINUTES = `You've used all ${BETA_MINUTES} of your beta minutes. Need more? Email hello@komoray.com.`;
