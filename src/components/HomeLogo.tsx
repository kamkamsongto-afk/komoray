import Image from "next/image";
import Link from "next/link";

// Where the Komoray logo at the top left takes people (coach, 13 Nov): during the beta, the page to drop a new video and
// start a project; at the public launch, change it to "/" (the home page).
export const LOGO_HREF = "/upload";

export function HomeLogo({ className = "" }: { className?: string }) {
	return (
		<Link href={LOGO_HREF} aria-label="Komoray: start a new video" title="Start a new video" className={`shrink-0 ${className}`}>
			{/* Dark letters on the light theme, white on the dark one (coach, 13 Nov); which shows is in globals.css. */}
			<Image src="/logo.svg" alt="Komoray" width={110} height={24} unoptimized priority className="logo-on-light" />
			<Image src="/logo-white.svg" alt="" aria-hidden width={110} height={24} unoptimized priority className="logo-on-dark" />
		</Link>
	);
}
