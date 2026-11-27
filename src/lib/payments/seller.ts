// Which seller new purchases go to (coach, 27 Nov: never tied to one). Polar when its token is set; else Paddle. To
// switch by hand (say Polar suspends the account), set the BILLING_SELLER secret to "paddle" or "polar": no code change.
// Plans already bought stay with whoever sold them: both webhooks stay open, and "Manage billing" follows the plan.
import type { Seller } from "@/lib/billing";
import { type PolarEnv, polarSetup } from "./polar";

export type SellerSettings = PolarEnv & { BILLING_SELLER?: string };

export function openSeller(env: SellerSettings): Seller {
	if (env.BILLING_SELLER === "paddle" || env.BILLING_SELLER === "polar") return env.BILLING_SELLER;
	return polarSetup(env) ? "polar" : "paddle";
}
