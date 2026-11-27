// Plans and prices. What is sold is the decided pricing doc of 15 Nov (Google Doc "Komoray ★Final★ ราคาและแพ็กเกจ").
// Two sellers can take the money (coach 27 Nov: never tied to one): Polar (approved 26 Nov, the main one) and Paddle
// (kept as the standby). Prices live with the seller; the IDs here are not secret. Each has separate sandbox and live
// catalogs with their own IDs. Which seller is open: lib/payments/seller.ts.

export type PaidPlan = "starter" | "pro";
export type Seller = "polar" | "paddle";
export type SellerEnv = "sandbox" | "production";
export type PaddleEnv = SellerEnv;

// Polar: one product for each plan and period. The sandbox ones were made on 27 Nov (tax added on top); live ones come
// when selling starts.
export type PlanProducts = Record<PaidPlan, { month: string; year: string }>;
const POLAR_PRODUCTS: Partial<Record<SellerEnv, PlanProducts>> = {
	sandbox: {
		starter: { month: "85791d51-7b1a-452e-b037-f4da15628961", year: "1331f35c-1404-42d5-872d-9969daf672e0" },
		pro: { month: "8201b590-1b67-4cd5-9937-abcd7936ab4a", year: "f337bbdc-29bb-4615-ac58-46c4a9229895" },
	},
};
export const polarProducts = (env: SellerEnv) => POLAR_PRODUCTS[env] ?? null;

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

// What the pricing page shows (the doc's table: only what is built and works today). Storage in GB (coach 18 Nov):
// Free 5 GB, Starter 200 GB, Pro 800 GB, the rules in the Terms of Service. Coach, 18 Nov: monthly set high
// ($29, $55) so yearly saves about 35% and leaves room for sales and affiliates; yearly stays $19 and $36.
export const PLANS = {
	free: { name: "Free", month: 0, year: 0, minutes: "35 minutes to start, then 10 a month", points: ["Every editing feature except Cutout", "5 GB storage", "Komoray watermark"] },
	starter: { name: "Starter", month: 29, year: 19, minutes: "10 hours a month", points: ["200 GB storage", "No watermark", "Cutout", "Your own font", "1 Brand Kit"] },
	pro: { name: "Pro", month: 55, year: 36, minutes: "20 hours a month", points: ["800 GB storage", "Everything in Starter", "5 Brand Kits"] },
} as const;
export const EXTRA_PACKS = [
	{ id: "extra60" as const, minutes: 60, price: 6 },
	{ id: "extra200" as const, minutes: 200, price: 18 },
];

// What a Paddle price or a Polar product buys, worked out here from its ID (never from what the browser sent): a plan
// and how often it is paid, or (Paddle only) a pack of extra minutes. null: not one of ours. Sandbox and live IDs never
// clash, so both are looked in.
export type PriceMeaning = { plan: PaidPlan; every: "month" | "year" } | { extraMinutes: number };
export function productMeaning(productId: string): { plan: PaidPlan; every: "month" | "year" } | null {
	for (const products of Object.values(POLAR_PRODUCTS)) {
		if (!products) continue;
		for (const plan of ["starter", "pro"] as const) {
			if (products[plan].month === productId) return { plan, every: "month" };
			if (products[plan].year === productId) return { plan, every: "year" };
		}
	}
	return null;
}
export function priceMeaning(priceId: string): PriceMeaning | null {
	for (const prices of Object.values(PRICES)) {
		if (!prices) continue;
		for (const plan of ["starter", "pro"] as const) {
			if (prices[plan].month === priceId) return { plan, every: "month" };
			if (prices[plan].year === priceId) return { plan, every: "year" };
		}
		for (const pack of EXTRA_PACKS) if (prices[pack.id] === priceId) return { extraMinutes: pack.minutes };
	}
	return null;
}
export const EXTRA_MONTHS = 12; // extra minutes can be used for this long after buying (decided pricing doc, 15 Nov)
