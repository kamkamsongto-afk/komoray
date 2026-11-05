"use client";

import type { Activity } from "@/lib/admin-activity";

export type ActivityRow = Activity & { used: number | null; feedback: number; errors: number };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

// Done, with failures in red if there were any.
function Count({ done, failed }: { done: number; failed: number }) {
	return (
		<>
			{done}
			{failed > 0 && <span className="ml-1 text-red-600">({failed} failed)</span>}
		</>
	);
}

function stage(row: ActivityRow) {
	if (row.email === null) return "";
	if (!row.videos) return "Not started";
	if (!row.made) return "No finished video yet";
	return row.feedback ? "Finished, gave feedback" : "Finished, no feedback yet";
}

export function ActivityTable({ rows, shown, total }: { rows: ActivityRow[]; shown: number; total: number }) {
	if (!rows.length) return <p className="text-sm text-foreground/60">Nobody yet.</p>;
	return (
		<section className="flex flex-col gap-3">
			<p className="text-sm text-foreground/60">
				How far each person got, from videos still stored (they delete themselves after 14 days). Words fixed is only a rough sign of subtitle accuracy: people may not fix every wrong word.
				{shown < total && ` Counting the newest ${shown} of ${total} videos.`}
			</p>
			<div className="overflow-x-auto rounded-xl border border-foreground/15">
				<table className="w-full min-w-[1040px] text-left text-sm">
					<thead className="text-xs text-foreground/60">
						<tr className="border-b border-foreground/15">
							<th scope="col" className="p-2.5 font-medium">Person</th>
							<th scope="col" className="p-2.5 font-medium">Where they are</th>
							<th scope="col" className="p-2.5 text-right font-medium">Minutes this month</th>
							<th scope="col" className="p-2.5 text-right font-medium">Uploaded</th>
							<th scope="col" className="p-2.5 text-right font-medium">Find silences</th>
							<th scope="col" className="p-2.5 text-right font-medium">Make video</th>
							<th scope="col" className="p-2.5 text-right font-medium">Words fixed</th>
							<th scope="col" className="p-2.5 text-right font-medium">Errors seen</th>
							<th scope="col" className="p-2.5 font-medium">Last active</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-foreground/10">
						{rows.map((row) => (
							<tr key={row.email ?? "unknown"}>
								<th scope="row" className="w-60 min-w-60 p-2.5 font-medium [overflow-wrap:anywhere]">{row.email ?? <span className="font-normal text-foreground/60">Older videos, owner not recorded</span>}</th>
								<td className="p-2.5 whitespace-nowrap">{stage(row)}</td>
								<td className="p-2.5 text-right">{row.used ?? ""}</td>
								<td className="p-2.5 text-right">{row.videos}</td>
								<td className="p-2.5 text-right whitespace-nowrap"><Count done={row.listened} failed={row.listenFailed} /></td>
								<td className="p-2.5 text-right whitespace-nowrap"><Count done={row.made} failed={row.madeFailed} /></td>
								<td className="p-2.5 text-right whitespace-nowrap">{row.words ? `${row.fixed} of ${row.words} (${((row.fixed / row.words) * 100).toFixed(1)}%)` : ""}</td>
								<td className={`p-2.5 text-right ${row.errors ? "text-red-600" : ""}`}>{row.errors || ""}</td>
								<td className="p-2.5 whitespace-nowrap text-foreground/70">{when(row.lastActive)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	);
}
