import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CalendarCog, Columns3, Eye, Paintbrush, Pencil, Redo2, Scan, Undo2, X, ZoomIn, ZoomOut, createLucideIcon, type LucideIcon } from "lucide-react";
import { AuthProvider } from "./auth";
import YearView from "./calendar/YearView";
import RangeChip from "./RangeChip";
import ProjectMenu from "./ProjectMenu";
import ProjectTitle from "./ProjectTitle";
import ProjectDialog, { ProjectDeleteDialog, ProjectExportDialog, ProjectImportDialog } from "./ProjectDialog";
import PersistPulse from "./PersistPulse";
import DevPanel from "./DevPanel";
import BarMenu, { type BarMenuItem } from "./BarMenu";
import {
  bootCalendar,
  bootProjects,
  createProject,
  deleteProject,
  overwriteProject,
  peekCalendar,
  persistProjects,
  readProjectCalendar,
  emptyCalendar,
  hydrateProjects,
  renameProject,
  selectProject,
  type CalendarSnapshot,
} from "./calendar/persist";
import {
  PLANNR_EXT,
  PLANNR_MIME,
  decodePlannrFile,
  downloadPlannrFile,
  encodePlannrFile,
  isPlannrFilename,
  plannrBundleFilename,
  uniqueProjectName,
  type PlannrPack,
} from "./calendar/plannr-file";
const PILL_ICON = { size: 14, strokeWidth: 2, color: "#fff" } as const;

type PillPiece = "hide" | "range" | "history" | "title" | "mode" | "word";

/** These leave together on the first squeeze. PLANNR, Edit/View, and the title stay. */
const PILL_BREAK: PillPiece[] = ["history", "range", "hide"];
const APPLE_SHORTCUTS = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
const TITLE_MIN = 106;

/** CSS zoom of the calendar sheet. The label is the even step shown on the control. */
const CONTENT_ZOOMS = [
  { zoom: 1, label: "100%" },
  { zoom: 0.9, label: "75%" },
  { zoom: 0.8, label: "50%" },
  { zoom: 0.7, label: "25%" },
] as const;

function readContentZoom() {
  try {
    const value = Number(localStorage.getItem("plannr.contentZoom"));
    return CONTENT_ZOOMS.some((item) => item.zoom === value) ? value : 1;
  } catch {
    return 1;
  }
}

function contentZoomStep(current: number, direction: -1 | 1 | 0) {
  if (direction === 0) return CONTENT_ZOOMS[0].zoom;
  const index = Math.max(0, CONTENT_ZOOMS.findIndex((item) => item.zoom === current));
  const next = Math.min(CONTENT_ZOOMS.length - 1, Math.max(0, index + direction));
  return CONTENT_ZOOMS[next].zoom;
}

const LineDotTopVertical = createLucideIcon("line-dot-top-vertical", [
  ["path", { d: "M12 9v12" }],
  ["circle", { cx: "12", cy: "6", r: "3" }],
]);

function HideButton({
  icon: Icon,
  on,
  label,
  onClick,
}: {
  icon: LucideIcon;
  on: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`hide-btn${on ? " is-on" : ""}`}
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Icon {...PILL_ICON} aria-hidden />
    </button>
  );
}

function HistoryButton({
  kind,
  disabled,
  onClick,
}: {
  kind: "undo" | "redo" | "clear";
  disabled?: boolean;
  onClick: () => void;
}) {
  const redo = kind === "redo";
  const clear = kind === "clear";
  return (
    <button
      type="button"
      className={`revert-btn${clear ? " is-clear" : ""}`}
      disabled={disabled}
      aria-label={clear ? "Clear" : redo ? "Redo" : "Undo"}
      title={clear ? "Clear" : redo ? "Redo (⇧⌘Z / Ctrl+Y)" : "Undo (⌘Z / Ctrl+Z)"}
      onClick={onClick}
    >
      {clear ? (
        <X {...PILL_ICON} aria-hidden />
      ) : redo ? (
        <Redo2 {...PILL_ICON} aria-hidden />
      ) : (
        <Undo2 {...PILL_ICON} aria-hidden />
      )}
    </button>
  );
}

function Shell() {
  const [mode, setMode] = useState<"edit" | "view">("view");
  const [compactAt, setCompactAt] = useState(0);
  const [centerAt, setCenterAt] = useState(0);
  const [todayAt, setTodayAt] = useState(0);
  const [zoomAt, setZoomAt] = useState(0);
  const [zoomTarget, setZoomTarget] = useState<"month" | "week" | "day">("month");
  const [persistAt, setPersistAt] = useState(0);
  const [revertAt, setRevertAt] = useState(0);
  const [redoAt, setRedoAt] = useState(0);
  const [canRevert, setCanRevert] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [projectId, setProjectId] = useState(() => bootProjects().currentId);
  const [projects, setProjects] = useState(() => bootProjects().projects);
  const [rangeFrom, setRangeFrom] = useState(() => bootCalendar().rangeFrom);
  const [rangeTo, setRangeTo] = useState(() => bootCalendar().rangeTo);
  const [persistStatus, setPersistStatus] = useState<"sync" | "saved" | "error">("saved");
  const [contentLines, setContentLines] = useState(() => {
    try {
      return localStorage.getItem("plannr.contentLines") !== "0";
    } catch {
      return true;
    }
  });
  const [contentMarkers, setContentMarkers] = useState(() => {
    try {
      return localStorage.getItem("plannr.contentMarkers") !== "0";
    } catch {
      return true;
    }
  });
  const [contentZoom, setContentZoom] = useState(readContentZoom);
  const contentZoomRef = useRef(contentZoom);
  contentZoomRef.current = contentZoom;
  const [themeAt, setThemeAt] = useState(0);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportAt, setExportAt] = useState(0);
  const pendingExportIds = useRef<string[] | null>(null);
  const liveRef = useRef<CalendarSnapshot | null>(null);
  const exportCache = useRef<Record<string, CalendarSnapshot>>({});
  const [reloadAt, setReloadAt] = useState(0);
  const [pendingImport, setPendingImport] = useState<{
    packs: PlannrPack[];
    duplicates: { name: string; existingId: string }[];
  } | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const trailRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const slots = useRef<Partial<Record<PillPiece, HTMLElement>>>({});
  const known = useRef<Partial<Record<PillPiece, number>>>({});
  const [hidden, setHidden] = useState<PillPiece[]>([]);
  const [titleBox, setTitleBox] = useState<{ left: number | null; width: number }>({ left: null, width: 240 });
  const [viewportW, setViewportW] = useState(() => window.innerWidth);
  const hiddenKey = hidden.join();

  const current = projects.find((item) => item.id === projectId) ?? projects[0];
  const projectName = current?.name ?? "Untitled";
  const projectNameRef = useRef(projectName);
  const projectCreatedRef = useRef(current?.created);
  projectNameRef.current = projectName;
  projectCreatedRef.current = current?.created;

  useEffect(() => {
    const onResize = () => setViewportW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useLayoutEffect(() => {
    const pill = pillRef.current;
    const left = leftRef.current;
    const right = rightRef.current;
    const trail = trailRef.current;
    if (!pill || !left || !right) return;
    if (trail) {
      const reserve = Math.ceil((14 + trail.offsetWidth + 8) * 2);
      pill.parentElement?.style.setProperty("--float-reserve", `${reserve}px`);
    }
    (["word", "mode", "range", "history", "hide"] as PillPiece[]).forEach((id) => {
      const node = slots.current[id];
      if (node) known.current[id] = node.getBoundingClientRect().width;
    });
    const leftEdge = left.offsetLeft + left.offsetWidth + 8;
    const rightEdge = right.offsetLeft - 8;
    const free = rightEdge - leftEdge;
    const broken = PILL_BREAK.every((id) => hidden.includes(id));
    if (!broken && free < TITLE_MIN) {
      setHidden([...PILL_BREAK]);
      return;
    }
    if (broken) {
      const restore = PILL_BREAK.reduce((sum, id) => sum + (known.current[id] ?? 48) + 8, 0);
      if (free - restore >= TITLE_MIN) {
        setHidden([]);
        return;
      }
      const gapLeft = Math.round(left.offsetLeft + left.offsetWidth + 10);
      const width = Math.max(0, Math.round(pill.clientWidth - 10 - gapLeft));
      setTitleBox((current) => (current.left === gapLeft && current.width === width ? current : { left: gapLeft, width }));
      return;
    }
    const center = pill.clientWidth / 2;
    const half = Math.min(center - leftEdge, rightEdge - center);
    const width = Math.round(Math.min(240, Math.max(0, half * 2)));
    setTitleBox((current) => (current.left === null && current.width === width ? current : { left: null, width }));
  }, [viewportW, hiddenKey, projectName, mode]);

  useEffect(() => {
    const onZoomKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const zoomIn = event.key === "+" || event.key === "=" || event.code === "Equal" || event.code === "NumpadAdd";
      const zoomOut = event.key === "-" || event.key === "_" || event.code === "Minus" || event.code === "NumpadSubtract";
      const reset = !event.shiftKey && (event.key === "0" || event.code === "Digit0" || event.code === "Numpad0");
      if (!zoomIn && !zoomOut && !reset) return;
      event.preventDefault();
      const next = contentZoomStep(contentZoomRef.current, reset ? 0 : zoomOut ? 1 : -1);
      if (next === contentZoomRef.current) return;
      contentZoomRef.current = next;
      setContentZoom(next);
      try {
        localStorage.setItem("plannr.contentZoom", String(next));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("keydown", onZoomKey, true);
    return () => window.removeEventListener("keydown", onZoomKey, true);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        if (typing) return;
        event.preventDefault();
        if (event.shiftKey) setRedoAt((n) => n + 1);
        else setRevertAt((n) => n + 1);
        return;
      }
      if (event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "y") {
        if (typing) return;
        event.preventDefault();
        setRedoAt((n) => n + 1);
        return;
      }
      if (event.key !== "Tab") return;
      if (typing) return;
      event.preventDefault();
      setMode((value) => (value === "view" ? "edit" : "view"));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const index = await hydrateProjects();
        if (cancelled) return;
        setProjects(index.projects);
        setProjectId(index.currentId);
      } catch {
        /* keep boot cache */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!exporting) return;
    let cancelled = false;
    (async () => {
      const next: Record<string, CalendarSnapshot> = { ...exportCache.current };
      for (const project of projects) {
        if (cancelled) return;
        if (project.id === projectId && liveRef.current) {
          next[project.id] = liveRef.current;
          continue;
        }
        try {
          next[project.id] = await readProjectCalendar(project.id);
        } catch {
          /* skip missing */
        }
      }
      if (!cancelled) exportCache.current = next;
    })();
    return () => {
      cancelled = true;
    };
  }, [exporting, projectId, projects]);

  const applyIndex = (index: { currentId: string; projects: typeof projects }) => {
    setProjects(index.projects);
    setProjectId(index.currentId);
  };

  const importPacks = async (packs: PlannrPack[], mode: "new" | "overwrite") => {
    let taken = projects.map((item) => item.name);
    let last = await hydrateProjects();
    let overwroteCurrent = false;
    for (const pack of packs) {
      const existing = last.projects.find(
        (item) => item.name.trim().toLowerCase() === pack.name.trim().toLowerCase(),
      );
      if (mode === "overwrite" && existing) {
        last = await overwriteProject(existing.id, pack.calendar);
        if (existing.id === projectId) overwroteCurrent = true;
        continue;
      }
      const name = uniqueProjectName(pack.name, taken);
      taken = [...taken, name];
      last = await createProject(name, pack.calendar);
    }
    if (overwroteCurrent) {
      last = { ...last, currentId: projectId };
      await persistProjects(last);
    }
    applyIndex(last);
    if (overwroteCurrent) setReloadAt((n) => n + 1);
    return last;
  };

  const bindSlot = (id: PillPiece, node: HTMLSpanElement | null) => {
    if (node) slots.current[id] = node;
    else delete slots.current[id];
  };

  const piece = (id: PillPiece) => {
    const body =
      id === "word" ? (
        <ProjectMenu
          projects={projects}
          currentId={projectId}
          projectName={projectName}
          canDelete={projects.length > 1}
          onNew={() => setNaming(true)}
          onSelect={async (next) => {
            applyIndex(await selectProject(next));
          }}
          onExport={() => {
            if (liveRef.current) exportCache.current[projectId] = liveRef.current;
            setExporting(true);
          }}
          onImport={() => importInput.current?.click()}
          onDelete={() => {
            if (projects.length <= 1) return;
            setDeleting(true);
          }}
        />
      ) : id === "mode" ? (
        <div className="mode-switch" role="radiogroup" aria-label="Calendar mode">
          <button
            type="button"
            role="radio"
            aria-checked={mode === "edit"}
            aria-label="Edit"
            className={`mode-btn${mode === "edit" ? " is-on" : ""}`}
            onClick={() => setMode("edit")}
          >
            <Pencil {...PILL_ICON} aria-hidden />
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === "view"}
            aria-label="View"
            className={`mode-btn${mode === "view" ? " is-on" : ""}`}
            onClick={() => setMode("view")}
          >
            <Eye {...PILL_ICON} aria-hidden />
          </button>
        </div>
      ) : id === "range" ? (
        <RangeChip
          from={rangeFrom}
          to={rangeTo}
          onChange={(nextFrom, nextTo) => {
            setRangeFrom(nextFrom);
            setRangeTo(nextTo);
          }}
        />
      ) : id === "title" ? (
        <ProjectTitle
          name={projectName}
          editable={mode === "edit"}
          onRename={async (name) => {
            applyIndex(await renameProject(projectId, name));
          }}
        />
      ) : id === "history" ? (
        <div className="history-btns">
          <HistoryButton kind="undo" disabled={!canRevert} onClick={() => setRevertAt((n) => n + 1)} />
          <HistoryButton kind="clear" onClick={() => setPersistAt((n) => n + 1)} />
          <HistoryButton kind="redo" disabled={!canRedo} onClick={() => setRedoAt((n) => n + 1)} />
        </div>
      ) : id === "hide" ? (
        <div className="hide-btns" role="group" aria-label="Hide">
          <HideButton
            icon={LineDotTopVertical}
            on={contentMarkers}
            label={contentMarkers ? "Hide markers" : "Show markers"}
            onClick={() => {
              setContentMarkers((on) => {
                const next = !on;
                try {
                  localStorage.setItem("plannr.contentMarkers", next ? "1" : "0");
                } catch {
                  /* ignore */
                }
                return next;
              });
            }}
          />
          <HideButton
            icon={Columns3}
            on={contentLines}
            label={contentLines ? "Hide content lines" : "Show content lines"}
            onClick={() => {
              setContentLines((on) => {
                const next = !on;
                try {
                  localStorage.setItem("plannr.contentLines", next ? "1" : "0");
                } catch {
                  /* ignore */
                }
                return next;
              });
            }}
          />
        </div>
      ) : null;
    return (
      <span key={id} className="pill-slot" ref={(node) => bindSlot(id, node)}>
        {body}
      </span>
    );
  };

  const storeZoom = (next: number) => {
    if (next === contentZoomRef.current) return;
    contentZoomRef.current = next;
    setContentZoom(next);
    try {
      localStorage.setItem("plannr.contentZoom", String(next));
    } catch {
      /* ignore */
    }
  };

  const overflow: BarMenuItem[] = [];
  if (hidden.includes("history")) {
    overflow.push(
      { id: "undo", label: "Undo", icon: Undo2, shortcut: APPLE_SHORTCUTS ? "⌘Z" : "Ctrl+Z", disabled: !canRevert },
      { id: "clear", label: "Clear", icon: X, danger: true },
      { id: "redo", label: "Redo", icon: Redo2, shortcut: APPLE_SHORTCUTS ? "⇧⌘Z" : "Ctrl+Y", disabled: !canRedo },
    );
  }
  if (hidden.includes("range")) {
    overflow.push({ id: "range", label: "Edit range", icon: CalendarCog, sep: hidden.includes("history") });
  }
  if (hidden.includes("hide")) {
    overflow.push(
      {
        id: "markers",
        label: contentMarkers ? "Hide markers" : "Show markers",
        icon: LineDotTopVertical,
        on: contentMarkers,
      },
      {
        id: "lines",
        label: contentLines ? "Hide content lines" : "Show content lines",
        icon: Columns3,
        on: contentLines,
      },
    );
  }
  if (overflow[0]) overflow[0] = { ...overflow[0], sep: true };
  const burgerItems: BarMenuItem[] = [
    {
      id: "actual",
      label: "Actual Size",
      icon: Scan,
      shortcut: APPLE_SHORTCUTS ? "⌘0" : "Ctrl+0",
      disabled: contentZoom === CONTENT_ZOOMS[0].zoom,
    },
    {
      id: "zoom-in",
      label: "Zoom in",
      icon: ZoomIn,
      shortcut: APPLE_SHORTCUTS ? "⌘+" : "Ctrl++",
      disabled: contentZoom === CONTENT_ZOOMS[0].zoom,
    },
    {
      id: "zoom-out",
      label: "Zoom out",
      icon: ZoomOut,
      shortcut: APPLE_SHORTCUTS ? "⌘−" : "Ctrl+−",
      disabled: contentZoom === CONTENT_ZOOMS[CONTENT_ZOOMS.length - 1].zoom,
    },
    ...overflow,
    { id: "theme", label: "Theme", icon: Paintbrush, sep: true },
  ];

  const onBurger = (id: string) => {
    if (id === "actual") storeZoom(contentZoomStep(contentZoomRef.current, 0));
    else if (id === "zoom-in") storeZoom(contentZoomStep(contentZoomRef.current, -1));
    else if (id === "zoom-out") storeZoom(contentZoomStep(contentZoomRef.current, 1));
    else if (id === "undo") setRevertAt((n) => n + 1);
    else if (id === "clear") setPersistAt((n) => n + 1);
    else if (id === "redo") setRedoAt((n) => n + 1);
    else if (id === "range") setRangeOpen(true);
    else if (id === "markers") {
      setContentMarkers((on) => {
        const next = !on;
        try {
          localStorage.setItem("plannr.contentMarkers", next ? "1" : "0");
        } catch {
          /* ignore */
        }
        return next;
      });
    } else if (id === "lines") {
      setContentLines((on) => {
        const next = !on;
        try {
          localStorage.setItem("plannr.contentLines", next ? "1" : "0");
        } catch {
          /* ignore */
        }
        return next;
      });
    } else if (id === "theme") setThemeAt((n) => n + 1);
  };

  return (
    <div className="app">
      <header className={`topbar${mode === "edit" ? " is-edit" : ""}`}>
        <div className="float-bar">
          <div className="float-pill" ref={pillRef}>
            <div className="float-pill-side" ref={leftRef}>
              {hidden.includes("word") ? null : (
                <span className="pill-slot" ref={(node) => bindSlot("word", node)}>
                  <ProjectMenu
                    projects={projects}
                    currentId={projectId}
                    projectName={projectName}
                    canDelete={projects.length > 1}
                    onNew={() => setNaming(true)}
                    onSelect={async (id) => {
                      applyIndex(await selectProject(id));
                    }}
                    onExport={() => {
                      if (liveRef.current) exportCache.current[projectId] = liveRef.current;
                      setExporting(true);
                    }}
                    onImport={() => importInput.current?.click()}
                    onDelete={() => {
                      if (projects.length <= 1) return;
                      setDeleting(true);
                    }}
                  />
                </span>
              )}
              {hidden.includes("mode") ? null : piece("mode")}
              {hidden.includes("range") ? null : piece("range")}
            </div>
            {hidden.includes("title") ? null : (
              <div
                className="float-pill-title"
                style={
                  titleBox.left == null
                    ? { width: titleBox.width }
                    : { left: titleBox.left, width: titleBox.width, transform: "translateY(-50%)" }
                }
              >
                {piece("title")}
              </div>
            )}
            <div className="float-pill-side" ref={rightRef}>
              {hidden.includes("history") ? null : piece("history")}
              {hidden.includes("hide") ? null : piece("hide")}
            </div>
          </div>
          <div className="float-trail" ref={trailRef}>
            <BarMenu label="Menu" ariaLabel="Menu" align="end" variant="icon" items={burgerItems} onPick={onBurger} />
          </div>
        </div>
      </header>
      <DevPanel hideTrigger toggleAt={themeAt} />
      {rangeOpen ? (
        <div className="burger-pop">
          <RangeChip
            from={rangeFrom}
            to={rangeTo}
            open
            hideTrigger
            onOpenChange={setRangeOpen}
            onChange={(nextFrom, nextTo) => {
              setRangeFrom(nextFrom);
              setRangeTo(nextTo);
            }}
          />
        </div>
      ) : null}
      <YearView
        mode={mode}
        compactAt={compactAt}
        centerAt={centerAt}
        todayAt={todayAt}
        zoomAt={zoomAt}
        zoomTarget={zoomTarget}
        persistAt={persistAt}
        persistKind="clear"
        projectId={projectId}
        rangeFrom={rangeFrom}
        rangeTo={rangeTo}
        onRangeChange={(from, to) => {
          setRangeFrom(from);
          setRangeTo(to);
        }}
        onPersistStatus={setPersistStatus}
        onToday={() => setTodayAt((n) => n + 1)}
        onCenter={() => setCenterAt((n) => n + 1)}
        onCompact={() => setCompactAt((n) => n + 1)}
        onZoomTo={(band) => {
          setZoomTarget(band);
          setZoomAt((n) => n + 1);
        }}
        revertAt={revertAt}
        redoAt={redoAt}
        onCanRevert={setCanRevert}
        onCanRedo={setCanRedo}
        reloadAt={reloadAt}
        liveRef={liveRef}
        exportAt={exportAt}
        contentLines={contentLines}
        contentMarkers={contentMarkers}
        contentZoom={contentZoom}
        onExportSnapshot={(calendar: CalendarSnapshot) => {
          const ids = pendingExportIds.current ?? [projectId];
          pendingExportIds.current = null;
          const packs: PlannrPack[] = ids.map((id) => {
            const info = projects.find((item) => item.id === id);
            const snap =
              id === projectId
                ? calendar
                : (exportCache.current[id] ?? peekCalendar(id) ?? emptyCalendar());
            return {
              name: info?.name ?? "Untitled",
              created: info?.created,
              calendar: snap,
            };
          });
          const text = encodePlannrFile(packs);
          downloadPlannrFile(
            plannrBundleFilename(
              packs.map((pack) => pack.name),
              projects.length,
            ),
            text,
          );
        }}
      />
      <input
        ref={importInput}
        type="file"
        accept={`${PLANNR_EXT},${PLANNR_MIME}`}
        hidden
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          if (!isPlannrFilename(file.name)) {
            setPersistStatus("error");
            return;
          }
          try {
            const doc = decodePlannrFile(await file.text());
            const duplicates = doc.packs.flatMap((pack) => {
              const existing = projects.find(
                (item) => item.name.trim().toLowerCase() === pack.name.trim().toLowerCase(),
              );
              return existing ? [{ name: pack.name, existingId: existing.id }] : [];
            });
            if (duplicates.length) {
              setPendingImport({ packs: doc.packs, duplicates });
              return;
            }
            applyIndex(await importPacks(doc.packs, "new"));
          } catch {
            setPersistStatus("error");
          }
        }}
      />
      <PersistPulse status={persistStatus} />
      {exporting ? (
        <ProjectExportDialog
          projects={projects}
          currentId={projectId}
          onClose={() => setExporting(false)}
          onExport={(ids) => {
            pendingExportIds.current = ids;
            setExporting(false);
            setExportAt((n) => n + 1);
          }}
        />
      ) : null}
      {naming ? (
        <ProjectDialog
          onClose={() => setNaming(false)}
          onCreate={async (name, from, to) => {
            applyIndex(await createProject(name, emptyCalendar(from, to)));
            setNaming(false);
          }}
        />
      ) : null}
      {deleting ? (
        <ProjectDeleteDialog
          name={projectName}
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            setDeleting(false);
            if (projects.length <= 1) return;
            applyIndex(await deleteProject(projectId));
          }}
        />
      ) : null}
      {pendingImport ? (
        <ProjectImportDialog
          names={pendingImport.duplicates.map((item) => item.name)}
          onClose={() => setPendingImport(null)}
          onCreateNew={async () => {
            const pending = pendingImport;
            setPendingImport(null);
            await importPacks(pending.packs, "new");
          }}
          onOverwrite={async () => {
            const pending = pendingImport;
            setPendingImport(null);
            await importPacks(pending.packs, "overwrite");
          }}
        />
      ) : null}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
