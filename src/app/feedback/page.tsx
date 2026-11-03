"use client";

import { AccountBar, SignInCard, useUser } from "@/components/Account";
import { FeedbackForm } from "@/components/FeedbackForm";

export default function FeedbackPage() {
	const user = useUser();
	if (user === undefined) return <main className="min-h-screen" />;
	if (user === null) {
		return (
			<main className="font-sans mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-4">
				<SignInCard title="Sign in to send feedback" />
			</main>
		);
	}
	return (
		<main className="font-sans mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-4 sm:p-8">
			<AccountBar user={user} />
			<h1 className="text-3xl font-bold tracking-tight">Tell us how it went</h1>
			<p className="text-foreground/70">Komoray is in private beta, so your answers decide what we build next. Skip anything you like.</p>
			<FeedbackForm />
		</main>
	);
}
