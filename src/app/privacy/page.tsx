import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Privacy Policy · Komoray" };

const CONTACT = "hello@komoray.com";

export default function PrivacyPage() {
	return (
		<LegalPage title="Privacy Policy" updated="[date it goes live]">
			<p>
				Komoray is an AI studio for talking-head creators. You upload a video, we cut the silences, add subtitles and give you
				back a finished video. This page explains what we collect to do that, who helps us, and how long we keep it.
			</p>

			<h2>The short version</h2>
			<ul>
				<li>Your videos are yours. We use them only to make your edits.</li>
				<li>We never sell your data, and we never use your videos to train AI models.</li>
				<li>Sharing the words you fix with other creators is off unless you turn it on, and it never includes who you are.</li>
				<li>Payments go through Paddle. We never see or keep your card number.</li>
				<li>Original videos are deleted automatically: after 14 days on Free, 45 or 90 days on paid plans.</li>
				<li>You can ask us to delete your data at any time.</li>
			</ul>

			<h2>What we collect</h2>
			<ul>
				<li>
					<strong>Early access list:</strong> if you join it on our home page, we keep your email address to invite you, and for nothing else.
					Ask us any time to take it off.
				</li>
				<li>
					<strong>Feedback:</strong> if you send us feedback, we keep your answers with your email address, to improve Komoray and to reply. Ask us any time to remove them.
				</li>
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
					you typed, so we can fix it for you in your next videos. Only you can see your list of words. We never use it to train AI
					models, and we only share fixes from it if you choose to (next point).
				</li>
				<li>
					<strong>Shared word fixes, only if you choose:</strong> on the My words page you can tick &ldquo;Help make Komoray more
					accurate for everyone&rdquo;. It is off until you tick it. Then, each time you fix a word, we add that fix to a list shared by
					all creators, so our AI can fix the same speech-to-text mistake in everyone&apos;s videos. What we share and what we don&apos;t:
					<ul>
						<li>Only the pair of words, such as &ldquo;ผูหญิง → ผู้หญิง&rdquo;. Never your name, email, account, videos, or the sentence the word came from.</li>
						<li>Only ordinary words: Thai words that are in the dictionary, or other words in small letters. Numbers, links and anything with @ are never shared.</li>
						<li>To count each creator once, we keep a scrambled code made from your account next to the fix. We never keep your account, name or email with it, and we never use the code to find out who made a fix.</li>
						<li>A fix is only used once at least 3 different creators have made the same one, so a fix only you would make, such as the name of someone you know, is never used.</li>
						<li>You can untick it any time on My words, and nothing more is shared from then on. Fixes shared before stay in the list, without your name. If you want them taken out too, email us.</li>
					</ul>
				</li>
				<li>
					<strong>Your Brand Kit:</strong> the subtitle look you save (style, font, color), the channel name you type and the font
					file you upload, if any, so your next videos start with it. Only your videos use your font.
				</li>
				<li>
					<strong>Your plan and payments:</strong> if you buy a plan, Paddle (below) takes the payment. From Paddle we get which
					plan you bought, whether it is monthly or yearly, when it renews or ends, whether a payment went through, and the IDs Paddle
					gives your purchase. We keep this with a scrambled code made from your email address, so we know which plan is yours.
					We never see or keep your card or bank details.
				</li>
				<li>
					<strong>How you use Komoray:</strong> we link your email address to your videos and keep track of how far each one got, how many words you fixed and any errors you saw, to help you and to improve Komoray. We also keep how many minutes you used each month. The link to each video is deleted with the video.
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
			<p>Only to run Komoray for you: to process your videos, keep you signed in, fix problems, answer your questions and, during the beta, see where people get stuck so we can improve it.</p>

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
					<strong>Anthropic</strong> reads your script with its AI model Claude to fix words the speech-to-text got wrong, to suggest parts you may want to cut and the moments worth a zoom, and translates your subtitles when you ask. With your script it gets the words in your My words list and the shared word fixes, so it spells them the way creators want. It gets the text, never your video or audio, and does not train on it.
				</li>
				<li>
					<strong>Supabase</strong> handles sign-in and stores your account details.
				</li>
				<li>
					<strong>Paddle</strong> sells our plans as the Merchant of Record: it takes your payment, adds the right tax, sends your
					receipts and lets you manage or cancel your plan. Paddle handles your payment details under its own{" "}
					<a href="https://www.paddle.com/legal/privacy">privacy policy</a>.
				</li>
				<li>
					<strong>Brevo</strong> sends our emails to you, such as an invite, a reminder before a yearly plan renews, or a warning
					before an original video is deleted. It gets your email address and the message.
				</li>
				<li>
					<strong>Google</strong> lets you sign in with your Google account.
				</li>
			</ul>
			<p>These services may process data in the United States and other countries.</p>

			<h2>How long we keep it</h2>
			<ul>
				<li>On the Free plan, uploaded videos, their smaller copies, transcripts, translations and finished videos are deleted automatically after 14 days.</li>
				<li>
					On paid plans, original uploaded videos are deleted 45 days after upload on monthly billing, or 90 days on yearly billing.
					We email you 14 days and 7 days before. The finished videos stay for as long as you have a plan, and for 30 days after it
					ends.
				</li>
				<li>What Paddle tells us about your plan and payments is kept for as long as the law asks us to keep records of sales.</li>
				<li>You can delete a video and everything made from it at any time on the My projects page.</li>
				<li>Error reports and troubleshooting recordings are deleted after 90 days.</li>
				<li>
					Your words stay with your account, so they keep working on your next videos. You can see, download and remove them at any
					time on the My words page.
				</li>
				<li>Your Brand Kit stays with your account. You can change it any time on the Brand Kit page.</li>
				<li>Shared word fixes are kept for as long as Komoray runs, without your name. If you want the ones you shared taken out, email us.</li>
				<li>Your account stays until you ask us to delete it. Deleting your account also deletes your words and your Brand Kit.</li>
			</ul>

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
