"use client";

import { Upload } from "lucide-react";
import { useState } from "react";
import type { OwnFont } from "@/lib/font-info";
import type { FontId } from "@/lib/subtitle-style";
import type { useMyFonts } from "@/lib/use-my-fonts";
import { FontSelect } from "./FontSelect";
import { ClashNote } from "./MyFilePickers";

// The Font card's row, for a banner and for Cutout's words: the list (FontSelect) beside Upload your font, and what the
// upload has to say. A font just uploaded is used at once (onUploaded). Give it a key per item, so a question about one
// item's upload never shows on another.
export function FontField({
	myFonts,
	onUploaded,
	...list
}: {
	value: string;
	current?: OwnFont;
	myFonts: ReturnType<typeof useMyFonts>;
	onPick: (value: string) => void;
	onUploaded: (font: OwnFont) => void;
	label: string;
	inherit?: string;
	builtins?: FontId[];
}) {
	const [mine, setMine] = useState(false); // this row's upload is the one being answered
	async function upload(file: File, then?: "use" | "keep") {
		setMine(true);
		const font = await myFonts.upload(file, then);
		if (font) onUploaded(font);
	}
	return (
		<>
			<div className="flex items-start gap-2">
				<div className="w-3/5 min-w-0">
					<FontSelect {...list} myFonts={myFonts} />
				</div>
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<label className={`inline-flex cursor-pointer items-center justify-center gap-1 rounded-md border px-2 py-1 text-xs font-medium whitespace-nowrap hover:brightness-110 ${myFonts.busy ? "opacity-50" : ""}`} style={{ background: "#1F5F9F", borderColor: "#1F5F9F", color: "#FFFFFF" }}>
						<Upload className="h-3 w-3 shrink-0" aria-hidden />
						{myFonts.busy ? "Uploading…" : "Upload your font"}
						<input
							type="file"
							accept=".ttf,.otf,font/ttf,font/otf"
							className="hidden"
							disabled={myFonts.busy}
							onChange={(e) => {
								const file = e.target.files?.[0];
								e.target.value = "";
								if (file) void upload(file);
							}}
						/>
					</label>
					<span className="text-center text-[10px] text-foreground/55">Supported formats: .ttf, .otf</span>
				</div>
			</div>
			{mine && myFonts.error && <span className="text-xs text-red-500">{myFonts.error}</span>}
			{mine && myFonts.clash && <ClashNote clash={myFonts.clash} what="font" onUse={() => void upload(myFonts.clash!.file, "use")} onKeep={() => void upload(myFonts.clash!.file, "keep")} onCancel={myFonts.dismiss} />}
		</>
	);
}
