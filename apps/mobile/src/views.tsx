import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Link2 } from "lucide-react";
import { DevTools } from "./DevMenu";
import { Diamond, EntryMark, MarkerMark } from "./icons";
import {
  activeMarkers,
  beatsOf,
  childrenOf,
  durationLabel,
  endsIn,
  formatMonth,
  formatRange,
  formatWeekday,
  groupByDate,
  inMotion,
  linkedMark,
  markerTone,
  monthGroups,
  monthTicks,
  nextMilestone,
  pctAt,
  pctSpan,
  phase,
  progress,
  projectSpan,
  timing,
  toISO,
  toneOf,
  tracksOf,
  weekdayName,
  type Beat,
  type Entry,
  type Loaded,
  type Marker,
  type ProjectRef,
} from "./model";

export type ViewProps = {
  data: Loaded;
  byId: Map<string, Entry>;
  today: Date;
  onEntry: (id: string) => void;
  onMarker: (id: string) => void;
  projects: ProjectRef[];
  onProject: (id: string) => void;
};

function ConnectLine({ children }: { children: ReactNode }) {
  return (
    <span className="rel rel-link">
      <Link2 size={14} strokeWidth={2} aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}

function PhasePill({ status }: { status: "done" | "now" | "soon" }) {
  const label = status === "now" ? "Now" : status === "soon" ? "Soon" : "Done";
  return <span className={`pill phase-${status}`}>{label}</span>;
}

function EntryCard({
  entry,
  byId,
  today,
  onEntry,
}: {
  entry: Entry;
  byId: Map<string, Entry>;
  today: Date;
  onEntry: (id: string) => void;
}) {
  const status = phase(entry.start, entry.end, today);
  const tone = toneOf(entry);
  const link = linkedMark(entry, byId);
  const children = childrenOf(entry, [...byId.values()]);
  const upcoming = nextMilestone(entry, today);
  const marks = [...entry.milestones].sort((a, b) => a.date.localeCompare(b.date));
  const todayIso = toISO(today);
  const elapsed = status === "now" ? progress(entry.start, entry.end, today) : 0;
  return (
    <button
      type="button"
      className={`card${entry.color ? " is-colored" : ""}${status === "done" ? " is-done" : ""}${status === "now" ? " is-motion" : ""}${status === "soon" ? " is-soon" : ""}`}
      style={{ "--tone": tone } as CSSProperties}
      onClick={() => onEntry(entry.id)}
    >
      <span className="card-top">
        <EntryMark entry={entry} />
        <span className="card-copy">
          <span className="card-name">{entry.name}</span>
          <span className="card-meta">
            <span>{formatRange(entry.start, entry.end)}</span>
            <span className={status === "now" ? "card-when" : undefined}>{timing(entry.start, entry.end, today)}</span>
          </span>
        </span>
        <PhasePill status={status} />
      </span>
      {status === "now" ? (
        <span className="track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(elapsed * 100)} aria-label="Elapsed">
          <span style={{ width: `${elapsed * 100}%` }} />
        </span>
      ) : null}
      {upcoming ? (
        <span className="next-line">
          <span>Next</span> {upcoming.name} · {formatWeekday(upcoming.date)}
        </span>
      ) : null}
      {marks.length > 0 ? (
        <span className="chips">
          {marks.map((mark) => {
            const past = mark.date < todayIso;
            const isNext = upcoming?.id === mark.id;
            return (
              <span key={mark.id} className={`chip${past ? " is-past" : ""}${isNext ? " is-next" : ""}`}>
                {mark.name}
              </span>
            );
          })}
        </span>
      ) : null}
      {link ? <ConnectLine>From {link.milestone.name}</ConnectLine> : null}
      {children.length > 0 ? <ConnectLine>Links {children.map((child) => child.name).join(", ")}</ConnectLine> : null}
    </button>
  );
}

function useDismiss(open: boolean, root: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, root, close]);
}

function ProjectTitle({ name, projects, currentId, onProject }: { name: string; projects: ProjectRef[]; currentId: string; onProject: (id: string) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  useDismiss(open, root, close);
  return (
    <div className={`proj-slot${open ? " is-open" : ""}`} ref={root}>
      <p className="proj-name">
        <span>{name}</span>
        <button type="button" className="proj-caret" aria-expanded={open} aria-haspopup="menu" aria-label="Browse projects" onClick={() => setOpen((value) => !value)}>
          <svg className={open ? "is-open" : ""} viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">
            <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </p>
      {open ? (
        <div className="proj-menu" role="menu" aria-label="Projects">
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              role="menuitem"
              className={`proj-item${project.id === currentId ? " is-on" : ""}`}
              onClick={() => {
                onProject(project.id);
                setOpen(false);
              }}
            >
              {project.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function NowView({ data, byId, today, onEntry, onMarker, projects, onProject }: ViewProps) {
  const motion = inMotion(data.entries, today);
  const active = activeMarkers(data.markers, today);
  const todayIso = toISO(today);
  const upcoming = beatsOf(data.entries, data.markers).filter((beat) => {
    if (beat.date < todayIso) return false;
    if (beat.kind === "entry" && phase(beat.entry.start, beat.entry.end, today) === "now") return false;
    return true;
  });
  const next = upcoming[0];
  const nextWhen = next ? (next.date === todayIso ? "today" : formatWeekday(next.date)) : null;
  const thisYear = todayIso.slice(0, 4);
  const months: { key: string; label: string; items: Beat[] }[] = [];
  for (const beat of upcoming) {
    const key = beat.date.slice(0, 7);
    const last = months[months.length - 1];
    if (last?.key === key) {
      last.items.push(beat);
      continue;
    }
    const name = formatMonth(beat.date).split(" ")[0];
    const year = beat.date.slice(0, 4);
    months.push({ key, label: year === thisYear ? name : `${name} ${year}`, items: [beat] });
  }

  return (
    <>
      <section className="today-card">
        <ProjectTitle name={data.projectName} projects={projects} currentId={data.projectId} onProject={onProject} />
        <DevTools label={weekdayName(today)} />
        <p className="today-date">
          {today.getDate()} {formatMonth(todayIso).split(" ")[0]}
        </p>
        <p className="today-meta">
          {motion.length === 0
            ? "Nothing in motion"
            : motion.length === 1
              ? "1 entry in motion"
              : `${motion.length} entries in motion`}
          {nextWhen ? (
            <>
              {" · "}
              <span className="today-next">next {nextWhen}</span>
            </>
          ) : null}
        </p>
        {active.length > 0 ? (
          <div className="today-marks">
            {active.map((marker) => (
              <button key={marker.id} type="button" className="mini-mark" onClick={() => onMarker(marker.id)}>
                <i style={{ background: markerTone(marker) }} />
                {marker.name}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <h2 className="section-label">In motion</h2>
      {motion.length === 0 ? (
        <p className="quiet-note">No entry covers today.</p>
      ) : (
        <div className="stack">
          {motion.map((entry) => (
            <EntryCard key={entry.id} entry={entry} byId={byId} today={today} onEntry={onEntry} />
          ))}
        </div>
      )}

      {months.length === 0 ? <p className="quiet-note">Nothing coming up.</p> : null}
      {months.map((month) => (
        <section key={month.key}>
          <h2 className="section-label">{month.label}</h2>
          {groupByDate(month.items).map((group) => (
            <section key={group.date} className="day">
              <h3 className={`day-label${group.date === todayIso ? " is-today" : ""}`}>
                <span className="day-num">{formatWeekday(group.date)}</span>
              </h3>
              <div className="beats">
                {group.items.map((beat) =>
                  beat.kind === "entry" ? (
                    <EntryCard key={beatKey(beat)} entry={beat.entry} byId={byId} today={today} onEntry={onEntry} />
                  ) : (
                    <BeatButton key={beatKey(beat)} beat={beat} today={today} onEntry={onEntry} onMarker={onMarker} />
                  ),
                )}
              </div>
            </section>
          ))}
        </section>
      ))}
    </>
  );
}

function beatKey(beat: Beat) {
  if (beat.kind === "entry") return `e-${beat.entry.id}`;
  if (beat.kind === "milestone") return `m-${beat.milestone.id}`;
  return `k-${beat.marker.id}`;
}

function BeatButton({
  beat,
  today,
  onEntry,
  onMarker,
}: {
  beat: Beat;
  today: Date;
  onEntry: (id: string) => void;
  onMarker: (id: string) => void;
}) {
  if (beat.kind === "entry") {
    return (
      <button type="button" className="beat" onClick={() => onEntry(beat.entry.id)}>
        <EntryMark entry={beat.entry} />
        <span className="beat-copy">
          <span className="beat-title">{beat.entry.name}</span>
          <span className="beat-sub">
            {durationLabel(beat.entry.start, beat.entry.end)} · {timing(beat.entry.start, beat.entry.end, today)}
          </span>
        </span>
      </button>
    );
  }
  if (beat.kind === "milestone") {
    return (
      <button type="button" className="beat" onClick={() => onEntry(beat.entry.id)}>
        <Diamond color={toneOf(beat.entry)} />
        <span className="beat-copy">
          <span className="beat-title">{beat.milestone.name}</span>
          <span className="beat-sub part-of">
            <span>Part of</span>
            <EntryMark entry={beat.entry} compact />
            <span className="part-of-name">{beat.entry.name}</span>
          </span>
        </span>
      </button>
    );
  }
  return (
    <button type="button" className="legend-row" onClick={() => onMarker(beat.marker.id)}>
      <MarkerMark marker={beat.marker} />
      <span className="legend-name">{beat.marker.name}</span>
      <span className="legend-when">{formatRange(beat.marker.date, beat.marker.end || beat.marker.date)}</span>
    </button>
  );
}

export function ListView({ data, byId, today, onEntry, onMarker }: ViewProps) {
  const months = monthGroups(data.entries, data.markers);
  return (
    <>
      {months.map((month) => (
        <section key={month.key} className="month">
          <h2 className="month-label">{month.label}</h2>
          <div className="stack">
            {month.entries.map((entry) => (
              <EntryCard key={entry.id} entry={entry} byId={byId} today={today} onEntry={onEntry} />
            ))}
          </div>
          {month.markers.length > 0 ? (
            <div className="marker-block">
              <h3 className="marker-label">Markers</h3>
              <div className="stack">
                {month.markers.map((marker) => (
                  <MarkerRow key={marker.id} marker={marker} onMarker={onMarker} />
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ))}
    </>
  );
}

function MarkerRow({ marker, onMarker }: { marker: Marker; onMarker: (id: string) => void }) {
  return (
    <button type="button" className="legend-row" onClick={() => onMarker(marker.id)}>
      <MarkerMark marker={marker} />
      <span className="legend-name">{marker.name}</span>
      <span className="legend-when">{formatRange(marker.date, marker.end || marker.date)}</span>
    </button>
  );
}

export function SpineView({ data, today, onEntry, onMarker }: ViewProps) {
  const todayIso = toISO(today);
  const all = beatsOf(data.entries, data.markers);
  const motion = inMotion(data.entries, today);
  const first = all[0]?.date;
  const last = all[all.length - 1]?.date;
  const dates = new Set(all.map((beat) => beat.date));
  if ((first && last && todayIso >= first && todayIso <= last) || motion.length > 0) dates.add(todayIso);
  const days = [...dates].sort();
  const hasEarlier = days.some((date) => date < todayIso);

  return (
    <div className="spine">
      {days.map((date) => {
        const beats = all.filter((beat) => beat.date === date);
        const isToday = date === todayIso;
        const started = new Set(beats.filter((beat) => beat.kind === "entry").map((beat) => beat.entry.id));
        const still = isToday ? motion.filter((entry) => !started.has(entry.id)) : [];
        return (
          <section key={date} className={`day${date < todayIso ? " is-past" : ""}`} data-anchor={isToday ? "today" : undefined}>
            <h2 className={`day-label${isToday ? " is-today" : ""}`}>
              <span className="day-num">{formatWeekday(date)}</span>
            </h2>
            {isToday && hasEarlier ? (
              <button type="button" className="text-btn" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
                Earlier dates
              </button>
            ) : null}
            <div className="beats">
              {still.length > 0 ? <p className="quiet-note">In motion</p> : null}
              {still.map((entry) => (
                <button key={entry.id} type="button" className="beat" onClick={() => onEntry(entry.id)}>
                  <EntryMark entry={entry} />
                  <span className="beat-copy">
                    <span className="beat-title">{entry.name}</span>
                    <span className="beat-sub">{endsIn(entry.end, today)}</span>
                  </span>
                </button>
              ))}
              {beats.map((beat) => (
                <BeatButton key={beatKey(beat)} beat={beat} today={today} onEntry={onEntry} onMarker={onMarker} />
              ))}
              {isToday && beats.length === 0 && still.length === 0 ? <p className="quiet-note">Nothing scheduled today.</p> : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function TracksView({ data, today, onEntry, onMarker }: ViewProps) {
  const span = projectSpan(data.entries, data.markers);
  const ticks = monthTicks(span);
  const tracks = tracksOf(data.entries);
  const todayPct = pctAt(toISO(today), span) + 50 / span.days;
  const showToday = toISO(today) >= span.start && toISO(today) <= span.end;

  return (
    <>
      <div className="plot">
        <div className="plot-head">
          <span className="gutter" />
          <div className="scale">
            {ticks.map((tick) => (
              <span
                key={tick.iso}
                className={`scale-label${tick.pct < 6 ? " is-start" : tick.pct > 92 ? " is-end" : ""}`}
                style={{ left: `${tick.pct}%` }}
              >
                {tick.label}
              </span>
            ))}
            {data.markers.map((marker) => {
              const box = pctSpan(marker.date, marker.end || marker.date, span);
              const ranged = Boolean(marker.end && marker.end !== marker.date);
              return (
                <i
                  key={marker.id}
                  className={ranged ? "marker-band" : "marker-tick"}
                  style={{
                    left: `${box.left}%`,
                    width: ranged ? `${Math.max(box.width, 1.2)}%` : undefined,
                    background: markerTone(marker),
                  }}
                  title={marker.name}
                />
              );
            })}
          </div>
        </div>
        {tracks.map((track) => (
          <div key={track.row} className="plot-row">
            <span className="gutter">{track.row + 1}</span>
            <div className="lane">
              {ticks.map((tick) => (
                <span key={tick.iso} className="gridline" style={{ left: `${tick.pct}%` }} />
              ))}
              {showToday ? <span className="today-line" style={{ left: `${todayPct}%` }} /> : null}
              {track.entries.map((entry) => {
                const box = pctSpan(entry.start, entry.end, span);
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className="map-bar"
                    style={{ left: `${box.left}%`, width: `${box.width}%`, "--tone": toneOf(entry) } as CSSProperties}
                    aria-label={`${entry.name}, ${formatRange(entry.start, entry.end)}`}
                    onClick={() => onEntry(entry.id)}
                  >
                    <span className="map-name">{entry.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="plot-caption">
        <i className="swatch" /> Today · {formatMonth(span.start).split(" ")[0]}–{formatMonth(span.end)}
      </p>

      {data.markers.length > 0 ? (
        <section className="legend">
          <h2 className="section-label">Markers</h2>
          {data.markers
            .slice()
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((marker) => (
              <MarkerRow key={marker.id} marker={marker} onMarker={onMarker} />
            ))}
        </section>
      ) : null}

      {tracks.map((track) => (
        <section key={track.row} className="legend">
          <h2 className="section-label">Track {track.row + 1}</h2>
          {track.entries.map((entry) => (
            <button key={entry.id} type="button" className="legend-row" onClick={() => onEntry(entry.id)}>
              <EntryMark entry={entry} />
              <span className="legend-name">{entry.name}</span>
              <span className="legend-when">{formatRange(entry.start, entry.end)}</span>
            </button>
          ))}
        </section>
      ))}
    </>
  );
}
