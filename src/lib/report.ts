// Tell the admin page about errors only the browser sees. Never blocks or breaks the page.
export function reportError(stage: string, error: string, details: { key?: string | null; filename?: string; size?: number } = {}) {
	void fetch("/api/report", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ stage, error, ...details }),
		keepalive: true,
	}).catch(() => {});
}
