"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { signInWithGoogle, useUser } from "@/components/Account";
import { HomeLogo } from "@/components/HomeLogo";
import { EXTRA_PACKS, type PaddleEnv, PLANS, type PricesView } from "@/lib/billing";

// Paddle.js from Paddle's own CDN (not an npm package): the global it sets up, as far as this page uses it.
type PaddleEvent = { name?: string; data?: unknown };
type PaddleGlobal = {
	Environment: { set: (env: "sandbox") => void };
	Initialize: (options: { token: string; eventCallback?: (event: PaddleEvent) => void }) => void;
	Checkout: {
		open: (options: {
			items: { priceId: string; quantity: number }[];
			customer?: { email: string };
			customData?: Record<string, string>;
			settings?: { displayMode?: "overlay"; variant?: "one-page" | "multi-page"; theme?: "light" | "dark"; allowLogout?: boolean };
		}) => void;
	};
};
declare global {
	interface Window {
		Paddle?: PaddleGlobal;
	}
}
const PADDLE_JS = "https://cdn.paddle.com/paddle/v2/paddle.js";

type Config = { ready: false } | { ready: true; token: string; environment: PaddleEnv; prices: PricesView };

// Plans and the checkout (coach 16 Nov: Paddle in the sandbox first, on staging). What is sold is the decided pricing doc.
// Buying needs signing in: the user's id goes with the payment (customData), so the webhook knows whose plan it is.
export default function PricingPage() {
	const user = useUser();
	const [config, setConfig] = useState<Config | null>(null);
	const [ready, setReady] = useState(false); // Paddle.js loaded and set up
	const [yearly, setYearly] = useState(true);
	const [thanks, setThanks] = useState(false);
	const started = useRef(false);

	useEffect(() => {
		void fetch("/api/billing/config")
			.then((r) => r.json() as Promise<Config>)
			.then(setConfig)
			.catch(() => setConfig({ ready: false }));
	}, []);

	// Load Paddle.js once the token is known, and set it up for its own environment.
	useEffect(() => {
		if (!config?.ready || started.current) return;
		started.current = true;
		const setUp = () => {
			const paddle = window.Paddle;
			if (!paddle) return;
			if (config.environment === "sandbox") paddle.Environment.set("sandbox");
			paddle.Initialize({
				token: config.token,
				// Only for what the page shows: the plan itself is given by the webhook, never by this.
				eventCallback: (event) => event.name === "checkout.completed" && setThanks(true),
			});
			setReady(true);
		};
		if (window.Paddle) return setUp();
		const script = document.createElement("script");
		script.src = PADDLE_JS;
		script.async = true;
		script.onload = setUp;
		document.head.appendChild(script);
	}, [config]);

	function buy(priceId: string) {
		if (!user) return void signInWithGoogle();
		if (!ready || !window.Paddle || !user.email) return;
		const dark = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && window.matchMedia("(prefers-color-scheme: dark)").matches);
		window.Paddle.Checkout.open({
			items: [{ priceId, quantity: 1 }],
			customer: { email: user.email },
			customData: { user_id: user.id },
			settings: { displayMode: "overlay", variant: "one-page", theme: dark ? "dark" : "light", allowLogout: false },
		});
	}

	const prices = config?.ready ? config.prices : null;
	const open = Boolean(prices) && (ready || !user);
	const button = (label: string, priceId: string | undefined) => (
		<button
			onClick={() => priceId && buy(priceId)}
			disabled={!open || !priceId}
			className="mt-auto rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-40"
		>
			{user === null ? "Sign in to choose" : label}
		</button>
	);

	return (
		<main className="font-sans mx-auto flex min-h-screen max-w-5xl flex-col gap-8 p-6">
			{/* The same logo as every page: dark letters on the light theme, white on the dark one (coach 16 Nov). */}
			<HomeLogo className="self-start" />
			<header className="flex flex-col items-center gap-3 text-center">
				<h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Pick your plan</h1>
				<p className="text-foreground/70">One counter: minutes. Making a video and translating use the same minutes. Never charged automatically for more.</p>
				{config?.ready && config.environment === "sandbox" && (
					<p className="rounded-full bg-amber-500/20 px-3 py-1 text-xs text-foreground">Test mode: no real money. Card 4242 4242 4242 4242, any future date, any 3 digits.</p>
				)}
				{config && !config.ready && <p className="text-sm text-foreground/60">Buying isn&apos;t open yet.</p>}
				<div className="flex gap-1 rounded-full bg-foreground/10 p-1 text-sm" role="tablist" aria-label="Billing">
					{[
						[false, "Monthly"],
						[true, "Yearly · save up to 27%"],
					].map(([value, name]) => (
						<button key={String(value)} role="tab" aria-selected={yearly === value} onClick={() => setYearly(value as boolean)} className={`rounded-full px-4 py-1.5 ${yearly === value ? "bg-background font-medium shadow" : "text-foreground/70"}`}>
							{name}
						</button>
					))}
				</div>
			</header>

			{thanks && (
				<p className="rounded-xl border border-green-600/30 bg-green-600/10 p-4 text-center">
					Thank you! Your plan starts in a moment. <Link href="/upload" className="underline">Make a video</Link>
				</p>
			)}

			<section className="grid gap-4 md:grid-cols-4">
				{(["free", "starter", "pro"] as const).map((id) => {
					const plan = PLANS[id];
					const price = yearly ? plan.year : plan.month;
					return (
						<div key={id} className={`flex flex-col gap-3 rounded-2xl border p-5 ${id === "pro" ? "border-blue-600" : "border-foreground/15"}`}>
							<div className="flex items-center justify-between">
								<h2 className="text-lg font-semibold">{plan.name}</h2>
								{id === "pro" && <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs text-white">Recommended</span>}
							</div>
							<p>
								<span className="text-3xl font-bold">${price}</span>
								<span className="text-sm text-foreground/60"> / month{yearly && price ? `, $${price * 12} a year` : ""}</span>
							</p>
							<p className="text-sm font-medium">{plan.minutes}</p>
							<ul className="flex flex-col gap-1 text-sm text-foreground/75">
								{plan.points.map((p) => (
									<li key={p}>✓ {p}</li>
								))}
							</ul>
							{id === "free" ? (
								<Link href="/upload" className="mt-auto rounded-lg border border-foreground/20 px-4 py-2 text-center font-medium hover:bg-foreground/5">
									Start free
								</Link>
							) : (
								button(`Choose ${plan.name}`, prices?.[id][yearly ? "year" : "month"])
							)}
						</div>
					);
				})}
				<div className="flex flex-col gap-3 rounded-2xl border border-dashed border-foreground/15 p-5 text-foreground/60">
					<h2 className="text-lg font-semibold text-foreground">Max</h2>
					<p className="text-sm">For studios and teams. Coming soon.</p>
				</div>
			</section>

			<section className="flex flex-col gap-3 rounded-2xl border border-foreground/15 p-5">
				<h2 className="text-lg font-semibold">Extra minutes</h2>
				<p className="text-sm text-foreground/70">For paid plans. Good for 12 months. Your monthly minutes are used first.</p>
				<div className="flex flex-wrap gap-3">
					{EXTRA_PACKS.map((pack) => (
						<button
							key={pack.id}
							onClick={() => prices && buy(prices[pack.id])}
							disabled={!open}
							className="rounded-lg border border-foreground/20 px-4 py-2 font-medium hover:bg-foreground/5 disabled:opacity-40"
						>
							Add {pack.minutes} minutes · ${pack.price}
						</button>
					))}
				</div>
			</section>
		</main>
	);
}
