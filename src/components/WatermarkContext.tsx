"use client";

import { createContext } from "react";

// The Free plan's watermark in the preview: this video's seed (watermarkSeed in lib/watermark.ts), or null for none.
// Given by the AI studio page from the plan (/api/access perks.watermark), read by PlayerFrame, so the players between
// them don't each have to pass it on.
export const WatermarkSeed = createContext<number | null>(null);
