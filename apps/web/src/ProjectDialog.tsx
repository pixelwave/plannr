import { useEffect, useRef, useState } from "react";
import RangeChip from "./RangeChip";
import { defaultProjectYears } from "./calendar/persist";
import { plannrBundleFilename, plannrFilename } from "./calendar/plannr-file";

export default function ProjectDialog({
  onCreate,
  onClose,
}: {
  onCreate: (name: string, from: number, to: number) => void;
  onClose: () => void;
}) {
  const years = defaultProjectYears();
  const [name, setName] = useState("");
  const [from, setFrom] = useState(years.rangeFrom);
  const [to, setTo] = useState(years.rangeTo);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = () => {
    const next = name.trim();
    if (!next) {
      input.current?.focus();
      return;
    }
    onCreate(next, from, to);
  };

  return (
    <div className="project-overlay" onPointerDown={onClose}>
      <div
        className="project-dialog"
        role="dialog"
        aria-labelledby="project-dialog-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div id="project-dialog-title" className="project-dialog-title">
          Name Project
        </div>
        <input
          ref={input}
          className="project-dialog-input"
          value={name}
          placeholder="Project name"
          aria-label="Project name"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="project-dialog-title">Range</div>
        <RangeChip
          variant="inline"
          from={from}
          to={to}
          onChange={(nextFrom, nextTo) => {
            setFrom(nextFrom);
            setTo(nextTo);
          }}
        />
        <button type="button" className="project-dialog-action" onClick={submit}>
          Create Project
        </button>
      </div>
    </div>
  );
}

export function ProjectDeleteDialog({
  name,
  onConfirm,
  onClose,
}: {
  name: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="project-overlay" onPointerDown={onClose}>
      <div
        className="project-dialog"
        role="dialog"
        aria-labelledby="project-delete-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div id="project-delete-title" className="project-dialog-title">
          Delete Project
        </div>
        <p className="project-dialog-copy">
          Delete “{name}”? This cannot be undone.
        </p>
        <div className="project-dialog-actions">
          <button type="button" className="project-dialog-action" onClick={onClose}>
            No
          </button>
          <button type="button" className="project-dialog-action is-danger" onClick={onConfirm}>
            Yes
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProjectImportDialog({
  names,
  onOverwrite,
  onCreateNew,
  onClose,
}: {
  names: string[];
  onOverwrite: () => void;
  onCreateNew: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy =
    names.length === 1
      ? `“${names[0]}” already exists. Add it as a new project, or overwrite the existing one?`
      : `${names.map((name) => `“${name}”`).join(", ")} already exist. Add them as new copies, or overwrite the existing projects?`;

  return (
    <div className="project-overlay" onPointerDown={onClose}>
      <div
        className="project-dialog"
        role="dialog"
        aria-labelledby="project-import-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div id="project-import-title" className="project-dialog-title">
          Import
        </div>
        <p className="project-dialog-copy">{copy}</p>
        <div className="project-dialog-actions">
          <button type="button" className="project-dialog-action" onClick={onCreateNew}>
            Add as new
          </button>
          <button type="button" className="project-dialog-action is-danger" onClick={onOverwrite}>
            Overwrite
          </button>
        </div>
      </div>
    </div>
  );
}

type ExportScope = "this" | "all" | "choose";

export function ProjectExportDialog({
  projects,
  currentId,
  onExport,
  onClose,
}: {
  projects: { id: string; name: string }[];
  currentId: string;
  onExport: (ids: string[]) => void;
  onClose: () => void;
}) {
  const current = projects.find((item) => item.id === currentId) ?? projects[0];
  const fallbackId = current?.id ?? currentId;
  const [scope, setScope] = useState<ExportScope>("this");
  const [picked, setPicked] = useState<string[]>(fallbackId ? [fallbackId] : []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const selected =
    scope === "this"
      ? fallbackId
        ? [fallbackId]
        : []
      : scope === "all"
        ? projects.map((item) => item.id)
        : picked;

  const names = selected
    .map((id) => projects.find((item) => item.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  const file = plannrBundleFilename(names, projects.length);
  const empty = selected.length === 0;

  return (
    <div className="project-overlay" onPointerDown={onClose}>
      <div
        className="project-dialog"
        role="dialog"
        aria-labelledby="project-export-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div id="project-export-title" className="project-dialog-title">
          Export
        </div>
        <div className="project-export-radios" role="radiogroup" aria-label="Export scope">
          <label className={`project-export-radio${scope === "this" ? " is-on" : ""}`}>
            <input
              type="radio"
              name="project-export-scope"
              checked={scope === "this"}
              onChange={() => {
                setScope("this");
                if (current) setPicked([current.id]);
              }}
            />
            <span>
              <span className="project-export-label">This project</span>
              <span className="project-export-hint">{current?.name ?? "Untitled"} as {plannrFilename(current?.name ?? "project")}</span>
            </span>
          </label>
          <label className={`project-export-radio${scope === "all" ? " is-on" : ""}`}>
            <input
              type="radio"
              name="project-export-scope"
              checked={scope === "all"}
              onChange={() => {
                setScope("all");
                setPicked(projects.map((item) => item.id));
              }}
            />
            <span>
              <span className="project-export-label">All projects</span>
              <span className="project-export-hint">One {plannrBundleFilename(projects.map((item) => item.name), projects.length)}</span>
            </span>
          </label>
          <label className={`project-export-radio${scope === "choose" ? " is-on" : ""}`}>
            <input
              type="radio"
              name="project-export-scope"
              checked={scope === "choose"}
              onChange={() => setScope("choose")}
            />
            <span>
              <span className="project-export-label">Choose projects</span>
              <span className="project-export-hint">Pick, still one file</span>
            </span>
          </label>
        </div>
        {scope === "choose" ? (
          <ul className="project-export-list">
            {projects.map((project) => {
              const on = picked.includes(project.id);
              return (
                <li key={project.id}>
                  <label className={`project-export-row${on ? " is-on" : ""}`}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => {
                        setPicked((currentIds) =>
                          currentIds.includes(project.id)
                            ? currentIds.filter((id) => id !== project.id)
                            : [...currentIds, project.id],
                        );
                      }}
                    />
                    <span className="project-export-label">{project.name}</span>
                    {project.id === currentId ? <span className="project-export-pill">Current</span> : null}
                  </label>
                </li>
              );
            })}
          </ul>
        ) : null}
        <div className="project-export-foot">
          <div className="project-export-file">{empty ? "Select at least one project" : file}</div>
          <button
            type="button"
            className="project-dialog-action"
            disabled={empty}
            onClick={() => onExport(selected)}
          >
            Export
          </button>
        </div>
      </div>
    </div>
  );
}
