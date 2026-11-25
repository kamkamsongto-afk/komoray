import { studioPage } from "@/lib/page-meta";

export const metadata = studioPage("My projects");

export default function ProjectsLayout({ children }: { children: React.ReactNode }) {
	return children;
}
