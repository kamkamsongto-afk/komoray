import { sameOrigin } from "@/lib/access";
import { LANGUAGES } from "@/lib/languages";
import {
	blockShared,
	changeCurated,
	curatable,
	type CuratedChange,
	effectiveUse,
	isWordList,
	type Lang,
	listFor,
	readBlocked,
	readCurated,
	readVoted,
	updateCurated,
	type WordList,
	type WordRow,
} from "@/lib/shared-words";
import { currentUser, isAdmin } from "@/lib/supabase/server";
import { realThaiWords } from "@/lib/word-check";
import { type WordUse, wordUse } from "@/lib/word-rules";

// Komoray's word lists (lib/shared-words.ts), for the admin page's Words tab. One list per language ("th", a language
// code, and "latin" for other languages' pairs from before 13 Nov). Each row has what the rules make of it (rule),
// what the team set (set), how it is used (use), and where it came from: the team's own list, or creators' shared
// fixes (only the pair and how many creators made it: never who, which video or the sentence, as the Privacy Policy says).
//   GET                                                  { lists: { [list]: Row[] } }
//   POST   { list?, pairs: [{ heard, fixed }] }           { added, skipped }  add or change team pairs
//   PATCH  { list, changes: [{ heard, source, fixed?, newHeard?, use?, reviewed? }] }  edit, set use, approve
//   DELETE { list, heards: [], creators: [] }            remove team pairs; take creators' pairs off for good
async function admin(request?: Request) {
	const { user } = await currentUser();
	if (!user || !isAdmin(user.email)) return false;
	return !request || sameOrigin(request);
}
const NOT_ADMIN = () => Response.json({ error: "This page is for the Komoray team only" }, { status: 403 });
const MAX_AT_ONCE = 2000;
const LISTS: WordList[] = ["th", ...LANGUAGES.map((l) => l.code).filter((c) => c !== "th"), "latin"];
const USES: WordUse[] = ["always", "ai", "off"];
const langOf = (list: WordList): Lang => (list === "th" ? "th" : "latin");


export async function GET() {
	if (!(await admin())) return NOT_ADMIN();
	const [curated, voted, blocked] = await Promise.all([
		Promise.all(LISTS.map(readCurated)),
		Promise.all((["th", "latin"] as const).map(readVoted)),
		Promise.all((["th", "latin"] as const).map(readBlocked)),
	]);
	const rule = (heard: string, fixed: string) => wordUse(heard, fixed, { realWords: realThaiWords, shared: true });
	const lists: Record<string, WordRow[]> = {};
	LISTS.forEach((list, k) => {
		const team: WordRow[] = curated[k].map((p) => ({ heard: p.heard, fixed: p.fixed, at: p.at, uses: p.uses ?? 1, source: "team", rule: rule(p.heard, p.fixed), set: p.use, use: effectiveUse(p), reviewed: Boolean(p.reviewed) }));
		// Creators' pairs show in the Thai and the older "latin" list, unless the team already has that heard.
		const bucket = list === "th" ? 0 : list === "latin" ? 1 : -1;
		const has = new Set(team.map((p) => p.heard));
		const theirs: WordRow[] =
			bucket < 0
				? []
				: voted[bucket]
						.filter((p) => !blocked[bucket].has(p.heard) && !has.has(p.heard))
						.map((p) => ({ heard: p.heard, fixed: p.fixed, uses: p.voters, source: "creators", rule: rule(p.heard, p.fixed), use: rule(p.heard, p.fixed) === "always" ? "ai" : rule(p.heard, p.fixed), reviewed: false })); // as sharedFixes: AI only until approved
		lists[list] = [...team, ...theirs];
	});
	return Response.json({ lists });
}

export async function POST(request: Request) {
	if (!(await admin(request))) return NOT_ADMIN();
	const body = (await request.json().catch(() => ({}))) as { pairs?: unknown; list?: unknown };
	const pairs = (Array.isArray(body.pairs) ? body.pairs : []).slice(0, MAX_AT_ONCE) as { heard?: unknown; fixed?: unknown }[];
	// Typed into a language's list: other-language pairs go there (Thai always to "th").
	const language = isWordList(body.list) && body.list !== "th" && body.list !== "latin" ? body.list : undefined;
	const add = new Map<WordList, { heard: string; fixed: string }[]>();
	const skipped: string[] = [];
	for (const p of pairs) {
		const heard = String(p?.heard ?? "");
		const fixed = String(p?.fixed ?? "");
		const lang = curatable(heard, fixed);
		if (!lang) {
			skipped.push(`${heard} → ${fixed}`);
			continue;
		}
		const list = listFor(lang, language);
		add.set(list, [...(add.get(list) ?? []), { heard, fixed }]);
	}
	for (const [list, some] of add) await changeCurated(list, some);
	return Response.json({ added: [...add.values()].reduce((n, l) => n + l.length, 0), skipped });
}

export async function PATCH(request: Request) {
	if (!(await admin(request))) return NOT_ADMIN();
	const body = (await request.json().catch(() => ({}))) as { list?: unknown; changes?: unknown };
	if (!isWordList(body.list) || !LISTS.includes(body.list) || !Array.isArray(body.changes)) return Response.json({ error: "Which words?" }, { status: 400 });
	const list = body.list;
	const team: CuratedChange[] = [];
	const approve: { heard: string; fixed: string }[] = [];
	for (const raw of body.changes.slice(0, MAX_AT_ONCE) as Record<string, unknown>[]) {
		const heard = typeof raw?.heard === "string" ? raw.heard : "";
		if (!heard) continue;
		const fixed = typeof raw.fixed === "string" ? raw.fixed : undefined;
		const newHeard = typeof raw.newHeard === "string" && raw.newHeard.trim() !== heard ? raw.newHeard : undefined;
		// An edited pair must still be a word pair the list takes.
		if ((fixed !== undefined || newHeard) && !curatable(newHeard ?? heard, fixed ?? (typeof raw.oldFixed === "string" ? raw.oldFixed : ""))) {
			return Response.json({ error: `"${newHeard ?? heard} → ${fixed ?? ""}" can't go in the list: numbers, symbols, or longer than 30 letters.` }, { status: 400 });
		}
		const use = raw.use === null ? null : USES.includes(raw.use as WordUse) ? (raw.use as WordUse) : undefined;
		const reviewed = typeof raw.reviewed === "boolean" ? raw.reviewed : undefined;
		// A creators' pair the team changes or approves becomes the team's own (it wins over theirs, by heard).
		if (raw.source === "creators") approve.push({ heard: newHeard ?? heard, fixed: fixed ?? String(raw.oldFixed ?? "") });
		team.push({ heard: raw.source === "creators" ? (newHeard ?? heard) : heard, ...(raw.source !== "creators" && newHeard && { newHeard }), ...(fixed && { fixed }), ...(use !== undefined && { use }), ...(reviewed !== undefined && { reviewed }) });
	}
	if (approve.length) await changeCurated(list, approve.filter((p) => p.fixed));
	if (team.length) await updateCurated(list, team);
	return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
	if (!(await admin(request))) return NOT_ADMIN();
	const body = (await request.json().catch(() => ({}))) as { list?: unknown; heards?: unknown; creators?: unknown };
	if (!isWordList(body.list) || !LISTS.includes(body.list)) return Response.json({ error: "Which list?" }, { status: 400 });
	const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, MAX_AT_ONCE) : []);
	const heards = strings(body.heards);
	const creators = strings(body.creators);
	if (heards.length) await changeCurated(body.list, [], heards);
	if (creators.length) await blockShared(langOf(body.list), creators);
	return Response.json({ ok: true });
}
