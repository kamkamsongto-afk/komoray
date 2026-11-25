import { studioPage } from "@/lib/page-meta";

export const metadata = studioPage("My words");

export default function WordsLayout({ children }: { children: React.ReactNode }) {
	return children;
}
