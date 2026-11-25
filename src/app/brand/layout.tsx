import { studioPage } from "@/lib/page-meta";

export const metadata = studioPage("Brand Kit");

export default function BrandLayout({ children }: { children: React.ReactNode }) {
	return children;
}
