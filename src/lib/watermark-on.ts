import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AccessStatus } from "@/lib/access";

// Whether this person's videos get the watermark: their plan says so (Free), or the site is set to show it to everyone
// to try it out. TRY_WATERMARK = "on" is a Worker secret set on staging only (coach 18 Nov: to see the watermark before
// anyone is on Free); never set it on the live site. Server only: the preview hears it through /api/access.
export function watermarkOn(access: Pick<AccessStatus, "perks">) {
	const env = getCloudflareContext().env as unknown as { TRY_WATERMARK?: string };
	return access.perks.watermark || env.TRY_WATERMARK === "on";
}
