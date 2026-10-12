import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Diamond, EntryMark, MarkerMark } from "./icons";
import {
  childrenOf,
  durationLabel,
  entriesDuring,
  formatDay,
  formatRange,
  linkedMark,
  markersDuring,
  nextMilestone,
  parentOf,
  phase,
  progress,
  relative,
  timing,
  toISO,
  toneOf,
  type Entry,
  type Marker,
} from "./model";

export type Selection = { kind: "entry"; id: string } | { kind: "marker"; id: string };

type Props = {
  selection: Selection;
  entries: Entry[];
  markers: Marker[];
  byId: Map<string, Entry>;
  today: Date;
  onEntry: (id: string) => void;
  onMarker: (id: string) => void;
  onDismiss: () => void;
};

export default function Detail({ selection, entries, markers, byId, today, onEntry, onMarker, onDismiss }: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ pointer: -1, startY: 0, prevY: 0, prevT: 0, velocity: 0 });
  const closeTimer = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    sheetRef.current?.focus();
  }, [selection]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  useEffect(() => {
    return () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    };
  }, []);

  function onDragDown(event: ReactPointerEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (!target.closest(".grabber-hit, .sheet-head")) return;
    if (target.closest("button, a, input, textarea")) return;
    drag.current = {
      pointer: event.pointerId,
      startY: event.clientY,
      prevY: event.clientY,
      prevT: event.timeStamp,
      velocity: 0,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onDragMove(event: ReactPointerEvent<HTMLElement>) {
    if (drag.current.pointer !== event.pointerId) return;
    const dy = Math.max(0, event.clientY - drag.current.startY);
    const dt = Math.max(1, event.timeStamp - drag.current.prevT);
    drag.current.velocity = (event.clientY - drag.current.prevY) / dt;
    drag.current.prevY = event.clientY;
    drag.current.prevT = event.timeStamp;
    setDragY(dy);
  }

  function onDragEnd(event: ReactPointerEvent<HTMLElement>) {
    if (drag.current.pointer !== event.pointerId) return;
    const dy = Math.max(0, event.clientY - drag.current.startY);
    const velocity = drag.current.velocity;
    drag.current.pointer = -1;
    setDragging(false);
    if (dy > 96 || (dy > 36 && velocity > 0.55)) {
      setDragY(window.innerHeight);
      closeTimer.current = window.setTimeout(onDismiss, 200);
      return;
    }
    setDragY(0);
  }

  const entry = selection.kind === "entry" ? byId.get(selection.id) : undefined;
  const marker = selection.kind === "marker" ? markers.find((item) => item.id === selection.id) : undefined;
  if (!entry && !marker) return null;

  return createPortal(
    <div className="sheet-layer" onClick={onDismiss}>
      <div
        className={`sheet${entered ? " is-in" : ""}${dragging ? " is-dragging" : ""}`}
        ref={sheetRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        style={{ "--drag": `${dragY}px` } as CSSProperties}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={onDragDown}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      >
        <div className="grabber-hit" aria-hidden>
          <div className="grabber" />
        </div>
        {entry ? (
          <EntrySheet entry={entry} entries={entries} markers={markers} byId={byId} today={today} onEntry={onEntry} onMarker={onMarker} onDismiss={onDismiss} />
        ) : marker ? (
          <MarkerSheet marker={marker} entries={entries} today={today} onEntry={onEntry} onDismiss={onDismiss} />
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function EntrySheet({
  entry,
  entries,
  markers,
  byId,
  today,
  onEntry,
  onMarker,
  onDismiss,
}: {
  entry: Entry;
  entries: Entry[];
  markers: Marker[];
  byId: Map<string, Entry>;
  today: Date;
  onEntry: (id: string) => void;
  onMarker: (id: string) => void;
  onDismiss: () => void;
}) {
  const status = phase(entry.start, entry.end, today);
  const parent = parentOf(entry, byId);
  const link = linkedMark(entry, byId);
  const children = childrenOf(entry, entries);
  const during = markersDuring(entry, markers);
  const marks = [...entry.milestones].sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = nextMilestone(entry, today);
  const todayIso = toISO(today);
  const elapsed = progress(entry.start, entry.end, today);

  return (
    <>
      <header className="sheet-head">
        <EntryMark entry={entry} />
        <div className="card-copy">
          <h2 id="sheet-title">{entry.name}</h2>
          <p className="quiet">
            {formatRange(entry.start, entry.end)} · {durationLabel(entry.start, entry.end)}
          </p>
        </div>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onDismiss}>
          <X size={16} strokeWidth={2} />
        </button>
      </header>
      <div className="sheet-body">
        <p className="sheet-status">
          <span className={`pill phase-${status}`}>{status === "now" ? "Now" : status === "soon" ? "Soon" : "Done"}</span>
          <span>{timing(entry.start, entry.end, today)}</span>
          <span>Track {entry.row + 1}</span>
        </p>
        {status !== "soon" ? (
          <div className="track" style={{ "--tone": toneOf(entry) } as CSSProperties} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(elapsed * 100)} aria-label="Elapsed">
            <span style={{ width: `${elapsed * 100}%` }} />
          </div>
        ) : null}

        {parent || link || children.length > 0 ? <h3 className="section-label">Connected</h3> : null}
        {parent ? (
          <Jump
            mark={<EntryMark entry={parent} />}
            title={parent.name}
            onClick={() => onEntry(parent.id)}
          />
        ) : null}
        {link ? (
          <Jump
            mark={<Diamond color={toneOf(link.host)} />}
            title={link.milestone.name}
            meta={link.host.name}
            onClick={() => onEntry(link.host.id)}
          />
        ) : null}
        {children.map((child) => (
          <Jump
            key={child.id}
            mark={<EntryMark entry={child} />}
            title={child.name}
            meta={formatRange(child.start, child.end)}
            onClick={() => onEntry(child.id)}
          />
        ))}

        {marks.length > 0 ? <h3 className="section-label">Milestones</h3> : null}
        {marks.length > 0 ? (
          <ul className="ms-list">
            {marks.map((mark) => {
              const past = mark.date < todayIso;
              const isNext = upcoming?.id === mark.id;
              return (
                <li key={mark.id} className={past ? "is-past" : isNext ? "is-next" : ""} style={{ "--tone": toneOf(entry) } as CSSProperties}>
                  <i className="ms-dot" />
                  <span className="ms-name">{mark.name}</span>
                  <span className="ms-when">
                    <b>{formatDay(mark.date)}</b>
                    <small>{relative(mark.date, today)}</small>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}

        {during.length > 0 ? <h3 className="section-label">Markers on this span</h3> : null}
        {during.map((item) => (
          <Jump
            key={item.id}
            mark={<MarkerMark marker={item} />}
            title={item.name}
            meta={formatRange(item.date, item.end || item.date)}
            onClick={() => onMarker(item.id)}
          />
        ))}
      </div>
    </>
  );
}

function MarkerSheet({
  marker,
  entries,
  today,
  onEntry,
  onDismiss,
}: {
  marker: Marker;
  entries: Entry[];
  today: Date;
  onEntry: (id: string) => void;
  onDismiss: () => void;
}) {
  const end = marker.end || marker.date;
  const status = phase(marker.date, end, today);
  const during = entriesDuring(marker, entries);
  return (
    <>
      <header className="sheet-head">
        <MarkerMark marker={marker} />
        <div className="card-copy">
          <h2 id="sheet-title">{marker.name}</h2>
          <p className="quiet">
            {formatRange(marker.date, end)} · {durationLabel(marker.date, end)}
          </p>
        </div>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onDismiss}>
          <X size={16} strokeWidth={2} />
        </button>
      </header>
      <div className="sheet-body">
        <p className="sheet-status">
          <span className={`pill phase-${status}`}>{status === "now" ? "Now" : status === "soon" ? "Soon" : "Done"}</span>
          <span>{timing(marker.date, end, today)}</span>
        </p>
        {during.length > 0 ? <h3 className="section-label">Entries on this span</h3> : null}
        {during.map((entry) => (
          <Jump
            key={entry.id}
            mark={<EntryMark entry={entry} />}
            title={entry.name}
            meta={formatRange(entry.start, entry.end)}
            onClick={() => onEntry(entry.id)}
          />
        ))}
      </div>
    </>
  );
}

function Jump({ mark, title, meta, onClick }: { mark: ReactNode; title: string; meta?: string; onClick: () => void }) {
  return (
    <button type="button" className="link-row" onClick={onClick}>
      {mark}
      <span className="legend-name">{title}</span>
      {meta ? <span className="legend-when">{meta}</span> : null}
    </button>
  );
}
