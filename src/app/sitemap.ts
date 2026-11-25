import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/page-meta";

// The pages anyone may read, for search engines. The studio's pages need a sign-in and are left out.
export default function sitemap(): MetadataRoute.Sitemap {
	return ["/", "/pricing", "/terms", "/privacy", "/refund"].map((path) => ({ url: `${SITE_URL}${path}` }));
}
