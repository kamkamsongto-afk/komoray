import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Privacy Policy · Komoray" };

const CONTACT = "hello@komoray.com";

export default function PrivacyPage() {
	return (
		<LegalPage title="Privacy Policy" updated="October 31, 2026">
			<p>
				Komoray is an AI studio for talking-head creators. You upload a video, we cut the silences, add subtitles and give you
				back a finished video. This page explains what we collect to do that, who helps us, and how long we keep it.
			</p>

			<h2>The short version</h2>
			<ul>
				<li>Your videos are yours. We use them only to make your edits.</li>
				<li>We never sell your data, and we never use your videos to train AI models.</li>
				<li>During the beta, every video is deleted automatically after 14 days.</li>
				<li>You can ask us to delete your data at any time.</li>
			</ul>

			<h2>What we collect</h2>
			<ul>
				<li>
					<strong>Your account:</strong> when you sign in with Google, we receive your name, email address and profile picture.
					We never see your Google password.
				</li>
				<li>
					<strong>Your videos:</strong> the files you upload, a smaller copy we make so the editor can play them smoothly, and the
					videos we make from them.
				</li>
				<li>
					<strong>Transcripts:</strong> the words spoken in your video and when each word is said. We need this to find the
					silences and to make subtitles.
				</li>
				<li>
					<strong>Your words (My words):</strong> when you fix a word in a script, we remember what the transcript said and what
					you typed, so we can fix it for you in your next videos. Only you can see your words. We never share them or use them to
					train anything.
				</li>
				<li>
					<strong>Your Brand Kit:</strong> the subtitle look you save (style, font, colour) and the channel name you type, so your
					next videos start with it.
				</li>
				<li>
					<strong>Error reports:</strong> if something breaks, we record what went wrong, the file name and size, and your
					browser type, so we can fix it.
				</li>
				<li>
					<strong>Troubleshooting recordings:</strong> only if we send you a special troubleshooting link, the editor records how
					the preview plays (timings, not your video or sound), so we can fix playback problems.
				</li>
			</ul>
			<p>We do not use advertising trackers. Your browser stores a few small settings for Komoray, such as whether you want desktop notifications.</p>

			<h2>How we use it</h2>
			<p>Only to run Komoray for you: to process your videos, keep you signed in, fix problems and answer your questions.</p>

			<h2>Who helps us</h2>
			<p>We use a few trusted services. Each one only gets what it needs for its job:</p>
			<ul>
				<li>
					<strong>Cloudflare</strong> runs our website and stores your videos.
				</li>
				<li>
					<strong>Deepgram</strong> turns the speech in your video into text. We ask Deepgram not to keep or train on your
					audio.
				</li>
				<li>
					<strong>Modal</strong> runs the computers that cut your video and add subtitles. It gets a temporary link to one
					video at a time.
				</li>
				<li>
					<strong>Supabase</strong> handles sign-in and stores your account details.
				</li>
				<li>
					<strong>Google</strong> lets you sign in with your Google account.
				</li>
			</ul>
			<p>These services may process data in the United States and other countries.</p>

			<h2>How long we keep it</h2>
			<ul>
				<li>During the beta, uploaded videos, their smaller copies, transcripts and finished videos are deleted automatically after 14 days.</li>
				<li>Error reports and troubleshooting recordings are deleted after 90 days.</li>
				<li>
					Your words stay with your account, so they keep working on your next videos. You can see, download and remove them at any
					time on the My words page.
				</li>
				<li>Your Brand Kit stays with your account. You can change it any time on the Brand Kit page.</li>
				<li>Your account stays until you ask us to delete it. Deleting your account also deletes your words and your Brand Kit.</li>
			</ul>
			<p>When the beta ends, this may change. If it does, we will update this page and email you before the change.</p>

			<h2>Your choices</h2>
			<p>
				You can ask to see, correct or delete your data at any time by emailing <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. We
				will reply within 30 days.
			</p>

			<h2>Children</h2>
			<p>Komoray is not meant for anyone under 13, and we do not knowingly collect their data.</p>

			<h2>Changes</h2>
			<p>If we change this policy, we will update the date at the top. For important changes, we will also email you.</p>

			<h2>Contact</h2>
			<p>
				Questions? Email <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
			</p>
		</LegalPage>
	);
}
