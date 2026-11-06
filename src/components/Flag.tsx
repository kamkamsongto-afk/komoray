// Small flags for the spoken languages (components/LanguagePicker.tsx), drawn here: emoji flags show as two
// letters on Windows. Simplified (no coats of arms or stars), 3:2. English uses the US flag: most of our
// creators are in America. Catalan uses the Senyera.
type Band = [colour: string, share: number];

// Stripes from top to bottom (or left to right when `across`), each a share of the whole.
function bands(list: Band[], across = false) {
	const total = list.reduce((sum, [, share]) => sum + share, 0);
	let at = 0;
	return list.map(([fill, share], i) => {
		const size = (share / total) * (across ? 30 : 20);
		const rect = across ? <rect key={i} x={at} y={0} width={size + 0.05} height={20} fill={fill} /> : <rect key={i} x={0} y={at} width={30} height={size + 0.05} fill={fill} />;
		at += size;
		return rect;
	});
}

// A Nordic cross: its middle a little left of centre.
const cross = (field: string, colour: string, edge?: string) => (
	<>
		<rect width={30} height={20} fill={field} />
		{edge && <path d="M8 0h6v7h16v6H14v7H8v-7H0V7h8z" fill={edge} />}
		<path d={edge ? "M9.5 0h3v8.5H30v3H12.5V20h-3v-8.5H0v-3h9.5z" : "M8 0h5v7.5h17v5H13V20H8v-7.5H0v-5h8z"} fill={colour} />
	</>
);

const FLAGS: Record<string, React.ReactNode> = {
	en: (
		<>
			{bands(Array.from({ length: 13 }, (_, i) => [i % 2 ? "#FFFFFF" : "#B22234", 1] as Band))}
			<rect width={12} height={10.77} fill="#3C3B6E" />
			{[2, 5, 8].flatMap((y) => [2, 5, 8, 10].map((x) => <circle key={`${x}-${y}`} cx={x + (y === 5 ? 1.3 : 0)} cy={y + 0.4} r={0.55} fill="#FFFFFF" />))}
		</>
	),
	th: bands([["#A51931", 1], ["#F4F5F8", 1], ["#2D2A4A", 2], ["#F4F5F8", 1], ["#A51931", 1]]),
	es: bands([["#AA151B", 1], ["#F1BF00", 2], ["#AA151B", 1]]),
	fr: bands([["#002395", 1], ["#FFFFFF", 1], ["#ED2939", 1]], true),
	de: bands([["#000000", 1], ["#DD0000", 1], ["#FFCE00", 1]]),
	pt: (
		<>
			{bands([["#006600", 2], ["#FF0000", 3]], true)}
			<circle cx={12} cy={10} r={4} fill="#FFCC00" />
			<circle cx={12} cy={10} r={2.4} fill="#FF0000" stroke="#FFFFFF" strokeWidth={0.6} />
		</>
	),
	it: bands([["#009246", 1], ["#FFFFFF", 1], ["#CE2B37", 1]], true),
	nl: bands([["#AE1C28", 1], ["#FFFFFF", 1], ["#21468B", 1]]),
	pl: bands([["#FFFFFF", 1], ["#DC143C", 1]]),
	id: bands([["#FF0000", 1], ["#FFFFFF", 1]]),
	ru: bands([["#FFFFFF", 1], ["#0039A6", 1], ["#D52B1E", 1]]),
	uk: bands([["#0057B7", 1], ["#FFD700", 1]]),
	bg: bands([["#FFFFFF", 1], ["#00966E", 1], ["#D62612", 1]]),
	fi: cross("#FFFFFF", "#002F6C"),
	no: cross("#BA0C2F", "#00205B", "#FFFFFF"),
	ca: bands(Array.from({ length: 9 }, (_, i) => [i % 2 ? "#DA121A" : "#FCDD09", 1] as Band)),
};

export function Flag({ code, className = "h-3.5 w-5" }: { code: string; className?: string }) {
	return (
		<svg viewBox="0 0 30 20" className={`shrink-0 overflow-hidden rounded-[2px] ring-1 ring-foreground/15 ${className}`} aria-hidden>
			{FLAGS[code] ?? <rect width={30} height={20} fill="currentColor" opacity={0.2} />}
		</svg>
	);
}
