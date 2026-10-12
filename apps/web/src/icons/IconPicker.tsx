import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_ENTRY_ICON,
  DEFAULT_ENTRY_ICON_COLOR,
  getLucideIcon,
  searchLucideIcons,
} from "./lucide";

export function EntryIcon({
  name,
  color,
  size = 14,
  className,
}: {
  name?: string | null;
  color?: string | null;
  size?: number;
  className?: string;
}) {
  const Icon = getLucideIcon(name);
  return (
    <Icon
      className={className}
      size={size}
      color={color || DEFAULT_ENTRY_ICON_COLOR}
      strokeWidth={2}
      aria-hidden="true"
    />
  );
}

export function IconPicker({
  value,
  onPick,
  autoFocus,
  placeholder,
  compact,
}: {
  value?: string | null;
  onPick: (name: string) => void;
  autoFocus?: boolean;
  placeholder?: string;
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const current = value || DEFAULT_ENTRY_ICON;
  const icons = useMemo(() => searchLucideIcons(query), [query]);

  useEffect(() => {
    if (!autoFocus) return;
    input.current?.focus();
  }, [autoFocus]);

  return (
    <div className={`cal-icon-picker${compact ? " is-compact" : ""}`}>
      <input
        ref={input}
        className="cal-icon-search"
        type="search"
        value={query}
        placeholder={placeholder || "Search icons"}
        aria-label="Search icons"
        autoComplete="off"
        spellCheck={false}
        onPointerDown={(event) => event.stopPropagation()}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="cal-icon-grid" role="listbox" aria-label="Icons">
        {icons.map((item) => {
          const on = item.name === current;
          return (
            <button
              key={item.name}
              type="button"
              className={`cal-icon-cell${on ? " is-on" : ""}`}
              title={item.name}
              aria-label={item.name}
              aria-selected={on}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onPick(item.name)}
            >
              <item.Icon size={16} strokeWidth={2} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function IconColorField({
  value,
  onChange,
}: {
  value?: string | null;
  onChange: (color: string) => void;
}) {
  const color = value || DEFAULT_ENTRY_ICON_COLOR;
  const [hex, setHex] = useState(color);

  useEffect(() => {
    setHex(color);
  }, [color]);

  const commit = (raw: string) => {
    const next = raw.trim().startsWith("#") ? raw.trim() : `#${raw.trim()}`;
    if (/^#[0-9a-fA-F]{6}$/.test(next)) onChange(next.toLowerCase());
    else setHex(color);
  };

  return (
    <div className="cal-icon-color">
      <input
        type="color"
        aria-label="Icon color"
        value={color}
        onPointerDown={(event) => event.stopPropagation()}
        onChange={(event) => onChange(event.target.value.toLowerCase())}
      />
      <input
        className="cal-icon-hex"
        spellCheck={false}
        aria-label="Icon color hex"
        value={hex}
        onPointerDown={(event) => event.stopPropagation()}
        onChange={(event) => {
          const raw = event.target.value;
          setHex(raw);
          const next = raw.trim().startsWith("#") ? raw.trim() : `#${raw.trim()}`;
          if (/^#[0-9a-fA-F]{6}$/.test(next)) onChange(next.toLowerCase());
        }}
        onBlur={() => commit(hex)}
        onKeyDown={(event) => {
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}
