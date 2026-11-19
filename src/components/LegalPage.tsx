import { HomeLogo } from "@/components/HomeLogo";

// Shared look for the Privacy and Terms pages: plain, readable, one column.
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
	return (
		<main className="font-sans mx-auto flex max-w-2xl flex-col gap-4 px-4 py-12 leading-relaxed sm:px-8 [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_a]:underline">
			{/* The logo, back to the home page (coach, 19 Nov: a bare document didn't look like ours). */}
			<HomeLogo href="/" className="mb-4 self-start" />
			<h1 className="text-3xl font-bold tracking-tight">{title}</h1>
			<p className="text-sm text-foreground/60">Last updated: {updated}</p>
			{children}
		</main>
	);
}
