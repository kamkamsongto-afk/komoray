import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SITE_DESCRIPTION, SITE_TITLE, SITE_URL, shareCard } from "@/lib/page-meta";
import { IS_STAGING } from "@/lib/supabase/config";
import "./globals.css";

const geistSans = Geist({
	variable: "--font-geist-sans",
	subsets: ["latin"],
});

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

export const metadata: Metadata = {
	metadataBase: new URL(SITE_URL),
	title: SITE_TITLE,
	description: SITE_DESCRIPTION,
	...shareCard(SITE_TITLE, SITE_DESCRIPTION),
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		// The script below sets data-theme before the first paint, so the page never flashes the wrong colour.
		<html lang="en" suppressHydrationWarning>
			<head>
				<script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem("komoray.theme");if(t)document.documentElement.dataset.theme=t}catch(e){}` }} />
				<link rel="icon" href="/favicon.svg" type="image/svg+xml"></link>
				<link rel="apple-touch-icon" href="/apple-touch-icon.png"></link>
			</head>
			<body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
				{IS_STAGING && (
					// Never mistake the test site for the real one.
					<div className="pointer-events-none fixed top-0 left-1/2 z-[9999] -translate-x-1/2 rounded-b-md bg-amber-500 px-3 py-0.5 text-xs font-bold tracking-wide text-black">STAGING · test data</div>
				)}
				<div className="flex justify-end px-4 pt-2">
					<ThemeToggle />
				</div>
				{children}
			</body>
		</html>
	);
}
