import { studioPage } from "@/lib/page-meta";

export const metadata = studioPage("My files");

export default function FilesLayout({ children }: { children: React.ReactNode }) {
	return children;
}
