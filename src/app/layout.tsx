import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeToggle } from "@/components/ThemeToggle";
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
	title: "Komoray — AI Studio for Talking Heads",
	description: "You shoot. Komoray makes you shine. The AI studio for talking-head creators: your raw take in, a clean cut with your script, subtitles and brand out.",
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
