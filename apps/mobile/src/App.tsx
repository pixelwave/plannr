import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Detail, { type Selection } from "./Detail";
import { listProjects, loadRoadmap, startOfDay, type Loaded, type ProjectRef } from "./model";
import { NowView, type ViewProps } from "./views";

export default function App() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState(() => startOfDay(new Date()));
  const [selection, setSelection] = useState<Selection | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const [tick, setTick] = useState(0);
  const hasData = useRef(false);

  const onEntry = useCallback((id: string) => setSelection({ kind: "entry", id }), []);
  const onMarker = useCallback((id: string) => setSelection({ kind: "marker", id }), []);
  const onDismiss = useCallback(() => setSelection(null), []);
  const onProject = useCallback((id: string) => {
    setSelection(null);
    setProjectId(id);
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    listProjects(ctrl.signal)
      .then((index) => setProjects(index.projects))
      .catch(() => undefined);
    loadRoadmap(ctrl.signal, projectId ?? undefined)
      .then((next) => {
        hasData.current = true;
        setData(next);
        setProjectId((current) => current ?? next.projectId);
        setToday(startOfDay(new Date()));
        setError(null);
        document.title = `${next.projectName} · PLANNR`;
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!hasData.current) setError(err instanceof Error ? err.message : "Could not load");
      });
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      loadRoadmap(undefined, projectId ?? undefined)
        .then((next) => {
          hasData.current = true;
          setData(next);
          setToday(startOfDay(new Date()));
        })
        .catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      ctrl.abort();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [tick, projectId]);

  useEffect(() => {
    document.body.classList.toggle("sheet-open", selection !== null);
    return () => document.body.classList.remove("sheet-open");
  }, [selection]);

  const byId = useMemo(() => new Map((data?.entries ?? []).map((entry) => [entry.id, entry])), [data]);

  if (!data) {
    return (
      <div className="phone">
        <div className="status">
          <p className="wordmark">PLANNR</p>
          <h1>{error ? "Couldn't open the roadmap" : "Opening the roadmap"}</h1>
          <p className="quiet">{error ?? "PLANNR Roadmap 2026"}</p>
          {error ? (
            <button type="button" className="retry" onClick={() => setTick((n) => n + 1)}>
              Try again
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const view: ViewProps = { data, byId, today, onEntry, onMarker, projects, onProject };

  return (
    <>
      <div className="phone" inert={selection ? true : undefined}>
        <main className="panel" id="panel">
          <NowView {...view} />
          <footer className="foot">
            <span>View only</span>
            <a href="/app/">Desktop</a>
          </footer>
        </main>
      </div>
      {selection ? (
        <Detail
          key={`${selection.kind}:${selection.id}`}
          selection={selection}
          entries={data.entries}
          markers={data.markers}
          byId={byId}
          today={today}
          onEntry={onEntry}
          onMarker={onMarker}
          onDismiss={onDismiss}
        />
      ) : null}
    </>
  );
}
