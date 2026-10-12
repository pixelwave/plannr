// Global desktop theme for a fresh install. Copied from the live lab
// theme on 2026-10-11. The lab database keeps its own saved copy.
export type DesktopTheme = {
  markerText: number;
  markerLine: number;
  markerHatch: number;
  headBg: number;
  contentBg: number;
  weekend: number;
  weekendLine: number;
  editBgColor: string;
  editBg: number;
  headLine: number;
  yearSplit: number;
  contentLine: number;
  contentTick: number;
  yearEnd: number;
  entryFillA: number;
  entryColor: string;
  entryColorFillA: number;
  entryColorStrokeA: number;
  entrySelectedColor: string;
  entrySelectedA: number;
  entryHoverFill: number;
  entryGlowColor: string;
  entryGlow: number;
  entryStroke: number;
  entryLinkStroke: number;
  entryLinkColor: string;
  entryLinkA: number;
  entryGlowLen: number;
  entryLinkWidth: number;
  entryLinkRadius: number;
};

export const desktopThemeDefaults: DesktopTheme = {
  markerText: 71,
  markerLine: 50,
  markerHatch: 20,
  headBg: 8,
  editBgColor: "#ffffff",
  editBg: 0,
  contentBg: 0,
  weekend: 5,
  weekendLine: 0,
  headLine: 10,
  yearSplit: 20,
  contentLine: 8,
  contentTick: 20,
  yearEnd: 20,
  entryFillA: 15,
  entryColor: "#ffffff",
  entryColorFillA: 60,
  entryColorStrokeA: 40,
  entrySelectedColor: "#ffffff",
  entrySelectedA: 30,
  entryHoverFill: 5,
  entryGlowColor: "#ffffff",
  entryGlow: 10,
  entryStroke: 7,
  entryLinkStroke: 20,
  entryLinkColor: "#4d4d4d",
  entryLinkA: 100,
  entryGlowLen: 80,
  entryLinkWidth: 1.5,
  entryLinkRadius: 12,
};
