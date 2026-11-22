import type { CSSProperties, ReactNode } from "react";

// A group of settings in a tool box (coach 22 Nov: the menus got long): a tinted card with a small dot and a short title.
// Three blues, from pale to deep (coach's own picks), taken in turn down the box, so where one group ends and the next
// begins is clear at a glance and nothing reads as an error (red was tried and dropped). The tints are see-through, so
// they sit on both themes. `mainButton` marks the button people press most in a group.
export type Tone = 1 | 2 | 3;

export const TONES: Record<Tone, string> = { 1: "#BFDDF0", 2: "#97D7FF", 3: "#4D8DBA" };

// The look of a button that is not the main one of its group, and of the main one.
export const PLAIN_BUTTON = "inline-flex items-center gap-1 rounded-md border border-foreground/20 px-2 py-0.5 text-xs hover:bg-foreground/5";
export const MAIN_BUTTON = "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium hover:brightness-95";
export const mainStyle = (tone: Tone): CSSProperties => ({ background: `${TONES[tone]}55`, borderColor: TONES[tone] });
// A choice that is picked (a segment, a transition): the deep blue as a ring over a light fill.
export const PICKED = "bg-[#4D8DBA]/20 font-medium ring-1 ring-inset ring-[#4D8DBA]";

export function ToolGroup({ tone, title, header, children }: { tone: Tone; title?: string; header?: ReactNode; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-1.5 rounded-lg border p-2" style={{ background: `${TONES[tone]}33`, borderColor: `${TONES[tone]}99` }}>
			{header ?? (
				<h3 className="flex items-center gap-2 text-lg leading-tight font-semibold text-foreground/90">
					<span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: TONES[tone] }} aria-hidden />
					{title}
				</h3>
			)}
			{children}
		</section>
	);
}
