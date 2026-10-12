import { useEffect, useRef, useState } from "react";

export default function ProjectTitle({
  name,
  editable = true,
  editAt = 0,
  onRename,
}: {
  name: string;
  editable?: boolean;
  editAt?: number;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);

  useEffect(() => {
    if (editable || !editing) return;
    setDraft(name);
    setEditing(false);
  }, [editable, editing, name]);

  useEffect(() => {
    if (!editAt || !editable) return;
    setDraft(name);
    setEditing(true);
  }, [editAt]);

  useEffect(() => {
    if (!editing) return;
    const node = input.current;
    if (!node) return;
    node.focus();
    node.select();
  }, [editing]);

  const commit = () => {
    const next = draft.trim() || name;
    setEditing(false);
    if (next !== name) onRename(next);
    else setDraft(name);
  };

  if (editing) {
    return (
      <input
        ref={input}
        className="project-title-input"
        value={draft}
        aria-label="Project name"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setDraft(name);
            setEditing(false);
          }
        }}
        onBlur={commit}
      />
    );
  }

  if (!editable) {
    return (
      <div className="project-title is-static" title={name}>
        {name}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="project-title"
      title={name}
      onDoubleClick={(event) => {
        event.preventDefault();
        setDraft(name);
        setEditing(true);
      }}
    >
      {name}
    </button>
  );
}
