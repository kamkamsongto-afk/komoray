"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { signInWithGoogle, useUser } from "@/components/Account";
import { HomeLogo } from "@/components/HomeLogo";
import { EXTRA_PACKS, type PaddleEnv, PLANS, type PricesView } from "@/lib/billing";
import { hashEmail } from "@/lib/email-hash";
import { shortDate } from "@/lib/plans";

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
const SELL_EXTRA = false;

type Config = { ready: false } | { ready: true; token: string; environment: PaddleEnv; prices: PricesView };
type MyPlan = { plan: "free" | "starter" | "pro"; extraMinutes: number; monthly?: { left: number; limit: number; resetsAt: string } | null; status?: string; every?: "month" | "year"; periodEnds?: string | null; cancelsAt?: string | null };
// In English like the rest of the page (coach, 17 Nov: a Thai computer showed "17 พ.ย. 2570").
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });

// Plans and the checkout (coach 16 Nov: Paddle in the sandbox first, on staging). What is sold is the decided pricing doc.
// Buying needs signing in: the user's id goes with the payment (customData), so the webhook knows whose plan it is.
export default function PricingPage() {
	const user = useUser();
	const [config, setConfig] = useState<Config | null>(null);
	const [ready, setReady] = useState(false); // Paddle.js loaded and set up
	const [yearly, setYearly] = useState(true);
	const [thanks, setThanks] = useState(false);
	const [mine, setMine] = useState<MyPlan | null>(null);
	const [note, setNote] = useState("");
	const started = useRef(false);

	// The plan we have on record (from Paddle's webhook). After a purchase it is asked again a few times: the webhook
	// usually lands within seconds of the checkout closing.
	useEffect(() => {
		if (!user) return;
		let gone = false;
		let tries = 0;
		const ask = () =>
			fetch("/api/billing/me")
				.then((r) => (r.ok ? (r.json() as Promise<MyPlan>) : null))
				.then((p) => {
					if (gone || !p) return;
					setMine(p);
					if (thanks && p.plan === "free" && tries++ < 6) setTimeout(ask, 2500);
				})
				.catch(() => {});
		void ask();
		return () => {
			gone = true;
		};
	}, [user, thanks]);

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

	// plan: a plan is never bought twice (coach, 17 Nov: Choose Pro again would start a second plan and charge again).
	// Asked again right before the checkout opens, in case this page was left open while buying in another tab.
	async function buy(priceId: string, what: "plan" | "extra") {
		if (!user) return void signInWithGoogle();
		if (!ready || !window.Paddle || !user.email) return;
		setNote("");
		const now = await fetch("/api/billing/me")
			.then((r) => (r.ok ? (r.json() as Promise<MyPlan>) : null))
			.catch(() => null);
		if (!now) return setNote("Couldn't check your plan just now. Please try again.");
		setMine(now);
		if (what === "plan" && now.plan !== "free") return setNote(`You're already on ${PLANS[now.plan].name}. Changing plans is coming soon.`);
		if (what === "extra" && now.plan === "free") return setNote("Extra minutes are for paid plans: pick Starter or Pro first.");
		// Whose purchase it is, for the webhook: the same name as their files in R2 (lib/billing-store.ts).
		const emailHash = await hashEmail(user.email);
		const dark = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && window.matchMedia("(prefers-color-scheme: dark)").matches);
		window.Paddle.Checkout.open({
			items: [{ priceId, quantity: 1 }],
			customer: { email: user.email },
			customData: { user_id: user.id, email_hash: emailHash },
			settings: { displayMode: "overlay", variant: "one-page", theme: dark ? "dark" : "light", allowLogout: false },
		});
	}

	const prices = config?.ready ? config.prices : null;
	const open = Boolean(prices) && (ready || !user);
	const paid = mine && mine.plan !== "free" ? mine.plan : null;
	const button = (id: "starter" | "pro", priceId: string | undefined) => (
		<button
			onClick={() => priceId && void buy(priceId, "plan")}
			disabled={!open || !priceId || Boolean(paid)}
			title={paid && paid !== id ? "Changing plans is coming soon" : undefined}
			className="mt-auto rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-40"
		>
			{user === null ? "Sign in to choose" : paid === id ? "Your plan" : paid ? "Change plan (soon)" : `Choose ${PLANS[id].name}`}
		</button>
	);

	return (
		<main className="font-sans mx-auto flex min-h-screen max-w-5xl flex-col gap-8 p-6">
			{/* The same logo as every page: dark letters on the light theme, white on the dark one (coach 16 Nov). */}
			<HomeLogo className="self-start" />
			<header className="flex flex-col items-center gap-3 text-center">
				<h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Pick your plan</h1>
				<p className="text-foreground/70">One counter: minutes of video you upload. Never charged automatically for more.</p>
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

			{mine && mine.plan !== "free" && (
				<p className="rounded-xl border border-blue-600/30 bg-blue-600/10 p-4 text-center text-sm">
					You&apos;re on <span className="font-semibold">{PLANS[mine.plan].name}</span>
					{mine.every ? ` (${mine.every === "year" ? "yearly" : "monthly"})` : ""}.{" "}
					{mine.cancelsAt ? `It ends on ${day(mine.cancelsAt)}.` : mine.periodEnds ? `Next bill on ${day(mine.periodEnds)}.` : ""}
					{mine.status === "past_due" ? " Your last payment didn't go through: please update your card." : ""}
					{mine.monthly ? ` ${mine.monthly.left} of ${mine.monthly.limit} minutes left · resets ${shortDate(mine.monthly.resetsAt)}.` : ""}
					{mine.extraMinutes ? ` Extra minutes: ${mine.extraMinutes}.` : ""}
				</p>
			)}
			{note && <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-center text-sm">{note}</p>}
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
								button(id, prices?.[id][yearly ? "year" : "month"])
							)}
						</div>
					);
				})}
				<div className="flex flex-col gap-3 rounded-2xl border border-dashed border-foreground/15 p-5 text-foreground/60">
					<h2 className="text-lg font-semibold text-foreground">Max</h2>
					<p className="text-sm">For studios and teams. Coming soon.</p>
				</div>
			</section>
			{/* Prices are before tax (coach 18 Nov): Paddle adds VAT or sales tax for the buyer's country at checkout (prices'
			    tax_mode "external"), and a business can add its tax number there. */}
			<p className="-mt-4 text-center text-xs text-foreground/60">
				Prices in US dollars, plus applicable VAT or sales tax for your country, added at checkout. Buying for a business? Add your VAT or tax number at checkout.
			</p>

			{/* Extra minutes: not sold for now (coach, 18 Nov: it reads like a credit top-up). Kept to turn back on. */}
			{SELL_EXTRA && (
				<section className="flex flex-col gap-3 rounded-2xl border border-foreground/15 p-5">
					<h2 className="text-lg font-semibold">Extra minutes</h2>
					<p className="text-sm text-foreground/70">For paid plans. Good for 12 months. Your monthly minutes are used first.</p>
					<div className="flex flex-wrap gap-3">
						{EXTRA_PACKS.map((pack) => (
							<button
								key={pack.id}
								onClick={() => prices && void buy(prices[pack.id], "extra")}
								disabled={!open || (Boolean(mine) && !paid)}
								className="rounded-lg border border-foreground/20 px-4 py-2 font-medium hover:bg-foreground/5 disabled:opacity-40"
							>
								Add {pack.minutes} minutes · ${pack.price}
							</button>
						))}
					</div>
				</section>
			)}
		</main>
	);
}
