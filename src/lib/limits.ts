// What a beta account may use. No server imports here, so pages can show the same numbers the server enforces.
export const BETA_MINUTES = 45; // in total for the whole beta, not per month
export const MINUTES_PER_VIDEO = 20;
export const MAX_FILE_GB = 2; // Deepgram refuses files over 2 GB: a larger limit needs the audio taken out of the video first
export const MAX_FILE_BYTES = MAX_FILE_GB * 1000 * 1000 * 1000;
export const FILE_TOO_BIG = `File must be ${MAX_FILE_GB} GB or smaller`;
export const OUT_OF_MINUTES = `You've used all ${BETA_MINUTES} of your beta minutes. Need more? Email hello@komoray.com.`;
