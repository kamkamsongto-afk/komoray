"use client"; // Error boundaries must be Client Components

import { PageCrash } from "@/components/PageCrash";

// Any page under the root layout that throws while showing (Next.js 16: props are error and retry).
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
	return <PageCrash error={error} retry={retry} />;
}
