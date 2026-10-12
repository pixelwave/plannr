type PersistStatus = "sync" | "saved" | "error";

const LABELS: Record<PersistStatus, string> = {
  sync: "Sync",
  saved: "Saved",
  error: "Error",
};

export default function PersistPulse({ status }: { status: PersistStatus }) {
  return (
    <div className={`persist-pulse is-${status}`} role="status">
      <span className="persist-pulse-dot" aria-hidden="true" />
      <span className="persist-pulse-word">{LABELS[status]}</span>
    </div>
  );
}
