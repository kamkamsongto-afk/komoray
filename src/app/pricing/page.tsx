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

// Which seller is open (api/billing/config). Polar: its own checkout page; Paddle: its checkout inside this page.
type Config =
	| { ready: false }
	| { ready: true; seller: "polar"; environment: PaddleEnv }
	| { ready: true; seller: "paddle"; token: string; environment: PaddleEnv; prices: PricesView };
type MyPlan = { plan: "free" | "starter" | "pro"; hadPlan?: boolean; pastDue?: "starter" | "pro" | null; extraMinutes: number; monthly?: { left: number; limit: number; resetsAt: string } | null; status?: string; every?: "month" | "year"; periodEnds?: string | null; cancelsAt?: string | null };
// In English like the rest of the page (coach, 17 Nov: a Thai computer showed "17 พ.ย. 2570").
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });

// Plans and the checkout (sandbox first, on staging). What is sold is the decided pricing doc.
// Buying needs signing in, so the webhook knows whose plan it is. With Polar the server makes the checkout; with Paddle
// the user's id goes with the payment from here (customData).
export default function PricingPage() {
	const user = useUser();
	const [config, setConfig] = useState<Config | null>(null);
	const [ready, setReady] = useState(false); // Paddle.js loaded and set up
	const [yearly, setYearly] = useState(true);
	const [thanks, setThanks] = useState(false);
	const [mine, setMine] = useState<MyPlan | null>(null);
	const [note, setNote] = useState("");
	const started = useRef(false);
	const [opening, setOpening] = useState(false);
	const [buying, setBuying] = useState(false); // on the way to Polar's checkout

	// A fresh link every press: Paddle's portal links work once and run out.
	async function manage() {
		setOpening(true);
		setNote("");
		const res = await fetch("/api/billing/portal", { method: "POST" }).catch(() => null);
		const data = (await res?.json().catch(() => null)) as { url?: string; error?: string } | null;
		if (res?.ok && data?.url) return void (window.location.href = data.url);
		setOpening(false);
		setNote(data?.error ?? "Couldn't open billing just now. Please try again.");
	}

	// The plan we have on record (from the seller's webhook). After a purchase it is asked again a few times: the webhook
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
			.then((c) => {
				setConfig(c);
				// Back from Polar's checkout (its success address). Only for what the page says: the webhook gives the plan.
				if (new URLSearchParams(window.location.search).has("paid")) setThanks(true);
			})
			.catch(() => setConfig({ ready: false }));
	}, []);

	// Coming back with the browser's Back button can show this page as it was left, with a button still "Opening…".
	useEffect(() => {
		const back = () => {
			setOpening(false);
			setBuying(false);
		};
		window.addEventListener("pageshow", back);
		return () => window.removeEventListener("pageshow", back);
	}, []);

	// Paddle only: load Paddle.js once the token is known, and set it up for its own environment.
	useEffect(() => {
		if (!config?.ready || config.seller !== "paddle" || started.current) return;
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
	async function buy(item: { plan: "starter" | "pro" } | { extra: "extra60" | "extra200" }) {
		if (!user) return void signInWithGoogle();
		if (!config?.ready || !user.email) return;
		setNote("");
		const now = await fetch("/api/billing/me")
			.then((r) => (r.ok ? (r.json() as Promise<MyPlan>) : null))
			.catch(() => null);
		if (!now) return setNote("Couldn't check your plan just now. Please try again.");
		setMine(now);
		if ("plan" in item && now.plan !== "free") return setNote(`You're already on ${PLANS[now.plan].name}. Changing plans is coming soon.`);
		if ("plan" in item && now.pastDue) return setNote("Your last payment didn't go through. Update your card with Manage billing instead.");
		if ("extra" in item && now.plan === "free") return setNote("Extra minutes are for paid plans: pick Starter or Pro first.");
		if (config.seller === "polar") {
			if (!("plan" in item)) return; // Polar sells plans only
			setBuying(true);
			const res = await fetch("/api/billing/checkout", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ plan: item.plan, every: yearly ? "year" : "month" }),
			}).catch(() => null);
			const data = (await res?.json().catch(() => null)) as { url?: string; error?: string } | null;
			if (res?.ok && data?.url) return void (window.location.href = data.url);
			setBuying(false);
			return setNote(data?.error ?? "Couldn't open the checkout just now. Please try again.");
		}
		if (!ready || !window.Paddle) return;
		const priceId = "plan" in item ? config.prices[item.plan][yearly ? "year" : "month"] : config.prices[item.extra];
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

	const open = Boolean(config?.ready) && (config?.ready && config.seller === "paddle" ? ready || !user : true);
	const paid = mine && mine.plan !== "free" ? mine.plan : null;
	const owing = mine && mine.plan === "free" ? (mine.pastDue ?? null) : null;
	const button = (id: "starter" | "pro") => (
		<button
			onClick={() => void buy({ plan: id })}
			disabled={!open || buying || Boolean(paid) || Boolean(owing)}
			title={paid && paid !== id ? "Changing plans is coming soon" : owing ? "Update your card with Manage billing" : undefined}
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
						[true, "Yearly · save up to 35%"],
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
					{mine.extraMinutes ? ` Extra minutes: ${mine.extraMinutes}.` : ""}{" "}
					{/* The seller's own page: cancel, change card, invoices (api/billing/portal; money promise 5). */}
					<button onClick={() => void manage()} disabled={opening} className="ml-1 font-medium text-(--link) underline hover:opacity-80 disabled:opacity-60">
						{opening ? "Opening…" : "Manage billing"}
					</button>
				</p>
			)}
			{/* A renewal that wasn't paid: paid features are off until the card is fixed (coach, 27 Nov). */}
			{owing && (
				<p role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-center text-sm">
					Your last payment didn&apos;t go through, so your <span className="font-semibold">{PLANS[owing].name}</span> features are paused. Your videos are safe. Update your card and they come back.{" "}
					<button onClick={() => void manage()} disabled={opening} className="ml-1 font-medium text-(--link) underline hover:opacity-80 disabled:opacity-60">
						{opening ? "Opening…" : "Manage billing"}
					</button>
				</p>
			)}
			{/* A plan that ended (cancelled or paused): its receipts are still on the seller's page. */}
			{mine && mine.plan === "free" && mine.hadPlan && !owing && !thanks && (
				<p className="rounded-xl border border-foreground/15 p-4 text-center text-sm">
					Your plan has ended. Receipts and past payments:{" "}
					<button onClick={() => void manage()} disabled={opening} className="ml-1 font-medium text-blue-600 underline hover:text-blue-700 disabled:opacity-60 dark:text-blue-400">
						{opening ? "Opening…" : "Manage billing"}
					</button>
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
							{/* What paying yearly saves, in dollars (coach, 18 Nov: people should see how much they keep). */}
							{yearly && price > 0 && <p className="-mt-2 text-sm font-semibold text-(--ok)">Save ${(plan.month - plan.year) * 12} a year</p>}
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
								button(id)
							)}
						</div>
					);
				})}
				<div className="flex flex-col gap-3 rounded-2xl border border-dashed border-foreground/15 p-5 text-foreground/60">
					<h2 className="text-lg font-semibold text-foreground">Max</h2>
					<p className="text-sm">For studios and teams. Coming soon.</p>
				</div>
			</section>
			{/* Prices are before tax (coach 18 Nov): the seller adds VAT or sales tax for the buyer's country at checkout
			    (Polar products' tax_behavior "exclusive", Paddle prices' tax_mode "external"), and a business can add its tax
			    number there. */}
			<p className="-mt-4 text-center text-xs text-foreground/60">
				Prices in US dollars, plus applicable VAT or sales tax for your country, added at checkout. Buying for a business? Add your VAT or tax number at checkout.{" "}
				<Link href="/refund" className="underline">Refund Policy</Link> · <Link href="/terms" className="underline">Terms</Link>
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
								onClick={() => void buy({ extra: pack.id })}
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
