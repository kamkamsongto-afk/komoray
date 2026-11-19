import Image from "next/image";
import Link from "next/link";

// Where the Komoray logo at the top left takes people (coach, 13 Nov): during the beta, the page to drop a new video and
// start a project; at the public launch, change it to "/" (the home page).
export const LOGO_HREF = "/upload";

// href "/": the Privacy, Terms and Refund pages go back to the home page (coach, 19 Nov).
export function HomeLogo({ className = "", href = LOGO_HREF }: { className?: string; href?: string }) {
	const home = href === "/";
	return (
		<Link href={href} aria-label={home ? "Komoray: home" : "Komoray: start a new video"} title={home ? "Komoray home" : "Start a new video"} className={`shrink-0 ${className}`}>
			{/* Dark letters on the light theme, white on the dark one (coach, 13 Nov); which shows is in globals.css. */}
			<Image src="/logo.svg" alt="Komoray" width={110} height={24} unoptimized priority className="logo-on-light" />
			<Image src="/logo-white.svg" alt="" aria-hidden width={110} height={24} unoptimized priority className="logo-on-dark" />
		</Link>
	);
}
