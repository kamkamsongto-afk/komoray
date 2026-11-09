import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// No other site can show ours in a frame (to trick clicks) or see /edit?key=… in where its visitors came from.
	async headers() {
		return [
			{
				source: "/:path*",
				headers: [
					{ key: "X-Frame-Options", value: "DENY" },
					{ key: "X-Content-Type-Options", value: "nosniff" },
					{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
					// The test site stays out of Google.
					...(process.env.NEXT_PUBLIC_KOMORAY_STAGE === "staging" ? [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] : []),
				],
			},
		];
	},
};

export default nextConfig;

// Enable calling `getCloudflareContext()` in `next dev`.
// See https://opennext.js.org/cloudflare/bindings#local-access-to-bindings.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
