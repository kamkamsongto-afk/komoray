// What a browser tab, a search result and a shared link show about each page.
import type { Metadata } from "next";
import { IS_STAGING } from "@/lib/supabase/config";

export const SITE_URL = IS_STAGING ? "https://staging.komoray.com" : "https://komoray.com";
export const SITE_TITLE = "Komoray — AI Studio for Talking Heads";
export const SITE_DESCRIPTION = "You shoot. Komoray makes you shine. The AI studio for talking-head creators: your raw take in, a clean cut with your script, subtitles and brand out.";

// public/share-v1.jpg. Apps that show shared links remember a picture by its address: a new picture gets a new name.
const SHARE_PICTURE = { url: "/share-v1.jpg", width: 1200, height: 630, alt: "Komoray. You shoot. Komoray makes you shine. A raw take beside the same take cut with Komoray." };

// A page's openGraph and twitter replace the layout's as a whole (Next.js merges metadata one level deep only), so both
// are always written out in full here, picture included.
export function shareCard(title: string, description: string, path?: string): Metadata {
	return {
		openGraph: { type: "website", siteName: "Komoray", title, description, url: path, images: [SHARE_PICTURE] },
		twitter: { card: "summary_large_image", title, description, images: [SHARE_PICTURE] },
	};
}

// A page anyone may read: its own title, words and address.
export function publicPage(title: string, description: string, path: string): Metadata {
	return { title, description, alternates: { canonical: path }, ...shareCard(title, description, path) };
}

// A page of the studio, for one signed-in person: a title for the browser tab, nothing for a search engine to list.
export function studioPage(name: string): Metadata {
	return { title: `${name} · Komoray`, robots: { index: false, follow: false } };
}
