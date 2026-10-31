"use client";

import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

// undefined = still checking, null = signed out.
export function useUser() {
	const [user, setUser] = useState<User | null | undefined>(undefined);
	useEffect(() => {
		const supabase = supabaseBrowser();
		supabase.auth.getUser().then(({ data }) => setUser(data.user));
		const { data } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
		return () => data.subscription.unsubscribe();
	}, []);
	return user;
}

export function signInWithGoogle(next = window.location.pathname + window.location.search) {
	const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
	return supabaseBrowser().auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
}

export function SignInCard({ title = "Sign in to continue" }: { title?: string }) {
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	useEffect(() => setFailed(new URLSearchParams(window.location.search).get("signin") === "failed"), []);
	return (
		<div className="flex flex-col items-center gap-4 rounded-2xl border border-foreground/15 p-8 text-center">
			<h2 className="text-xl font-semibold">{title}</h2>
			<p className="text-sm text-foreground/60">Your videos stay private to your account.</p>
			<button
				onClick={() => {
					setBusy(true);
					void signInWithGoogle();
				}}
				disabled={busy}
				className="flex items-center gap-3 rounded-full border border-foreground/20 bg-white px-5 py-2.5 font-medium text-black shadow-sm disabled:opacity-60"
			>
				<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
					<path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
					<path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
					<path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
					<path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
				</svg>
				{busy ? "Opening Google…" : "Sign in with Google"}
			</button>
			{failed && <p className="text-sm text-red-600">❌ Sign-in didn&apos;t finish. Please try again.</p>}
		</div>
	);
}

// Top bar on signed-in pages: who you are, your projects, sign out.
export function AccountBar({ user }: { user: User }) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-2 text-sm text-foreground/70">
			<div className="flex items-center gap-4">
				<Link href="/upload" className="hover:text-foreground">
					New video
				</Link>
				<Link href="/projects" className="hover:text-foreground">
					My projects
				</Link>
				<Link href="/words" className="hover:text-foreground">
					My words
				</Link>
				<Link href="/brand" className="hover:text-foreground">
					Brand Kit
				</Link>
			</div>
			<div className="flex items-center gap-3">
				<span className="max-w-[12rem] truncate">{user.email}</span>
				<button
					onClick={async () => {
						await supabaseBrowser().auth.signOut();
						window.location.href = "/upload";
					}}
					className="underline hover:text-foreground"
				>
					Sign out
				</button>
			</div>
		</div>
	);
}
