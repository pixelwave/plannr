import { Fragment, useEffect, useRef, useState } from "react";
import { Menu, type LucideIcon } from "lucide-react";

export type BarMenuItem = {
  id: string;
  label: string;
  sep?: boolean;
  on?: boolean;
  disabled?: boolean;
  danger?: boolean;
  suffix?: string;
  shortcut?: string;
  href?: string;
  icon?: LucideIcon;
  submenu?: BarMenuItem[];
};

function MenuList({
  items,
  onPick,
  fly,
}: {
  items: BarMenuItem[];
  onPick: (id: string) => void;
  fly?: boolean;
}) {
  return (
    <div className={`bar-menu${fly ? " is-fly" : ""}`} role="menu">
      {items.map((item) => (
        <Fragment key={item.id}>
          {item.sep ? <div className="bar-menu-sep" /> : null}
          <MenuRow item={item} onPick={onPick} />
        </Fragment>
      ))}
    </div>
  );
}

function MenuRow({ item, onPick }: { item: BarMenuItem; onPick: (id: string) => void }) {
  const hasSub = Boolean(item.submenu?.length);
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);

  const cancelClose = () => {
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const show = () => {
    if (!hasSub || item.disabled) return;
    cancelClose();
    setOpen(true);
  };

  const hideSoon = () => {
    if (!hasSub) return;
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  };

  useEffect(() => () => cancelClose(), []);

  const className = `bar-menu-item${item.on || open ? " is-on" : ""}${item.disabled ? " is-muted" : ""}${item.danger ? " is-danger" : ""}`;
  const Icon = item.icon;
  const inner = (
    <>
      <span className="bar-menu-label">
        {Icon ? <Icon className="bar-menu-ico" size={14} strokeWidth={2} aria-hidden /> : null}
        <span className="bar-menu-text">{item.label}</span>
      </span>
      {item.shortcut ? <span className="bar-menu-key">{item.shortcut}</span> : null}
      {hasSub || item.suffix ? <span className="bar-menu-suffix">{item.suffix ?? "›"}</span> : null}
    </>
  );

  return (
    <div className="bar-menu-row" onMouseEnter={show} onMouseLeave={hideSoon}>
      {item.href && !item.disabled ? (
        <a className={className} href={item.href} role="menuitem" onClick={() => onPick(item.id)}>
          {inner}
        </a>
      ) : (
        <button
          type="button"
          className={className}
          role="menuitem"
          aria-haspopup={hasSub ? "menu" : undefined}
          aria-expanded={hasSub ? open : undefined}
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            if (hasSub) {
              setOpen(true);
              return;
            }
            onPick(item.id);
          }}
        >
          {inner}
        </button>
      )}
      {hasSub && open ? <MenuList items={item.submenu!} onPick={onPick} fly /> : null}
    </div>
  );
}

export default function BarMenu({
  label,
  ariaLabel,
  align = "start",
  variant = "chip",
  items,
  onPick,
}: {
  label: string;
  ariaLabel?: string;
  align?: "start" | "end";
  variant?: "chip" | "wordmark" | "icon";
  items: BarMenuItem[];
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={`bar-menu-anchor${align === "end" ? " is-end" : ""}${variant === "icon" ? " is-icon" : ""}`} ref={root}>
      <button
        type="button"
        className={`bar-menu-btn${variant === "wordmark" ? " is-wordmark" : ""}${variant === "icon" ? " is-icon" : ""}${open ? " is-open" : ""}`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={ariaLabel ?? label}
        onClick={() => setOpen((value) => !value)}
      >
        {variant === "icon" ? <Menu size={14} strokeWidth={2} color="#fff" aria-hidden /> : label}
        {variant === "icon" ? null : (
        <svg
          className={`bar-menu-caret${open ? " is-open" : ""}`}
          viewBox="0 0 10 6"
          width="10"
          height="6"
          aria-hidden="true"
        >
          <path
            d="M1 1l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        )}
      </button>
      {open ? (
        <MenuList
          items={items}
          onPick={(id) => {
            onPick(id);
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
