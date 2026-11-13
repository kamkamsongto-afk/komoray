"use client";

import { useEffect, useState } from "react";
import { type AccuracyRow, percentRight } from "@/lib/accuracy";
import { LANGUAGE_TESTS } from "@/lib/language-tests";
import { LANGUAGES, translationName } from "@/lib/languages";

const GUESSES: Record<string, string> = { latin: "Latin letters (language not saved)", cyrillic: "Cyrillic letters (language not saved)" };
// Languages not offered yet (team tests) are named from the translation list.
const languageName = (code: string) => GUESSES[code] ?? LANGUAGES.find((l) => l.code === code)?.english ?? translationName(code) ?? code;
const shown = (errors: number | null, chars: number) => {
	const p = errors === null ? null : percentRight(errors, chars);
	return p === null ? "—" : `${p.toFixed(1)}%`;
};
// Good enough to offer, usable, not yet: the bar proposed for opening a language (13 Nov, not decided yet).
const tone = (errors: number | null, chars: number) => {
	const p = errors === null ? null : percentRight(errors, chars);
	return p === null ? "" : p >= 95 ? "text-green-600" : p >= 90 ? "text-amber-600" : "text-red-600";
};

// The admin page's Accuracy tab: how right the speech-to-text is, per language, from videos creators finished
// (api/admin/accuracy) and from the team's own tests (lib/language-tests.ts).
export function AdminAccuracy() {
	const [rows, setRows] = useState<AccuracyRow[] | null>(null);
	const [error, setError] = useState("");

	useEffect(() => {
		fetch("/api/admin/accuracy")
			.then(async (res) => {
				const data = (await res.json()) as { rows?: AccuracyRow[]; error?: string };
				if (!res.ok || !data.rows) throw new Error(data.error ?? "Could not load");
				setRows(data.rows);
			})
			.catch((err: Error) => setError(err.message));
	}, []);

	const byLanguage = new Map<string, { videos: number; chars: number; raw: number; ai: number; aiChars: number; aiFixes: number; aiKept: number }>();
	for (const r of rows ?? []) {
		const sum = byLanguage.get(r.language) ?? { videos: 0, chars: 0, raw: 0, ai: 0, aiChars: 0, aiFixes: 0, aiKept: 0 };
		sum.videos++;
		sum.chars += r.chars;
		sum.raw += r.rawErrors;
		if (r.aiErrors !== null) {
			sum.ai += r.aiErrors;
			sum.aiChars += r.chars;
		}
		sum.aiFixes += r.aiFixes;
		sum.aiKept += r.aiKept;
		byLanguage.set(r.language, sum);
	}

	return (
		<div className="flex flex-col gap-6">
			<p className="text-sm text-foreground/70">
				Letters right out of letters in the creator&apos;s final script, on videos they made (Make video). Their fixes are taken as the truth, so a mistake
				nobody fixed counts as right: real scores are a little lower. Spaces, capitals and punctuation don&apos;t count. Green 95% or more, amber 90–95%, red
				under 90%.
			</p>

			<section className="flex flex-col gap-2">
				<h2 className="text-sm font-semibold">From creators&apos; videos</h2>
				{error && <p className="text-sm text-red-600">{error}</p>}
				{!rows && !error && <p className="text-sm text-foreground/60">Loading…</p>}
				{rows && !rows.length && <p className="text-sm text-foreground/60">No finished videos yet.</p>}
				{rows && rows.length > 0 && (
					<div className="overflow-x-auto">
						<table className="w-full text-left text-sm">
							<thead className="text-xs text-foreground/60">
								<tr>
									<th className="py-1 pr-3 font-medium">Language</th>
									<th className="py-1 pr-3 font-medium">Videos</th>
									<th className="py-1 pr-3 font-medium">Letters</th>
									<th className="py-1 pr-3 font-medium">Speech-to-text</th>
									<th className="py-1 pr-3 font-medium">After AI spelling</th>
									<th className="py-1 font-medium">AI fixes kept</th>
								</tr>
							</thead>
							<tbody>
								{[...byLanguage.entries()]
									.sort((a, b) => b[1].chars - a[1].chars)
									.map(([language, s]) => (
										<tr key={language} className="border-t border-foreground/10">
											<td className="py-1 pr-3">{languageName(language)}</td>
											<td className="py-1 pr-3 tabular-nums">{s.videos}</td>
											<td className="py-1 pr-3 tabular-nums">{s.chars.toLocaleString()}</td>
											<td className={`py-1 pr-3 font-medium tabular-nums ${tone(s.raw, s.chars)}`}>{shown(s.raw, s.chars)}</td>
											<td className={`py-1 pr-3 font-medium tabular-nums ${tone(s.aiChars ? s.ai : null, s.aiChars)}`}>{shown(s.aiChars ? s.ai : null, s.aiChars)}</td>
											<td className="py-1 tabular-nums">{s.aiFixes ? `${s.aiKept} of ${s.aiFixes}` : "—"}</td>
										</tr>
									))}
							</tbody>
						</table>
					</div>
				)}
			</section>

			{rows && rows.length > 0 && (
				<section className="flex flex-col gap-2">
					<h2 className="text-sm font-semibold">Each video</h2>
					<div className="overflow-x-auto">
						<table className="w-full text-left text-sm">
							<thead className="text-xs text-foreground/60">
								<tr>
									<th className="py-1 pr-3 font-medium">Video</th>
									<th className="py-1 pr-3 font-medium">Who</th>
									<th className="py-1 pr-3 font-medium">Language</th>
									<th className="py-1 pr-3 font-medium">Letters</th>
									<th className="py-1 pr-3 font-medium">Speech-to-text</th>
									<th className="py-1 pr-3 font-medium">After AI</th>
									<th className="py-1 pr-3 font-medium">Fixed</th>
									<th className="py-1 font-medium">AI kept</th>
								</tr>
							</thead>
							<tbody>
								{rows.map((r) => (
									<tr key={r.id} className="border-t border-foreground/10">
										<td className="max-w-48 truncate py-1 pr-3" title={`${r.file} · made ${r.at.slice(0, 10)}`}>
											{r.file || r.id.slice(0, 8)}
										</td>
										<td className="max-w-40 truncate py-1 pr-3 text-foreground/70">{r.email ?? "—"}</td>
										<td className="py-1 pr-3">{r.guessed ? <span title="Guessed from the letters: this video is from before the language was saved">{languageName(r.language)}?</span> : languageName(r.language)}</td>
										<td className="py-1 pr-3 tabular-nums">{r.chars.toLocaleString()}</td>
										<td className={`py-1 pr-3 tabular-nums ${tone(r.rawErrors, r.chars)}`}>{shown(r.rawErrors, r.chars)}</td>
										<td className={`py-1 pr-3 tabular-nums ${tone(r.aiErrors, r.chars)}`}>{shown(r.aiErrors, r.chars)}</td>
										<td className="py-1 pr-3 tabular-nums">{r.fixes}</td>
										<td className="py-1 tabular-nums">{r.aiFixes ? `${r.aiKept} of ${r.aiFixes}` : "—"}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>
			)}

			<section className="flex flex-col gap-2">
				<h2 className="text-sm font-semibold">Team tests</h2>
				<p className="text-xs text-foreground/60">Clips with a checked transcript, run by the team (lib/language-tests.ts).</p>
				<div className="overflow-x-auto">
					<table className="w-full text-left text-sm">
						<thead className="text-xs text-foreground/60">
							<tr>
								<th className="py-1 pr-3 font-medium">Language</th>
								<th className="py-1 pr-3 font-medium">Engine</th>
								<th className="py-1 pr-3 font-medium">Clips</th>
								<th className="py-1 pr-3 font-medium">Minutes</th>
								<th className="py-1 pr-3 font-medium">Right</th>
								<th className="py-1 pr-3 font-medium">Source</th>
								<th className="py-1 font-medium">Date</th>
							</tr>
						</thead>
						<tbody>
							{LANGUAGE_TESTS.map((t) => (
								<tr key={`${t.language}-${t.engine}-${t.at}`} className="border-t border-foreground/10">
									<td className="py-1 pr-3">{languageName(t.language)}</td>
									<td className="py-1 pr-3" title={t.note}>
										{t.engine}
									</td>
									<td className="py-1 pr-3 tabular-nums">{t.clips}</td>
									<td className="py-1 pr-3 tabular-nums">{t.minutes}</td>
									<td className={`py-1 pr-3 font-medium tabular-nums ${t.percent >= 95 ? "text-green-600" : t.percent >= 90 ? "text-amber-600" : "text-red-600"}`}>{t.percent.toFixed(1)}%</td>
									<td className="py-1 pr-3 text-foreground/70">{t.source}</td>
									<td className="py-1 tabular-nums text-foreground/70">{t.at}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>
		</div>
	);
}
