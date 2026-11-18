"use client"; // Error boundaries must be Client Components

import "./globals.css";
import { PageCrash } from "@/components/PageCrash";

// The root layout itself threw: this replaces it, so it brings its own html, body and styles.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
	return (
		<html lang="en">
			<body>
				<PageCrash error={error} retry={retry} />
			</body>
		</html>
	);
}
