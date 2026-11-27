import { customerCsv, customerRows } from "@/lib/customer-list";
import { currentUser, isAdmin } from "@/lib/supabase/server";

// The admin page's "Paying customers" download (lib/customer-list.ts). It holds buyers' addresses: only for the admin's
// Google account, and never kept by a browser or a cache.
export async function GET() {
	const { user } = await currentUser();
	if (!user) return Response.json({ error: "Please sign in" }, { status: 401 });
	if (!isAdmin(user.email)) return Response.json({ error: "This page is for the Komoray team only" }, { status: 403 });

	try {
		const csv = customerCsv(await customerRows());
		const today = new Date().toISOString().slice(0, 10);
		// The leading mark makes a spreadsheet read the file as UTF-8.
		return new Response(`﻿${csv}`, {
			headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="komoray-customers-${today}.csv"`, "Cache-Control": "no-store" },
		});
	} catch (e) {
		console.error("customer list failed:", e);
		return Response.json({ error: "Couldn't make the whole list. Please try again." }, { status: 500 });
	}
}
