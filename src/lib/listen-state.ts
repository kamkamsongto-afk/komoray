// Between the first request taking a video and that job being written down, a second request would see the
// record and pay for speech-to-text again. So a record this new, with no job and no result yet, means "wait".
const CLAIM_MS = 2 * 60 * 1000; // after this the first request has died, and trying again must work

export function justClaimed(claimedAt: string | undefined, hasJob: boolean, hasResult: boolean, now: number) {
	if (hasJob || hasResult || !claimedAt) return false;
	return now - new Date(claimedAt).getTime() < CLAIM_MS;
}
