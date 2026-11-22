import type { ReactNode } from "react";

// A group of settings in a tool box (coach 22 Nov: the menus got long): a tinted card with a small coloured dot and a short
// title. Next to each other the groups take different tones, so where one ends and the next begins is clear at a glance.
// The tints are see-through, so they sit on both themes. `main` marks the button people press most in the group.
export type Tone = "blue" | "violet" | "green" | "amber" | "rose" | "sky";

const TONES: Record<Tone, { box: string; dot: string; main: string }> = {
	blue: { box: "border-blue-500/30 bg-blue-500/[0.07]", dot: "bg-blue-500", main: "border-blue-500/60 bg-blue-500/15 font-medium hover:bg-blue-500/25" },
	violet: { box: "border-violet-500/30 bg-violet-500/[0.07]", dot: "bg-violet-500", main: "border-violet-500/60 bg-violet-500/15 font-medium hover:bg-violet-500/25" },
	green: { box: "border-emerald-500/30 bg-emerald-500/[0.07]", dot: "bg-emerald-500", main: "border-emerald-500/60 bg-emerald-500/15 font-medium hover:bg-emerald-500/25" },
	amber: { box: "border-amber-500/35 bg-amber-500/[0.08]", dot: "bg-amber-500", main: "border-amber-500/60 bg-amber-500/15 font-medium hover:bg-amber-500/25" },
	rose: { box: "border-rose-500/30 bg-rose-500/[0.07]", dot: "bg-rose-500", main: "border-rose-500/60 bg-rose-500/15 font-medium hover:bg-rose-500/25" },
	sky: { box: "border-sky-500/30 bg-sky-500/[0.07]", dot: "bg-sky-500", main: "border-sky-500/60 bg-sky-500/15 font-medium hover:bg-sky-500/25" },
};

// The look of a button that is not the main one of its group, and of the main one.
export const PLAIN_BUTTON = "inline-flex items-center gap-1 rounded-md border border-foreground/20 px-2 py-0.5 text-xs hover:bg-foreground/5";
export const mainButton = (tone: Tone) => `inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${TONES[tone].main}`;

export function ToolGroup({ tone, title, aside, children }: { tone: Tone; title: string; aside?: ReactNode; children: ReactNode }) {
	const t = TONES[tone];
	return (
		<section className={`flex flex-col gap-1.5 rounded-lg border p-2 ${t.box}`}>
			<h3 className="flex items-center gap-1.5 text-xs font-semibold text-foreground/85">
				<span className={`h-2 w-2 shrink-0 rounded-full ${t.dot}`} aria-hidden />
				{title}
				{aside && <span className="ml-auto font-normal">{aside}</span>}
			</h3>
			{children}
		</section>
	);
}
