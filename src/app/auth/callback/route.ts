import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

// Google sends people back here after they sign in. Swap the one-time code for a session cookie.
export async function GET(request: Request) {
	const url = new URL(request.url);
	const code = url.searchParams.get("code");
	const next = url.searchParams.get("next") ?? "/upload";
	// Only ever send people to a page on our own site.
	const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/upload";

	if (code) {
		const supabase = await supabaseServer();
		const { error } = await supabase.auth.exchangeCodeForSession(code);
		if (!error) return NextResponse.redirect(new URL(safeNext, url.origin));
	}
	return NextResponse.redirect(new URL("/upload?signin=failed", url.origin));
}
