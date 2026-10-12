import type { CSSProperties } from "react";
import { Flag, type LucideIcon } from "lucide-react";
import * as Lucide from "lucide-react";
import { markerTone, type Entry, type Marker } from "./model";

function kebabToPascal(kebab: string) {
  return kebab
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

const DEFAULT_ICON = "sparkles";
const DEFAULT_ICON_COLOR = "#3ddc84";

function resolveIcon(name?: string | null): LucideIcon | null {
  if (!name) return null;
  const icon = (Lucide as unknown as Record<string, unknown>)[kebabToPascal(name)];
  if (!icon || typeof icon !== "object") return null;
  return icon as LucideIcon;
}

export function EntryMark({ entry, size = 16, compact = false }: { entry: Entry; size?: number; compact?: boolean }) {
  const Icon = resolveIcon(entry.icon) ?? resolveIcon(DEFAULT_ICON);
  const glyph = entry.iconColor || DEFAULT_ICON_COLOR;
  const tile = entry.color || "#8a8f98";
  if (!Icon) return null;
  return (
    <span className={`mark${compact ? " is-inline" : ""}`} style={{ "--tone": tile } as CSSProperties} aria-hidden>
      <Icon size={compact ? 11 : size} color={glyph} strokeWidth={2} />
    </span>
  );
}

export function MarkerMark({ marker }: { marker: Marker }) {
  const tone = markerTone(marker);
  return (
    <span className="mark" style={{ "--tone": tone } as CSSProperties} aria-hidden>
      <Flag size={15} color={tone} strokeWidth={2} />
    </span>
  );
}

export function Diamond({ color }: { color: string }) {
  return (
    <span className="mark" style={{ "--tone": color } as CSSProperties} aria-hidden>
      <i className="diamond" />
    </span>
  );
}

