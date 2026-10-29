import Link from "next/link";

// Shared look for the Privacy and Terms pages: plain, readable, one column.
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
	return (
		<main className="font-sans mx-auto flex max-w-2xl flex-col gap-4 px-4 py-12 leading-relaxed sm:px-8 [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_a]:underline">
			<Link href="/" className="text-sm text-foreground/60 no-underline">
				← Komoray
			</Link>
			<h1 className="text-3xl font-bold tracking-tight">{title}</h1>
			<p className="text-sm text-foreground/60">Last updated: {updated}</p>
			{children}
		</main>
	);
}
