// Plans and prices (Paddle). What is sold is the decided pricing doc of 15 Nov (Google Doc "Komoray ★Final★ ราคาและแพ็กเกจ").
// Prices live in Paddle; the price IDs here are not secret. Sandbox and live are separate catalogs with their own IDs,
// so the IDs are picked by which Paddle the client token belongs to (test_… sandbox, live_… live).
// Each price also carries custom_data in Paddle ({ plan, minutes } or { extra_minutes }), which the webhook reads.

export type PaidPlan = "starter" | "pro";
export type PaddleEnv = "sandbox" | "production";

export type PricesView = PriceIds;
type PriceIds = { starter: { month: string; year: string }; pro: { month: string; year: string }; extra60: string; extra200: string };

// Made in the sandbox on 16 Nov (catalog-setup). Live ones come when selling starts.
const PRICES: Partial<Record<PaddleEnv, PriceIds>> = {
	sandbox: {
		starter: { month: "pri_01m7jeqnpnntzyw26xd37nfdg8", year: "pri_01m7jeqp135nwrmvfdkp3markq" },
		pro: { month: "pri_01m7jeqpnmbey4a4rx7x2393se", year: "pri_01m7jeqq2pdchte2rdsv2gcjwm" },
		extra60: "pri_01m7jeqrevpqqp863vxg8zvzxh",
		extra200: "pri_01m7jeqrr7mkqpj02v32dc89ww",
	},
};

export const paddleEnvOf = (token: string): PaddleEnv => (token.startsWith("live_") ? "production" : "sandbox");
export const pricesFor = (env: PaddleEnv) => PRICES[env] ?? null;

// What the pricing page shows (the doc's table: only what is built and works today).
export const PLANS = {
	free: { name: "Free", month: 0, year: 0, minutes: "35 minutes to start, then 10 a month", points: ["Every editing feature", "komoray.com watermark", "Files kept 14 days"] },
	starter: { name: "Starter", month: 26, year: 19, minutes: "300 minutes a month", points: ["No watermark", "Translate subtitles", "Cutout", "1 Brand Kit", "Buy Extra minutes"] },
	pro: { name: "Pro", month: 48, year: 36, minutes: "600 minutes a month", points: ["Everything in Starter", "Your own font", "5 Brand Kits"] },
} as const;
export const EXTRA_PACKS = [
	{ id: "extra60" as const, minutes: 60, price: 6 },
	{ id: "extra200" as const, minutes: 200, price: 18 },
];
