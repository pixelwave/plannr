import * as Lucide from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { LUCIDE_TAGS } from "./lucide-tags";

export type LucideItem = { name: string; Icon: LucideIcon; aliases: string[]; tags: string };

export const DEFAULT_ENTRY_ICON = "sparkles";
export const DEFAULT_ENTRY_ICON_COLOR = "#3ddc84";

function pascalToKebab(name: string) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .replace(/([A-Za-z])(\d)/g, "$1-$2")
    .toLowerCase();
}

function kebabToPascal(kebab: string) {
  return kebab
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

const SKIP = new Set(["Icon"]);

function pickCanonical(names: string[]) {
  const tagged = names.filter((name) => name in LUCIDE_TAGS);
  const pool = tagged.length ? tagged : names;
  return [...pool].sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
}

const groups = new Map<LucideIcon, string[]>();
for (const [key, value] of Object.entries(Lucide)) {
  if (!/^[A-Z]/.test(key)) continue;
  if (key.startsWith("Lucide") || key.endsWith("Icon")) continue;
  if (SKIP.has(key)) continue;
  if (typeof value !== "object" || value == null) continue;
  const Icon = value as LucideIcon;
  const kebab = pascalToKebab(key);
  const names = groups.get(Icon) ?? [];
  if (!names.includes(kebab)) names.push(kebab);
  groups.set(Icon, names);
}

for (const kebab of Object.keys(LUCIDE_TAGS)) {
  const Icon = (Lucide as Record<string, unknown>)[kebabToPascal(kebab)];
  if (typeof Icon !== "object" || Icon == null) continue;
  const names = groups.get(Icon as LucideIcon);
  if (!names) continue;
  if (!names.includes(kebab)) names.push(kebab);
}

export const LUCIDE_ICONS: LucideItem[] = [...groups.entries()]
  .map(([Icon, names]) => {
    const name = pickCanonical(names);
    const tagParts = names.map((n) => LUCIDE_TAGS[n] ?? "");
    return {
      name,
      Icon,
      aliases: names.filter((n) => n !== name),
      tags: tagParts.join(" "),
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

const BY_NAME = new Map<string, LucideIcon>();
for (const item of LUCIDE_ICONS) {
  BY_NAME.set(item.name, item.Icon);
  for (const alias of item.aliases) BY_NAME.set(alias, item.Icon);
}

export function getLucideIcon(name?: string | null): LucideIcon {
  if (name && BY_NAME.has(name)) return BY_NAME.get(name)!;
  return BY_NAME.get(DEFAULT_ENTRY_ICON) ?? (Lucide.Sparkles as LucideIcon);
}

function compact(value: string) {
  return value.replace(/-/g, "");
}

function scoreWord(item: LucideItem, word: string) {
  const names = [item.name, ...item.aliases];
  const tags = item.tags.split(/\s+/).filter(Boolean);
  const folded = compact(word);
  if (names.some((name) => name === word)) return 100;
  if (names.some((name) => name.startsWith(word))) return 80;
  if (names.some((name) => name.includes(word))) return 50;
  if (folded.length >= 2 && names.some((name) => compact(name).includes(folded))) return 45;
  if (tags.some((tag) => tag === word)) return 60;
  if (tags.some((tag) => tag.startsWith(word))) return 40;
  if (word.length >= 3 && tags.some((tag) => tag.includes(word))) return 30;
  return 0;
}

export function searchLucideIcons(query: string, limit?: number): LucideItem[] {
  const raw = query.trim().toLowerCase();
  if (!raw) {
    const preferred = [
      "sparkles",
      "star",
      "calendar",
      "flag",
      "milestone",
      "rocket",
      "target",
      "check",
      "circle",
      "hexagon",
      "layers",
      "map",
      "pin",
      "tag",
      "zap",
    ];
    const head = preferred
      .map((name) => LUCIDE_ICONS.find((item) => item.name === name))
      .filter((item): item is LucideItem => Boolean(item));
    const seen = new Set(head.map((item) => item.name));
    const rest = LUCIDE_ICONS.filter((item) => !seen.has(item.name));
    return [...head, ...rest].slice(0, limit ?? 120);
  }

  const words = raw.split(/[\s-]+/).filter(Boolean);
  const scored: { item: LucideItem; score: number }[] = [];
  for (const item of LUCIDE_ICONS) {
    let score = 0;
    let matched = true;
    for (const word of words) {
      const next = scoreWord(item, word);
      if (!next) {
        matched = false;
        break;
      }
      score += next;
    }
    if (matched) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
  const rows = scored.map((row) => row.item);
  return limit != null ? rows.slice(0, limit) : rows;
}
